import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { comments, exportsTable, projects, reviewLinks } from "@/db/schema";
import { type Actor, projectAccess, requireOwner } from "./access";

export async function listComments(actor: Actor, projectId: string) {
  await projectAccess(actor, projectId);
  return db
    .select({ id: comments.id, parentId: comments.parentId, time: comments.time, body: comments.body, authorName: comments.authorName, fromReview: comments.fromReview, resolved: comments.resolved, createdAt: comments.createdAt })
    .from(comments)
    .where(eq(comments.projectId, projectId))
    .orderBy(asc(comments.time), asc(comments.createdAt));
}

export const addCommentInput = z
  .object({ projectId: z.string(), body: z.string().trim().min(1).max(2000), time: z.number().min(0).max(86400), parentId: z.string().nullable() })
  .strict();

export async function addComment(actor: Actor, input: z.infer<typeof addCommentInput>) {
  await projectAccess(actor, input.projectId);
  let time = input.time;
  if (input.parentId) {
    const [parent] = await db.select({ time: comments.time }).from(comments).where(and(eq(comments.id, input.parentId), eq(comments.projectId, input.projectId), isNull(comments.parentId)));
    if (!parent) throw new Error("That comment is gone.");
    time = parent.time;
  }
  await db.insert(comments).values({ id: crypto.randomUUID(), projectId: input.projectId, parentId: input.parentId, time, body: input.body, authorId: actor.id, authorName: actor.email });
  return { ok: true };
}

export const resolveInput = z.object({ projectId: z.string(), id: z.string(), resolved: z.boolean() }).strict();

export async function resolveComment(actor: Actor, input: z.infer<typeof resolveInput>) {
  await projectAccess(actor, input.projectId);
  await db.update(comments).set({ resolved: input.resolved }).where(and(eq(comments.id, input.id), eq(comments.projectId, input.projectId)));
  return { ok: true };
}

// ---- Review links ----

export async function listReviewLinks(actor: Actor, projectId: string) {
  await requireOwner(actor, projectId);
  return db
    .select({ token: reviewLinks.token, createdAt: reviewLinks.createdAt })
    .from(reviewLinks)
    .where(and(eq(reviewLinks.projectId, projectId), isNull(reviewLinks.revokedAt)))
    .orderBy(desc(reviewLinks.createdAt));
}

export async function createReviewLink(actor: Actor, projectId: string) {
  await requireOwner(actor, projectId);
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const token = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  await db.insert(reviewLinks).values({ token, projectId, createdBy: actor.id });
  return { token };
}

export const revokeInput = z.object({ projectId: z.string(), token: z.string() }).strict();

export async function revokeReviewLink(actor: Actor, input: z.infer<typeof revokeInput>) {
  await requireOwner(actor, input.projectId);
  await db.update(reviewLinks).set({ revokedAt: new Date().toISOString() }).where(and(eq(reviewLinks.token, input.token), eq(reviewLinks.projectId, input.projectId)));
  return { ok: true };
}

/** The project behind a live review token, or null. Public: the token is the check. */
export async function reviewProject(token: string) {
  if (!/^[0-9a-f]{32}$/.test(token)) return null;
  const [row] = await db
    .select({ projectId: projects.id, title: projects.title })
    .from(reviewLinks)
    .innerJoin(projects, eq(projects.id, reviewLinks.projectId))
    .where(and(eq(reviewLinks.token, token), isNull(reviewLinks.revokedAt)));
  return row ?? null;
}

export async function latestExport(projectId: string) {
  const [row] = await db.select().from(exportsTable).where(eq(exportsTable.projectId, projectId)).orderBy(desc(exportsTable.createdAt), desc(exportsTable.id)).limit(1);
  return row ?? null;
}

/** What a review visitor may see: the title, whether there's an export, and review comments. */
export async function reviewData(token: string) {
  const project = await reviewProject(token);
  if (!project) return null;
  const latest = await latestExport(project.projectId);
  const list = await db
    .select({ id: comments.id, time: comments.time, body: comments.body, authorName: comments.authorName, createdAt: comments.createdAt })
    .from(comments)
    .where(and(eq(comments.projectId, project.projectId), eq(comments.fromReview, true)))
    .orderBy(asc(comments.time), asc(comments.createdAt));
  return { title: project.title, hasExport: !!latest, comments: list };
}

export const reviewCommentInput = z
  .object({ name: z.string().trim().min(1).max(80), body: z.string().trim().min(1).max(2000), time: z.number().min(0).max(86400) })
  .strict();

export async function addReviewComment(token: string, input: z.infer<typeof reviewCommentInput>) {
  const project = await reviewProject(token);
  if (!project) return null;
  await db.insert(comments).values({ id: crypto.randomUUID(), projectId: project.projectId, parentId: null, time: input.time, body: input.body, authorId: null, authorName: input.name, fromReview: true });
  return reviewData(token);
}
