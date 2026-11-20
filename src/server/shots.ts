import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { scenes, shots } from "@/db/schema";
import { applyOperations, newId, type Timeline } from "@/lib/timeline";
import { type Actor, projectAccess, requireEditor } from "./access";
import { askJson } from "./ai";
import { mediaInfo } from "./media";
import { commitTimeline, readTimeline } from "./timeline";

export const FRAMINGS = ["wide", "medium", "close-up", "over-the-shoulder", "overhead"] as const;

export function shotImageKey(projectId: string, shotId: string) {
  return `${projectId}/shots/${shotId}`;
}

export async function listShots(actor: Actor, projectId: string) {
  await projectAccess(actor, projectId);
  return db
    .select()
    .from(shots)
    .where(eq(shots.projectId, projectId))
    .orderBy(asc(shots.position));
}

const shotFields = z.object({
  sceneId: z.string().max(64).nullable(),
  description: z.string().trim().min(1, "Describe the shot").max(2000),
  framing: z.enum(FRAMINGS),
  move: z.string().trim().max(200),
  duration: z.number().positive().max(3600),
});

export const saveShotInput = shotFields.extend({ projectId: z.string(), id: z.string().optional() }).strict();

async function checkScene(projectId: string, sceneId: string | null) {
  if (!sceneId) return null;
  const [row] = await db.select({ id: scenes.id }).from(scenes).where(and(eq(scenes.id, sceneId), eq(scenes.projectId, projectId)));
  return row ? row.id : null;
}

export async function saveShot(actor: Actor, input: z.infer<typeof saveShotInput>) {
  await requireEditor(actor, input.projectId);
  const values = {
    sceneId: await checkScene(input.projectId, input.sceneId),
    description: input.description,
    framing: input.framing,
    move: input.move,
    duration: input.duration,
  };
  if (input.id) {
    const [row] = await db
      .update(shots)
      .set(values)
      .where(and(eq(shots.id, input.id), eq(shots.projectId, input.projectId)))
      .returning({ id: shots.id });
    if (!row) throw new Error("No such shot in this project.");
    return { id: row.id };
  }
  const count = (await listShots(actor, input.projectId)).length;
  const id = crypto.randomUUID();
  await db.insert(shots).values({ id, projectId: input.projectId, position: count, ...values });
  return { id };
}

export const reorderShotsInput = z.object({ projectId: z.string(), ids: z.array(z.string()).max(500) }).strict();

export async function reorderShots(actor: Actor, input: z.infer<typeof reorderShotsInput>) {
  await requireEditor(actor, input.projectId);
  await db.batch(
    input.ids.map((id, position) =>
      db.update(shots).set({ position }).where(and(eq(shots.id, id), eq(shots.projectId, input.projectId))),
    ) as never,
  );
  return { ok: true };
}

export const shotIdInput = z.object({ projectId: z.string(), id: z.string() }).strict();

export async function deleteShot(actor: Actor, input: z.infer<typeof shotIdInput>, bucket: R2Bucket) {
  await requireEditor(actor, input.projectId);
  const [row] = await db
    .delete(shots)
    .where(and(eq(shots.id, input.id), eq(shots.projectId, input.projectId)))
    .returning({ id: shots.id });
  if (row) await bucket.delete(shotImageKey(input.projectId, row.id));
  return { ok: true };
}

/** The shot, when it belongs to a project the actor may see. */
export async function shotOf(actor: Actor, shotId: string) {
  const [row] = await db.select({ id: shots.id, projectId: shots.projectId }).from(shots).where(eq(shots.id, shotId));
  if (!row) return null;
  await projectAccess(actor, row.projectId);
  return row;
}

export async function setShotImage(projectId: string, shotId: string, has: boolean) {
  await db.update(shots).set({ hasImage: has }).where(and(eq(shots.id, shotId), eq(shots.projectId, projectId)));
}

export const breakdownInput = z.object({ projectId: z.string() }).strict();

/** Proposed shots from the script, for the person to review before saving. */
export async function breakdown(actor: Actor, input: z.infer<typeof breakdownInput>) {
  await requireEditor(actor, input.projectId);
  const list = await db
    .select({ id: scenes.id, heading: scenes.heading, action: scenes.action, dialogue: scenes.dialogue })
    .from(scenes)
    .where(eq(scenes.projectId, input.projectId))
    .orderBy(asc(scenes.position));
  if (!list.length) throw new Error("Write a script first: the breakdown starts from its scenes.");
  const answer = (await askJson(
    actor,
    "breakdown",
    `Break the script into camera shots. Return {"shots":[{"scene": scene number from 1, "description", "framing": one of ${FRAMINGS.join(", ")}, "move", "duration": seconds}]}.`,
    JSON.stringify(list.map((s, i) => ({ number: i + 1, ...s, id: undefined }))),
  )) as { shots?: unknown };
  const parsed = z
    .array(z.object({ scene: z.number().int().optional(), description: z.string(), framing: z.string(), move: z.string().default(""), duration: z.number().positive().max(3600) }))
    .max(200)
    .safeParse(answer.shots);
  if (!parsed.success) throw new Error("The breakdown came back in a form that can't be used. Try again.");
  return parsed.data.map((s) => ({
    sceneId: s.scene ? (list[s.scene - 1]?.id ?? null) : null,
    description: s.description.slice(0, 2000),
    framing: (FRAMINGS as readonly string[]).includes(s.framing) ? (s.framing as (typeof FRAMINGS)[number]) : "medium",
    move: s.move.slice(0, 200),
    duration: s.duration,
  }));
}

export const saveBreakdownInput = z
  .object({ projectId: z.string(), shots: z.array(shotFields).max(200) })
  .strict();

export async function saveBreakdown(actor: Actor, input: z.infer<typeof saveBreakdownInput>) {
  await requireEditor(actor, input.projectId);
  const start = (await listShots(actor, input.projectId)).length;
  const rows = [];
  for (const [i, s] of input.shots.entries())
    rows.push({ id: crypto.randomUUID(), projectId: input.projectId, position: start + i, ...s, sceneId: await checkScene(input.projectId, s.sceneId) });
  if (rows.length) await db.batch(rows.map((r) => db.insert(shots).values(r)) as never);
  return { ok: true };
}

/** One text clip per shot, in order, on a new text track. */
export async function sendToTimeline(actor: Actor, input: z.infer<typeof breakdownInput>) {
  const { project } = await requireEditor(actor, input.projectId);
  const list = await listShots(actor, input.projectId);
  if (!list.length) throw new Error("Add a shot first.");
  const timeline: Timeline = await readTimeline(project);
  const trackId = newId();
  let start = 0;
  const next = applyOperations(
    timeline,
    [
      { op: "add_track", kind: "text", name: "Storyboard" },
    ],
    await mediaInfo(project.id),
    project.fps,
  );
  const track = next.tracks[next.tracks.length - 1]!;
  track.id = trackId;
  for (const [i, s] of list.entries()) {
    const duration = Math.max(1, Math.round(s.duration * project.fps));
    track.clips.push({ id: newId(), mediaId: null, start, duration, in: 0, volume: 1, position: "bottom", text: `${i + 1}. ${s.description}`.slice(0, 500) });
    start += duration;
  }
  const revision = await commitTimeline(actor, project, project.revision, next, "storyboard");
  return { revision };
}
