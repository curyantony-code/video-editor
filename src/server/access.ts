// Who may do what on a project. Every query below goes through here.
import { and, eq, isNull } from "drizzle-orm";
import { isAdmin, type EveryAppUser } from "@every-app/sdk/server";
import { db } from "@/db";
import { projectMembers, projects, users } from "@/db/schema";

export type Role = "owner" | "editor" | "viewer";
export type Project = typeof projects.$inferSelect;

export class NotFound extends Error {
  constructor(message = "Not found") {
    super(message);
  }
}
export class Forbidden extends Error {
  constructor(message = "You can't change this project.") {
    super(message);
  }
}

export interface Actor {
  id: string;
  email: string;
  orgId: string;
  admin: boolean;
}

/** The verified Gateway user, recorded on first sight; pending shares to their email are claimed. */
export async function actorOf(user: EveryAppUser): Promise<Actor> {
  const email = user.email.toLowerCase();
  await db.batch([
    db
      .insert(users)
      .values({ id: user.id, orgId: user.orgId, email })
      .onConflictDoUpdate({ target: users.id, set: { email, orgId: user.orgId } }),
    db
      .update(projectMembers)
      .set({ userId: user.id })
      .where(and(eq(projectMembers.email, email), isNull(projectMembers.userId))),
  ]);
  return { id: user.id, email, orgId: user.orgId, admin: isAdmin(user) };
}

/** The project and the actor's role on it, or NotFound when they have none. */
export async function projectAccess(
  actor: Actor,
  projectId: string,
): Promise<{ project: Project; role: Role }> {
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.orgId, actor.orgId)));
  if (!project) throw new NotFound("Project not found");
  if (project.ownerId === actor.id) return { project, role: "owner" };
  const [share] = await db
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, actor.id)));
  if (!share) throw new NotFound("Project not found");
  return { project, role: share.role === "editor" ? "editor" : "viewer" };
}

export async function requireEditor(actor: Actor, projectId: string) {
  const access = await projectAccess(actor, projectId);
  if (access.role === "viewer") throw new Forbidden();
  return access;
}

export async function requireOwner(actor: Actor, projectId: string) {
  const access = await projectAccess(actor, projectId);
  if (access.role !== "owner") throw new Forbidden("Only the project's owner can do this.");
  return access;
}

/** A JSON error response for a server route. */
export function errorResponse(error: unknown): Response {
  if (error instanceof NotFound) return Response.json({ error: error.message }, { status: 404 });
  if (error instanceof Forbidden) return Response.json({ error: error.message }, { status: 403 });
  throw error;
}
