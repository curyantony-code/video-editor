import { and, desc, eq, like, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { media, projects, revisions } from "@/db/schema";
import { EMPTY_TIMELINE, type MediaInfo, type Timeline } from "@/lib/timeline";
import { type Actor, projectAccess, requireEditor } from "./access";

export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
const KINDS = ["video", "audio", "image"] as const;
export type MediaKind = (typeof KINDS)[number];

export function mediaKey(projectId: string, mediaId: string) {
  return `${projectId}/media/${mediaId}`;
}

const shown = {
  id: media.id,
  name: media.name,
  kind: media.kind,
  mime: media.mime,
  size: media.size,
  duration: media.duration,
  width: media.width,
  height: media.height,
  note: media.note,
  createdAt: media.createdAt,
};
export type MediaItem = Awaited<ReturnType<typeof listMedia>>[number];

export const listMediaInput = z
  .object({ projectId: z.string(), search: z.string().max(200).optional() })
  .strict();

export async function listMedia(actor: Actor, projectId: string, search?: string) {
  await projectAccess(actor, projectId);
  const words = (search ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 8);
  const match = words.map((w) => {
    const pattern = `%${w.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    return or(like(media.note, pattern), like(media.name, pattern));
  });
  return db
    .select(shown)
    .from(media)
    .where(and(eq(media.projectId, projectId), ...match))
    .orderBy(desc(media.createdAt), media.id);
}

/** Media as the timeline rules need it, for a project the caller may see. */
export async function mediaInfo(projectId: string): Promise<MediaInfo[]> {
  return db
    .select({ id: media.id, name: media.name, kind: media.kind, duration: media.duration })
    .from(media)
    .where(eq(media.projectId, projectId));
}

const uploadQuery = z.object({
  name: z.string().trim().min(1).max(200),
  kind: z.enum(KINDS),
  duration: z.coerce.number().positive().max(24 * 3600).optional().catch(undefined),
  width: z.coerce.number().int().positive().max(16384).optional().catch(undefined),
  height: z.coerce.number().int().positive().max(16384).optional().catch(undefined),
});

/** Stores an uploaded file. The body streams into R2. */
export async function uploadMedia(
  actor: Actor,
  projectId: string,
  request: Request,
  bucket: R2Bucket,
): Promise<Response> {
  await requireEditor(actor, projectId);
  const url = new URL(request.url);
  const parsed = uploadQuery.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return Response.json({ error: "Name and kind are required." }, { status: 400 });
  const mime = (request.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  const kind = parsed.data.kind;
  if (!mime.startsWith(`${kind}/`))
    return Response.json({ error: "Only video, audio and image files can be uploaded." }, { status: 415 });
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_UPLOAD_BYTES)
    return Response.json({ error: "That file is larger than 500 MB." }, { status: 413 });
  if (!request.body) return Response.json({ error: "The file is empty." }, { status: 400 });
  const id = crypto.randomUUID();
  const stored = await bucket.put(mediaKey(projectId, id), await uploadBody(request), {
    httpMetadata: { contentType: mime },
  });
  if (stored.size > MAX_UPLOAD_BYTES || stored.size === 0) {
    await bucket.delete(mediaKey(projectId, id));
    return Response.json({ error: "That file is empty or larger than 500 MB." }, { status: 413 });
  }
  const row = {
    id,
    projectId,
    name: parsed.data.name,
    kind,
    mime,
    size: stored.size,
    duration: kind === "image" ? null : (parsed.data.duration ?? null),
    width: kind === "audio" ? null : (parsed.data.width ?? null),
    height: kind === "audio" ? null : (parsed.data.height ?? null),
    createdBy: actor.id,
  };
  await db.insert(media).values(row);
  return Response.json(row, { status: 201 });
}

/** The request body for R2: streamed when its length is known, so big files never sit in memory. */
export async function uploadBody(request: Request): Promise<ReadableStream | ArrayBuffer> {
  const length = Number(request.headers.get("content-length") ?? "");
  if (request.body && Number.isInteger(length) && length > 0) {
    const fixed = new FixedLengthStream(length);
    void request.body.pipeTo(fixed.writable).catch(() => undefined);
    return fixed.readable;
  }
  return request.arrayBuffer();
}

/** Streams a stored file, with Range support for seeking. */
export async function serveObject(
  bucket: R2Bucket,
  key: string,
  request: Request,
  headers: Record<string, string> = {},
): Promise<Response> {
  const range = request.headers.get("range");
  const match = range?.match(/^bytes=(\d*)-(\d*)$/);
  let r2Range: R2Range | undefined;
  if (match && (match[1] || match[2])) {
    if (match[1]) {
      const offset = Number(match[1]);
      r2Range = match[2] ? { offset, length: Number(match[2]) - offset + 1 } : { offset };
    } else r2Range = { suffix: Number(match[2]) };
  }
  const object = await bucket.get(key, r2Range ? { range: r2Range } : {});
  if (!object || !("body" in object)) return Response.json({ error: "Not found" }, { status: 404 });
  const h = new Headers(headers);
  h.set("content-type", object.httpMetadata?.contentType ?? "application/octet-stream");
  h.set("accept-ranges", "bytes");
  // An uploaded file is never a page: no scripts, even when opened directly.
  h.set("content-security-policy", "sandbox; default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'");
  h.set("x-content-type-options", "nosniff");
  h.set("cache-control", "private, max-age=3600");
  if (r2Range && object.range) {
    const r = object.range as { offset?: number; length?: number; suffix?: number };
    const offset = "suffix" in r && r.suffix != null ? object.size - r.suffix : (r.offset ?? 0);
    const length = "suffix" in r && r.suffix != null ? r.suffix : (r.length ?? object.size - offset);
    h.set("content-range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
    h.set("content-length", String(length));
    return new Response(object.body, { status: 206, headers: h });
  }
  h.set("content-length", String(object.size));
  return new Response(object.body, { headers: h });
}

export async function mediaFile(actor: Actor, mediaId: string) {
  const [row] = await db
    .select({ id: media.id, projectId: media.projectId, name: media.name })
    .from(media)
    .innerJoin(projects, eq(projects.id, media.projectId))
    .where(and(eq(media.id, mediaId), eq(projects.orgId, actor.orgId)));
  if (!row) return null;
  await projectAccess(actor, row.projectId);
  return row;
}

export const noteInput = z
  .object({ projectId: z.string(), mediaId: z.string(), note: z.string().max(4000) })
  .strict();

export async function setNote(actor: Actor, input: z.infer<typeof noteInput>) {
  await requireEditor(actor, input.projectId);
  const [row] = await db
    .update(media)
    .set({ note: input.note })
    .where(and(eq(media.id, input.mediaId), eq(media.projectId, input.projectId)))
    .returning({ id: media.id });
  if (!row) throw new Error("No such media in this project.");
  return { ok: true };
}

export const deleteMediaInput = z.object({ projectId: z.string(), mediaId: z.string() }).strict();

/** Deletes a file and, in a new timeline revision, the clips that used it. */
export async function deleteMedia(
  actor: Actor,
  input: z.infer<typeof deleteMediaInput>,
  bucket: R2Bucket,
) {
  const { project } = await requireEditor(actor, input.projectId);
  const [row] = await db
    .select({ id: media.id })
    .from(media)
    .where(and(eq(media.id, input.mediaId), eq(media.projectId, input.projectId)));
  if (!row) throw new Error("No such media in this project.");
  const [current] = await db
    .select({ timeline: revisions.timeline })
    .from(revisions)
    .where(and(eq(revisions.projectId, project.id), eq(revisions.number, project.revision)));
  const timeline: Timeline = current ? JSON.parse(current.timeline) : EMPTY_TIMELINE;
  const used = timeline.tracks.some((t) => t.clips.some((c) => c.mediaId === input.mediaId));
  const statements = [];
  if (used) {
    const next: Timeline = {
      tracks: timeline.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => c.mediaId !== input.mediaId) })),
    };
    const number = project.revision + 1;
    statements.push(
      db.insert(revisions).values({ projectId: project.id, number, timeline: JSON.stringify(next), source: "media-deleted", authorId: actor.id }),
      db.update(projects).set({ revision: number }).where(and(eq(projects.id, project.id), eq(projects.revision, project.revision))),
    );
  }
  await db.batch([...statements, db.delete(media).where(eq(media.id, input.mediaId))] as never);
  await bucket.delete(mediaKey(input.projectId, input.mediaId));
  return { ok: true, timelineChanged: used };
}
