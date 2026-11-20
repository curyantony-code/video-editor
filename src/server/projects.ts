import { and, desc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  agentMessages,
  comments,
  exportsTable,
  media,
  projectMembers,
  projects,
  reviewLinks,
  revisions,
  scenes,
  shots,
  users,
} from "@/db/schema";
import { type Actor, NotFound, projectAccess, requireOwner } from "./access";

export const ASPECTS = ["16:9", "9:16", "1:1"] as const;
export const FRAME_RATES = [24, 25, 30, 60] as const;

export const createProjectInput = z
  .object({
    title: z.string().trim().min(1, "Give the project a title").max(120),
    aspect: z.enum(ASPECTS),
    fps: z.number().int().refine((n) => (FRAME_RATES as readonly number[]).includes(n)),
  })
  .strict();
export const renameProjectInput = z
  .object({ projectId: z.string(), title: z.string().trim().min(1).max(120) })
  .strict();
export const projectIdInput = z.object({ projectId: z.string().max(64) }).strict();

const listed = {
  id: projects.id,
  title: projects.title,
  aspect: projects.aspect,
  fps: projects.fps,
  ownerId: projects.ownerId,
  createdAt: projects.createdAt,
};

/** The actor's own projects, then those shared with them. */
export async function listProjects(actor: Actor) {
  const own = await db
    .select(listed)
    .from(projects)
    .where(and(eq(projects.ownerId, actor.id), eq(projects.orgId, actor.orgId)))
    .orderBy(desc(projects.createdAt));
  const shared = await db
    .select({ ...listed, role: projectMembers.role, ownerEmail: users.email })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .leftJoin(users, eq(users.id, projects.ownerId))
    .where(and(eq(projectMembers.userId, actor.id), eq(projects.orgId, actor.orgId)))
    .orderBy(desc(projects.createdAt));
  return [
    ...own.map((p) => ({ ...p, role: "owner" as const, ownerEmail: actor.email })),
    ...shared.map((p) => ({ ...p, role: p.role as "editor" | "viewer" })),
  ];
}

/** For admins: the organization's projects the admin doesn't own. */
export async function listOrgProjects(actor: Actor) {
  if (!actor.admin) return null;
  return db
    .select({ id: projects.id, title: projects.title, ownerEmail: users.email, createdAt: projects.createdAt })
    .from(projects)
    .leftJoin(users, eq(users.id, projects.ownerId))
    .where(and(eq(projects.orgId, actor.orgId), ne(projects.ownerId, actor.id)))
    .orderBy(desc(projects.createdAt));
}

export async function createProject(actor: Actor, input: z.infer<typeof createProjectInput>) {
  const id = crypto.randomUUID();
  await db.insert(projects).values({ id, orgId: actor.orgId, ownerId: actor.id, ...input });
  return { id };
}

export async function getProject(actor: Actor, projectId: string) {
  const { project, role } = await projectAccess(actor, projectId);
  return {
    id: project.id,
    title: project.title,
    aspect: project.aspect,
    fps: project.fps,
    revision: project.revision,
    role,
  };
}

export async function renameProject(actor: Actor, input: z.infer<typeof renameProjectInput>) {
  await requireOwner(actor, input.projectId);
  await db.update(projects).set({ title: input.title }).where(eq(projects.id, input.projectId));
  return { ok: true };
}

/** Deletes the project and everything in it. Its owner, or an admin of its organization. */
export async function deleteProject(actor: Actor, projectId: string, bucket: R2Bucket) {
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.orgId, actor.orgId)));
  if (!project) throw new NotFound("Project not found");
  if (project.ownerId !== actor.id && !actor.admin) {
    await projectAccess(actor, projectId);
    throw new NotFound("Project not found");
  }

  await db.batch([
    db.delete(media).where(eq(media.projectId, projectId)),
    db.delete(revisions).where(eq(revisions.projectId, projectId)),
    db.delete(agentMessages).where(eq(agentMessages.projectId, projectId)),
    db.delete(scenes).where(eq(scenes.projectId, projectId)),
    db.delete(shots).where(eq(shots.projectId, projectId)),
    db.delete(comments).where(eq(comments.projectId, projectId)),
    db.delete(reviewLinks).where(eq(reviewLinks.projectId, projectId)),
    db.delete(exportsTable).where(eq(exportsTable.projectId, projectId)),
    db.delete(projectMembers).where(eq(projectMembers.projectId, projectId)),
    db.delete(projects).where(eq(projects.id, projectId)),
  ]);
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: `${projectId}/`, cursor });
    if (page.objects.length) await bucket.delete(page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return { ok: true };
}

// ---- Sharing ----

export const shareInput = z
  .object({
    projectId: z.string(),
    email: z.string().trim().toLowerCase().email("Enter an email address"),
    role: z.enum(["editor", "viewer"]),
  })
  .strict();
export const unshareInput = z.object({ projectId: z.string(), email: z.string() }).strict();

export async function listShares(actor: Actor, projectId: string) {
  await projectAccess(actor, projectId);
  return db
    .select({ email: projectMembers.email, role: projectMembers.role, joined: projectMembers.userId })
    .from(projectMembers)
    .where(eq(projectMembers.projectId, projectId))
    .orderBy(projectMembers.createdAt);
}

export async function share(actor: Actor, input: z.infer<typeof shareInput>) {
  const { project } = await requireOwner(actor, input.projectId);
  if (input.email === actor.email) throw new Error("You already own this project.");
  const [known] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, input.email), eq(users.orgId, project.orgId)));
  await db
    .insert(projectMembers)
    .values({ projectId: input.projectId, email: input.email, role: input.role, userId: known?.id ?? null })
    .onConflictDoUpdate({
      target: [projectMembers.projectId, projectMembers.email],
      set: { role: input.role },
    });
  return { ok: true };
}

export async function unshare(actor: Actor, input: z.infer<typeof unshareInput>) {
  await requireOwner(actor, input.projectId);
  await db
    .delete(projectMembers)
    .where(and(eq(projectMembers.projectId, input.projectId), eq(projectMembers.email, input.email)));
  return { ok: true };
}

