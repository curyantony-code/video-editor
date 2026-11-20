// The timeline, shared by the editor, the server and the agent. Times are
// frames at the project's frame rate.
import { z } from "zod";

export const TRACK_KINDS = ["video", "audio", "text"] as const;
export type TrackKind = (typeof TRACK_KINDS)[number];
export const TEXT_POSITIONS = ["top", "center", "bottom"] as const;

export const clipSchema = z
  .object({
    id: z.string().min(1).max(64),
    start: z.number().int().min(0),
    duration: z.number().int().min(1),
    mediaId: z.string().max(64).nullable().default(null),
    in: z.number().int().min(0).default(0),
    volume: z.number().min(0).max(1).default(1),
    text: z.string().max(500).default(""),
    position: z.enum(TEXT_POSITIONS).default("center"),
  })
  .strict();
export const trackSchema = z
  .object({
    id: z.string().min(1).max(64),
    kind: z.enum(TRACK_KINDS),
    name: z.string().max(80),
    clips: z.array(clipSchema).max(500),
  })
  .strict();
export const timelineSchema = z
  .object({ tracks: z.array(trackSchema).max(32) })
  .strict();

export type Clip = z.infer<typeof clipSchema>;
export type Track = z.infer<typeof trackSchema>;
export type Timeline = z.infer<typeof timelineSchema>;

export interface MediaInfo {
  id: string;
  name: string;
  kind: string;
  duration: number | null;
}

export const EMPTY_TIMELINE: Timeline = { tracks: [] };

/** Which track kind a media kind goes on. */
export function trackKindFor(mediaKind: string): TrackKind {
  return mediaKind === "audio" ? "audio" : "video";
}

/** A media item's length in frames, or null for a still image. */
export function mediaFrames(m: MediaInfo, fps: number): number | null {
  if (m.kind === "image" || m.duration == null) return null;
  return Math.max(1, Math.round(m.duration * fps));
}

/** The first rule the timeline breaks, or null when it keeps them all. */
export function timelineProblem(
  timeline: Timeline,
  media: MediaInfo[],
  fps: number,
): string | null {
  const byId = new Map(media.map((m) => [m.id, m]));
  const ids = new Set<string>();
  for (const track of timeline.tracks) {
    if (ids.has(track.id)) return "Two tracks share an id.";
    ids.add(track.id);
    const sorted = [...track.clips].sort((a, b) => a.start - b.start);
    for (let i = 0; i < sorted.length; i++) {
      const clip = sorted[i]!;
      if (ids.has(clip.id)) return "Two clips share an id.";
      ids.add(clip.id);
      if (i > 0) {
        const prev = sorted[i - 1]!;
        if (prev.start + prev.duration > clip.start)
          return `Clips overlap on track "${track.name}".`;
      }
      if (track.kind === "text") {
        if (clip.mediaId) return "A text track holds only text clips.";
        continue;
      }
      if (!clip.mediaId) return `A clip on "${track.name}" has no media.`;
      const m = byId.get(clip.mediaId);
      if (!m) return "A clip uses media that isn't in this project.";
      if (trackKindFor(m.kind) !== track.kind)
        return `${m.name} can't go on a ${track.kind} track.`;
      const length = mediaFrames(m, fps);
      if (length != null && clip.in + clip.duration > length)
        return `A clip of ${m.name} runs past the end of the file.`;
    }
  }
  return null;
}

/** The timeline's length in frames. */
export function timelineFrames(timeline: Timeline): number {
  let end = 0;
  for (const track of timeline.tracks)
    for (const clip of track.clips) end = Math.max(end, clip.start + clip.duration);
  return end;
}

export function newId(): string {
  return crypto.randomUUID().slice(0, 13);
}

export function clone(timeline: Timeline): Timeline {
  return JSON.parse(JSON.stringify(timeline)) as Timeline;
}

/** The end of the last clip on a track. */
export function trackEnd(track: Track): number {
  return track.clips.reduce((end, c) => Math.max(end, c.start + c.duration), 0);
}

// ---- Operations: what an edit, or the agent, does to a timeline. ----

export const operationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add_clip"), mediaId: z.string(), trackId: z.string().optional(), start: z.number().optional(), in: z.number().optional(), duration: z.number().optional() }),
  z.object({ op: z.literal("move_clip"), clipId: z.string(), start: z.number(), trackId: z.string().optional() }),
  z.object({ op: z.literal("trim_clip"), clipId: z.string(), in: z.number().optional(), duration: z.number().optional(), start: z.number().optional() }),
  z.object({ op: z.literal("split_clip"), clipId: z.string(), at: z.number() }),
  z.object({ op: z.literal("delete_clip"), clipId: z.string() }),
  z.object({ op: z.literal("add_text"), text: z.string().min(1).max(500), start: z.number(), duration: z.number(), position: z.enum(TEXT_POSITIONS).optional(), trackId: z.string().optional() }),
  z.object({ op: z.literal("set_text"), clipId: z.string(), text: z.string().max(500).optional(), position: z.enum(TEXT_POSITIONS).optional() }),
  z.object({ op: z.literal("set_volume"), clipId: z.string(), volume: z.number().min(0).max(1) }),
  z.object({ op: z.literal("add_track"), kind: z.enum(TRACK_KINDS), name: z.string().max(80).optional() }),
  z.object({ op: z.literal("remove_track"), trackId: z.string() }),
  z.object({ op: z.literal("reorder_tracks"), order: z.array(z.string()) }),
]);
export type Operation = z.infer<typeof operationSchema>;

export const OPERATION_LABELS: Record<Operation["op"], string> = {
  add_clip: "Add clip",
  move_clip: "Move clip",
  trim_clip: "Trim clip",
  split_clip: "Split clip",
  delete_clip: "Delete clip",
  add_text: "Add text",
  set_text: "Change text",
  set_volume: "Set volume",
  add_track: "Add track",
  remove_track: "Remove track",
  reorder_tracks: "Reorder tracks",
};

function findClip(t: Timeline, clipId: string) {
  for (const track of t.tracks) {
    const index = track.clips.findIndex((c) => c.id === clipId);
    if (index >= 0) return { track, index, clip: track.clips[index]! };
  }
  throw new Error(`No clip with id ${clipId}.`);
}

function trackName(t: Timeline, kind: TrackKind): string {
  const n = t.tracks.filter((x) => x.kind === kind).length + 1;
  return `${kind[0]!.toUpperCase()}${kind.slice(1)} ${n}`;
}

function frames(value: number): number {
  return Math.max(0, Math.round(value));
}

/** Applies operations to a copy of the timeline. Throws on one that can't apply. */
export function applyOperations(
  timeline: Timeline,
  operations: Operation[],
  media: MediaInfo[],
  fps: number,
): Timeline {
  const t = clone(timeline);
  for (const op of operations) {
    switch (op.op) {
      case "add_track":
        t.tracks.push({ id: newId(), kind: op.kind, name: op.name || trackName(t, op.kind), clips: [] });
        break;
      case "remove_track":
        t.tracks = t.tracks.filter((x) => x.id !== op.trackId);
        break;
      case "reorder_tracks": {
        const rank = new Map(op.order.map((id, i) => [id, i]));
        t.tracks.sort((a, b) => (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999));
        break;
      }
      case "add_clip": {
        const m = media.find((x) => x.id === op.mediaId);
        if (!m) throw new Error(`No media with id ${op.mediaId}.`);
        const kind = trackKindFor(m.kind);
        let track = op.trackId ? t.tracks.find((x) => x.id === op.trackId) : t.tracks.find((x) => x.kind === kind);
        if (!track) {
          track = { id: newId(), kind, name: trackName(t, kind), clips: [] };
          t.tracks.push(track);
        }
        const length = mediaFrames(m, fps);
        const inPoint = frames(op.in ?? 0);
        const duration = frames(op.duration ?? (length != null ? length - inPoint : fps * 3));
        track.clips.push({
          id: newId(),
          mediaId: m.id,
          start: op.start == null ? trackEnd(track) : frames(op.start),
          in: inPoint,
          duration: Math.max(1, duration),
          volume: 1,
          text: "",
          position: "center",
        });
        break;
      }
      case "add_text": {
        let track = op.trackId ? t.tracks.find((x) => x.id === op.trackId) : undefined;
        const start = frames(op.start);
        const duration = Math.max(1, frames(op.duration));
        if (!track) {
          // The first text track with room, else a new one on top.
          track = t.tracks.find((x) => x.kind === "text" && x.clips.every((c) => c.start + c.duration <= start || c.start >= start + duration));
        }
        if (!track) {
          track = { id: newId(), kind: "text", name: trackName(t, "text"), clips: [] };
          t.tracks.unshift(track);
        }
        track.clips.push({ id: newId(), mediaId: null, start, duration, in: 0, volume: 1, text: op.text, position: op.position ?? "center" });
        break;
      }
      case "move_clip": {
        const found = findClip(t, op.clipId);
        found.clip.start = frames(op.start);
        if (op.trackId && op.trackId !== found.track.id) {
          const target = t.tracks.find((x) => x.id === op.trackId);
          if (!target) throw new Error(`No track with id ${op.trackId}.`);
          found.track.clips.splice(found.index, 1);
          target.clips.push(found.clip);
        }
        break;
      }
      case "trim_clip": {
        const { clip } = findClip(t, op.clipId);
        if (op.in != null) clip.in = frames(op.in);
        if (op.start != null) clip.start = frames(op.start);
        if (op.duration != null) clip.duration = Math.max(1, frames(op.duration));
        break;
      }
      case "split_clip": {
        const { track, clip } = findClip(t, op.clipId);
        const at = frames(op.at);
        if (at <= clip.start || at >= clip.start + clip.duration)
          throw new Error("The split point is outside the clip.");
        const first = at - clip.start;
        track.clips.push({ ...clip, id: newId(), start: at, in: clip.in + first, duration: clip.duration - first });
        clip.duration = first;
        break;
      }
      case "delete_clip": {
        const found = findClip(t, op.clipId);
        found.track.clips.splice(found.index, 1);
        break;
      }
      case "set_text": {
        const { clip } = findClip(t, op.clipId);
        if (op.text != null) clip.text = op.text;
        if (op.position) clip.position = op.position;
        break;
      }
      case "set_volume": {
        const { clip } = findClip(t, op.clipId);
        clip.volume = op.volume;
        break;
      }
    }
  }
  for (const track of t.tracks) track.clips.sort((a, b) => a.start - b.start);
  return t;
}

/** "1:05" from seconds. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** "0:01.50" from frames. */
export function formatFrames(frame: number, fps: number): string {
  const seconds = frame / fps;
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
}
