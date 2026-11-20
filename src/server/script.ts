import { asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { projects, scenes } from "@/db/schema";
import { type Actor, projectAccess, requireEditor } from "./access";
import { askJson } from "./ai";

export const sceneSchema = z.object({
  id: z.string().max(64).optional(),
  heading: z.string().max(300),
  action: z.string().max(10000),
  dialogue: z.string().max(10000),
});
export type Scene = z.infer<typeof sceneSchema>;

export async function getScript(actor: Actor, projectId: string) {
  const { project } = await projectAccess(actor, projectId);
  const rows = await db
    .select({ id: scenes.id, heading: scenes.heading, action: scenes.action, dialogue: scenes.dialogue })
    .from(scenes)
    .where(eq(scenes.projectId, projectId))
    .orderBy(asc(scenes.position));
  return { title: project.scriptTitle, scenes: rows };
}

export const saveScriptInput = z
  .object({ projectId: z.string(), title: z.string().max(200), scenes: z.array(sceneSchema).max(300) })
  .strict();

/** Saves the whole script: the title and the scenes in order. */
export async function saveScript(actor: Actor, input: z.infer<typeof saveScriptInput>) {
  await requireEditor(actor, input.projectId);
  const given = input.scenes.map((s) => s.id).filter((id): id is string => !!id);
  const taken = given.length
    ? new Set(
        (await db.select({ id: scenes.id, projectId: scenes.projectId }).from(scenes).where(inArray(scenes.id, given)))
          .filter((r) => r.projectId !== input.projectId)
          .map((r) => r.id),
      )
    : new Set<string>();
  const rows = input.scenes.map((s, position) => ({
    id: s.id && /^[0-9a-f-]{36}$/.test(s.id) && !taken.has(s.id) ? s.id : crypto.randomUUID(),
    projectId: input.projectId,
    position,
    heading: s.heading,
    action: s.action,
    dialogue: s.dialogue,
  }));
  const statements = [
    db.update(projects).set({ scriptTitle: input.title }).where(eq(projects.id, input.projectId)),
    db.delete(scenes).where(eq(scenes.projectId, input.projectId)),
    ...rows.map((r) => db.insert(scenes).values(r)),
  ];
  await db.batch(statements as never);
  return getScript(actor, input.projectId);
}

const SCENE_SHAPE = '{"heading": "INT./EXT. PLACE - TIME", "action": what we see, "dialogue": lines as "NAME: line", one per line}';

export const draftScriptInput = z.object({ projectId: z.string(), brief: z.string().trim().min(1).max(4000) }).strict();

export async function draftScript(actor: Actor, input: z.infer<typeof draftScriptInput>) {
  await requireEditor(actor, input.projectId);
  const answer = (await askJson(actor, "script_draft", `Write a short video script from the brief. Return {"title": string, "scenes": [${SCENE_SHAPE}]}.`, input.brief)) as { title?: unknown; scenes?: unknown };
  const parsed = z.array(sceneSchema.omit({ id: true })).max(60).safeParse(answer.scenes);
  if (!parsed.success) throw new Error("The draft came back in a form that can't be used. Try again.");
  return { title: typeof answer.title === "string" ? answer.title.slice(0, 200) : "", scenes: parsed.data };
}

export const rewriteSceneInput = z
  .object({ projectId: z.string(), scene: sceneSchema, instruction: z.string().trim().min(1).max(2000) })
  .strict();

export async function rewriteScene(actor: Actor, input: z.infer<typeof rewriteSceneInput>) {
  await requireEditor(actor, input.projectId);
  const answer = await askJson(actor, "scene_rewrite", `Rewrite the scene following the instruction. Return ${SCENE_SHAPE}.`, JSON.stringify({ scene: { heading: input.scene.heading, action: input.scene.action, dialogue: input.scene.dialogue }, instruction: input.instruction }));
  const parsed = sceneSchema.omit({ id: true }).safeParse(answer);
  if (!parsed.success) throw new Error("The rewrite came back in a form that can't be used. Try again.");
  return parsed.data;
}
