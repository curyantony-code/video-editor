import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { exportsTable, projects } from "@/db/schema";
import { type Actor, projectAccess, requireEditor, requireOwner } from "./access";
import { uploadBody } from "./media";

export const MAX_EXPORT_BYTES = 1024 * 1024 * 1024;

export function exportKey(projectId: string, exportId: string) {
  return `${projectId}/exports/${exportId}.mp4`;
}

export async function listExports(actor: Actor, projectId: string) {
  await projectAccess(actor, projectId);
  return db.select({ id: exportsTable.id, size: exportsTable.size, duration: exportsTable.duration, createdAt: exportsTable.createdAt }).from(exportsTable).where(eq(exportsTable.projectId, projectId)).orderBy(desc(exportsTable.createdAt));
}

export async function uploadExport(actor: Actor, projectId: string, request: Request, bucket: R2Bucket) {
  await requireEditor(actor, projectId);
  const duration = Number(new URL(request.url).searchParams.get("duration"));
  if (!(duration > 0 && duration < 86400)) return Response.json({ error: "Give the duration in seconds." }, { status: 400 });
  if ((request.headers.get("content-type") ?? "") !== "video/mp4") return Response.json({ error: "Exports are MP4 files." }, { status: 415 });
  if (Number(request.headers.get("content-length") ?? "0") > MAX_EXPORT_BYTES) return Response.json({ error: "The export is too large." }, { status: 413 });
  const id = crypto.randomUUID();
  const stored = await bucket.put(exportKey(projectId, id), await uploadBody(request), { httpMetadata: { contentType: "video/mp4" } });
  if (stored.size === 0 || stored.size > MAX_EXPORT_BYTES) {
    await bucket.delete(exportKey(projectId, id));
    return Response.json({ error: "The export is empty or too large." }, { status: 413 });
  }
  const row = { id, projectId, size: stored.size, duration, createdBy: actor.id };
  await db.insert(exportsTable).values(row);
  return Response.json(row, { status: 201 });
}

export async function exportOf(actor: Actor, exportId: string) {
  const [row] = await db.select({ id: exportsTable.id, projectId: exportsTable.projectId, title: projects.title }).from(exportsTable).innerJoin(projects, eq(projects.id, exportsTable.projectId)).where(and(eq(exportsTable.id, exportId), eq(projects.orgId, actor.orgId)));
  if (!row) return null;
  await projectAccess(actor, row.projectId);
  return row;
}

export const deleteExportInput = z.object({ projectId: z.string(), id: z.string() }).strict();

export async function deleteExport(actor: Actor, input: z.infer<typeof deleteExportInput>, bucket: R2Bucket) {
  await requireOwner(actor, input.projectId);
  const [row] = await db.delete(exportsTable).where(and(eq(exportsTable.id, input.id), eq(exportsTable.projectId, input.projectId))).returning({ id: exportsTable.id });
  if (row) await bucket.delete(exportKey(input.projectId, row.id));
  return { ok: true };
}
