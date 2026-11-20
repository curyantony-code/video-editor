import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { agentMessages, media } from "@/db/schema";
import { applyOperations, operationSchema, type Operation } from "@/lib/timeline";
import { type Actor, projectAccess, requireEditor } from "./access";
import { askJson } from "./ai";
import { mediaInfo } from "./media";
import { commitTimeline, readTimeline, restoreRevision } from "./timeline";

export async function listAgentMessages(actor: Actor, projectId: string) {
  await projectAccess(actor, projectId);
  const rows = await db
    .select()
    .from(agentMessages)
    .where(eq(agentMessages.projectId, projectId))
    .orderBy(asc(agentMessages.createdAt), asc(agentMessages.id));
  return rows.map((r) => ({
    id: r.id,
    role: r.role as "user" | "assistant",
    content: r.content,
    operations: r.operations ? (JSON.parse(r.operations) as Operation[]) : [],
    revision: r.revision,
  }));
}

const SYSTEM = `You edit a video timeline. Times are frames. Tracks are ordered top to bottom; the topmost visible clip shows.
Return {"reply": short sentence of what you did, "operations": [...]}. Operations:
{"op":"add_clip","mediaId","trackId"?,"start"?,"in"?,"duration"?}
{"op":"move_clip","clipId","start","trackId"?}
{"op":"trim_clip","clipId","in"?,"start"?,"duration"?}
{"op":"split_clip","clipId","at"}
{"op":"delete_clip","clipId"}
{"op":"add_text","text","start","duration","position"?("top"|"center"|"bottom"),"trackId"?}
{"op":"set_text","clipId","text"?,"position"?}
{"op":"set_volume","clipId","volume"(0..1)}
{"op":"add_track","kind"("video"|"audio"|"text"),"name"?}
{"op":"remove_track","trackId"}
{"op":"reorder_tracks","order":[trackIds]}
Clips on one track never overlap. in + duration never exceeds the media's length. Use only ids given.
If you can't do the request, return no operations and say why.`;

export const agentInput = z
  .object({ projectId: z.string(), request: z.string().trim().min(1).max(2000) })
  .strict();

/** One request to the agent: its operations land as one revision. */
// Both messages of one exchange are written together, so give them distinct
// times in the column's own format to keep the request ahead of the reply.
function stamp(offsetMs: number) {
  return new Date(Date.now() + offsetMs).toISOString().replace("T", " ").replace("Z", "");
}

export async function runAgent(actor: Actor, input: z.infer<typeof agentInput>) {
  const { project } = await requireEditor(actor, input.projectId);
  const timeline = await readTimeline(project);
  const items = await db
    .select({ id: media.id, name: media.name, kind: media.kind, duration: media.duration, note: media.note })
    .from(media)
    .where(eq(media.projectId, project.id));
  const history = (await listAgentMessages(actor, project.id)).slice(-10).map((m) => `${m.role}: ${m.content}`);
  const answer = (await askJson(
    actor,
    "agent",
    SYSTEM,
    JSON.stringify({
      fps: project.fps,
      aspect: project.aspect,
      timeline,
      media: items.map((m) => ({ ...m, frames: m.duration ? Math.round(m.duration * project.fps) : null })),
      earlier: history,
      request: input.request,
    }),
  )) as { reply?: unknown; operations?: unknown };
  const reply = typeof answer.reply === "string" ? answer.reply.slice(0, 2000) : "Done.";
  const parsed = z.array(operationSchema).max(100).safeParse(answer.operations ?? []);
  const userMessage = { id: crypto.randomUUID(), projectId: project.id, userId: actor.id, role: "user", content: input.request, createdAt: stamp(0) };
  if (!parsed.success) {
    await db.insert(agentMessages).values([
      userMessage,
      { id: crypto.randomUUID(), projectId: project.id, userId: actor.id, role: "assistant", createdAt: stamp(1), content: "The edit came back in a form that can't be applied. Try rephrasing." },
    ]);
    return { revision: project.revision };
  }
  let content = reply;
  let revision: number | null = null;
  if (parsed.data.length) {
    try {
      const next = applyOperations(timeline, parsed.data, await mediaInfo(project.id), project.fps);
      revision = await commitTimeline(actor, project, project.revision, next, "agent");
    } catch (error) {
      content = `That edit breaks a timeline rule, so nothing changed: ${error instanceof Error ? error.message : "unknown problem"}`;
    }
  }
  await db.insert(agentMessages).values([
    userMessage,
    {
      id: crypto.randomUUID(),
      projectId: project.id,
      userId: actor.id,
      role: "assistant",
      createdAt: stamp(1),
      content,
      operations: revision ? JSON.stringify(parsed.data) : null,
      revision,
    },
  ]);
  return { revision: revision ?? project.revision };
}

export const revertInput = z
  .object({ projectId: z.string(), revision: z.number().int().min(1), baseRevision: z.number().int() })
  .strict();

/** Reverts one agent revision: the state before it becomes the newest. */
export async function revertAgent(actor: Actor, input: z.infer<typeof revertInput>) {
  await requireEditor(actor, input.projectId);
  const [message] = await db
    .select({ id: agentMessages.id })
    .from(agentMessages)
    .where(and(eq(agentMessages.projectId, input.projectId), eq(agentMessages.revision, input.revision)));
  if (!message) throw new Error("No agent edit made that revision.");
  return restoreRevision(actor, { projectId: input.projectId, baseRevision: input.baseRevision, to: input.revision - 1 });
}

export const draftNoteInput = z
  .object({
    projectId: z.string(),
    mediaId: z.string(),
    frames: z.array(z.string().startsWith("data:image/").max(400_000)).min(1).max(6),
  })
  .strict();

/** A log note drafted from frames the browser sampled. */
export async function draftNote(actor: Actor, input: z.infer<typeof draftNoteInput>) {
  await requireEditor(actor, input.projectId);
  const [item] = await db
    .select({ name: media.name, kind: media.kind })
    .from(media)
    .where(and(eq(media.id, input.mediaId), eq(media.projectId, input.projectId)));
  if (!item) throw new Error("No such media in this project.");
  const answer = (await askJson(actor, "media_note", 'Write a log note for a video editor: what is visible, shot type, mood, in one or two sentences. Return {"note": string}.', [
    { type: "text", text: `File: ${item.name} (${item.kind}). Frames in order:` },
    ...input.frames.map((url) => ({ type: "image_url" as const, image_url: { url } })),
  ])) as { note?: unknown };
  return { note: typeof answer.note === "string" ? answer.note.slice(0, 4000) : "" };
}
