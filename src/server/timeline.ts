import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { projects, revisions } from "@/db/schema";
import {
  EMPTY_TIMELINE,
  timelineProblem,
  timelineSchema,
  type Timeline,
} from "@/lib/timeline";
import { type Actor, type Project, projectAccess, requireEditor } from "./access";
import { mediaInfo } from "./media";

export class StaleRevision extends Error {
  constructor() {
    super("Someone else changed the timeline. It has been reloaded.");
  }
}

export async function readTimeline(project: Project): Promise<Timeline> {
  if (project.revision === 0) return EMPTY_TIMELINE;
  const [row] = await db
    .select({ timeline: revisions.timeline })
    .from(revisions)
    .where(and(eq(revisions.projectId, project.id), eq(revisions.number, project.revision)));
  return row ? (JSON.parse(row.timeline) as Timeline) : EMPTY_TIMELINE;
}

export async function getTimeline(actor: Actor, projectId: string) {
  const { project } = await projectAccess(actor, projectId);
  return { revision: project.revision, timeline: await readTimeline(project) };
}

/**
 * Checks a timeline against the rules and saves it as the next revision.
 * The revision's number is unique per project, so two saves from the same
 * base can't both land: the second fails as stale.
 */
export async function commitTimeline(
  actor: Actor,
  project: Project,
  baseRevision: number,
  timeline: Timeline,
  source: string,
): Promise<number> {
  if (baseRevision !== project.revision) throw new StaleRevision();
  const parsed = timelineSchema.parse(timeline);
  const problem = timelineProblem(parsed, await mediaInfo(project.id), project.fps);
  if (problem) throw new Error(problem);
  const number = baseRevision + 1;
  try {
    await db.batch([
      db.insert(revisions).values({ projectId: project.id, number, timeline: JSON.stringify(parsed), source, authorId: actor.id }),
      db.update(projects).set({ revision: number }).where(and(eq(projects.id, project.id), eq(projects.revision, baseRevision))),
    ]);
  } catch (error) {
    if (String(error).includes("UNIQUE")) throw new StaleRevision();
    throw error;
  }
  return number;
}

export const saveTimelineInput = z
  .object({ projectId: z.string(), baseRevision: z.number().int().min(0), timeline: timelineSchema })
  .strict();

export async function saveTimeline(actor: Actor, input: z.infer<typeof saveTimelineInput>) {
  const { project } = await requireEditor(actor, input.projectId);
  const revision = await commitTimeline(actor, project, input.baseRevision, input.timeline, "edit");
  return { revision };
}

export const restoreInput = z
  .object({ projectId: z.string(), baseRevision: z.number().int(), to: z.number().int().min(0) })
  .strict();

/** Undo: saves the state of an earlier revision as a new one. */
export async function restoreRevision(actor: Actor, input: z.infer<typeof restoreInput>) {
  const { project } = await requireEditor(actor, input.projectId);
  if (input.to >= project.revision || input.to < 0) throw new Error("Nothing to undo.");
  let timeline = EMPTY_TIMELINE;
  if (input.to > 0) {
    const [row] = await db
      .select({ timeline: revisions.timeline })
      .from(revisions)
      .where(and(eq(revisions.projectId, project.id), eq(revisions.number, input.to)));
    if (!row) throw new Error("That revision doesn't exist.");
    timeline = JSON.parse(row.timeline) as Timeline;
  }
  const revision = await commitTimeline(actor, project, input.baseRevision, timeline, `restore:${input.to}`);
  return { revision, timeline };
}

export const undoInput = z.object({ projectId: z.string(), baseRevision: z.number().int() }).strict();

/** Goes back one step: an undo of an undo goes one further back. */
export async function undoTimeline(actor: Actor, input: z.infer<typeof undoInput>) {
  const { project } = await requireEditor(actor, input.projectId);
  if (project.revision === 0) throw new Error("Nothing to undo.");
  const [row] = await db
    .select({ source: revisions.source })
    .from(revisions)
    .where(and(eq(revisions.projectId, project.id), eq(revisions.number, project.revision)));
  const restored = row?.source.match(/^restore:(\d+)$/);
  const to = restored ? Number(restored[1]) - 1 : project.revision - 1;
  if (to < 0) throw new Error("Nothing to undo.");
  return restoreRevision(actor, { projectId: input.projectId, baseRevision: input.baseRevision, to });
}
