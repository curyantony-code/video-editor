import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Pause, Play, Plus, Scissors, Trash2, Type, Undo2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { CommentsPanel } from "@/client/components/CommentsPanel";
import { AgentPanel } from "@/client/components/AgentPanel";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/client/components/ui/select";
import { useRoom } from "@/client/lib/useRoom";
import {
  applyOperations,
  formatFrames,
  timelineFrames,
  timelineProblem,
  type Clip,
  type Operation,
  type Timeline,
  type Track,

} from "@/lib/timeline";
import { getEditor, saveTimeline, undoTimeline } from "@/serverFunctions/app";
import { projectRoute } from "../$projectId";

export const Route = createFileRoute("/projects/$projectId/")({
  ssr: false,
  loader: ({ params }) => getEditor({ data: { projectId: params.projectId } }),
  component: Editor,
});

type EditorData = Awaited<ReturnType<typeof getEditor>>;
const PX_PER_SECOND = 80;

function Editor() {
  const project = projectRoute.useLoaderData();
  const data = Route.useLoaderData();
  const router = useRouter();
  const canEdit = project.role !== "viewer";
  const fps = project.fps;
  const ppf = PX_PER_SECOND / fps;
  const [timeline, setTimeline] = useState<Timeline>(data.timeline);
  const [revision, setRevision] = useState(data.revision);
  const [selected, setSelected] = useState<string | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const saving = useRef(false);
  const revisionRef = useRef(revision);
  revisionRef.current = revision;

  useEffect(() => {
    if (data.revision !== revisionRef.current || !saving.current) {
      setTimeline(data.timeline);
      setRevision(data.revision);
    }
  }, [data]);

  const people = useRoom(project.id, (message) => {
    if (message.what === "timeline" && message.revision === revisionRef.current) return;
    void router.invalidate();
  });

  const mediaInfo = data.media;
  const byId = useMemo(() => new Map(mediaInfo.map((m) => [m.id, m])), [mediaInfo]);
  const total = timelineFrames(timeline);

  async function commit(next: Timeline) {
    const problem = timelineProblem(next, mediaInfo, fps);
    if (problem) {
      toast.error(problem);
      return false;
    }
    const before = { timeline, revision };
    setTimeline(next);
    saving.current = true;
    try {
      const result = await saveTimeline({ data: { projectId: project.id, baseRevision: revisionRef.current, timeline: next } });
      setRevision(result.revision);
      revisionRef.current = result.revision;
      return true;
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "The change wasn't saved.");
      setTimeline(before.timeline);
      await router.invalidate();
      return false;
    } finally {
      saving.current = false;
    }
  }

  function apply(ops: Operation[]) {
    try {
      return commit(applyOperations(timeline, ops, mediaInfo, fps));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "That edit can't be made.");
      return Promise.resolve(false);
    }
  }

  async function undo() {
    try {
      const result = await undoTimeline({ data: { projectId: project.id, baseRevision: revisionRef.current } });
      setTimeline(result.timeline);
      setRevision(result.revision);
      revisionRef.current = result.revision;
      setSelected(null);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Nothing to undo.");
    }
  }

  // Playback: the playhead advances in real time.
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const advance = ((now - last) / 1000) * fps;
      last = now;
      setPlayhead((p) => {
        const next = p + advance;
        if (next >= Math.max(total, 1)) {
          setPlaying(false);
          return Math.max(total, 1);
        }
        return next;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, fps, total]);

  const selectedClip = useMemo(() => {
    for (const t of timeline.tracks) for (const c of t.clips) if (c.id === selected) return { track: t, clip: c };
    return null;
  }, [timeline, selected]);

  const width = Math.max(total + fps * 10, fps * 30) * ppf;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" data-testid="revision">
          Revision {revision}
        </Badge>
        <div data-testid="presence" className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
          {people.length > 0 ? <span>Here now:</span> : null}
          {people.map((p) => (
            <Badge key={p} variant={p === project.me ? "outline" : "default"}>
              {p}
            </Badge>
          ))}
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-4 min-w-0">
          <Preview aspect={project.aspect} timeline={timeline} playhead={playhead} playing={playing} fps={fps} byId={byId} />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" data-testid="play" onClick={() => {
              if (!playing && playhead >= total) setPlayhead(0);
              setPlaying((p) => !p);
            }}>
              {playing ? <Pause aria-hidden /> : <Play aria-hidden />} {playing ? "Pause" : "Play"}
            </Button>
            <span className="font-mono text-sm tabular-nums" data-testid="playhead-time">
              {formatFrames(Math.round(playhead), fps)}
            </span>
            <span className="text-sm text-muted-foreground">/ {formatFrames(total, fps)}</span>
            {canEdit ? (
              <div className="ms-auto flex flex-wrap items-center gap-1">
                <Button size="sm" variant="ghost" data-testid="add-text" onClick={async () => {
                  const before = new Set(timeline.tracks.flatMap((t) => t.clips.map((c) => c.id)));
                  const next = applyOperations(timeline, [{ op: "add_text", text: "Title", start: Math.round(playhead), duration: fps * 3, position: "center" }], mediaInfo, fps);
                  const added = next.tracks.flatMap((t) => t.clips).find((c) => !before.has(c.id));
                  if (await commit(next)) setSelected(added?.id ?? null);
                }}>
                  <Type aria-hidden /> Text
                </Button>
                <Button size="sm" variant="ghost" data-testid="split-clip" disabled={!selectedClip} onClick={() => selectedClip && apply([{ op: "split_clip", clipId: selectedClip.clip.id, at: Math.round(playhead) }])}>
                  <Scissors aria-hidden /> Split
                </Button>
                <Button size="sm" variant="ghost" data-testid="delete-clip" disabled={!selectedClip} onClick={async () => {
                  if (selectedClip && (await apply([{ op: "delete_clip", clipId: selectedClip.clip.id }]))) setSelected(null);
                }}>
                  <Trash2 aria-hidden /> Delete
                </Button>
                <Button size="sm" variant="ghost" data-testid="undo" disabled={revision === 0} onClick={undo}>
                  <Undo2 aria-hidden /> Undo
                </Button>
              </div>
            ) : null}
          </div>
          <div data-testid="timeline" className="overflow-x-auto rounded-lg border border-border bg-card">
            <div style={{ width: width + 112 }} className="relative">
              <div className="flex border-b border-border">
                <div className="w-28 shrink-0" />
                <div
                  data-testid="ruler"
                  className="relative h-7 cursor-pointer"
                  style={{ width }}
                  onPointerDown={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setPlayhead(Math.max(0, Math.round((e.clientX - rect.left) / ppf)));
                  }}
                >
                  {Array.from({ length: Math.ceil(width / PX_PER_SECOND) }, (_, s) => (
                    <span key={s} className="absolute top-1 text-xs text-muted-foreground" style={{ left: s * PX_PER_SECOND + 2 }}>
                      {s % 5 === 0 ? `${s}s` : "·"}
                    </span>
                  ))}
                </div>
              </div>
              {timeline.tracks.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">Add media from the bin, or a track below.</p>
              ) : null}
              {timeline.tracks.map((track) => (
                <TrackRow
                  key={track.id}
                  track={track}
                  ppf={ppf}
                  width={width}
                  selected={selected}
                  canEdit={canEdit}
                  byId={byId}
                  onSelect={setSelected}
                  onRemove={() => apply([{ op: "remove_track", trackId: track.id }])}
                  onChange={(clipId, change) => {
                    const ops: Operation[] =
                      change.kind === "move"
                        ? [{ op: "move_clip", clipId, start: change.start }]
                        : [{ op: "trim_clip", clipId, start: change.start, in: change.in, duration: change.duration }];
                    void apply(ops);
                  }}
                />
              ))}
              <div className="pointer-events-none absolute top-0 bottom-0 w-px bg-primary" style={{ left: 112 + playhead * ppf }} />
            </div>
          </div>
          {canEdit ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">Add track</span>
              {(["video", "audio", "text"] as const).map((kind) => (
                <Button key={kind} size="sm" variant="outline" data-testid={`add-track-${kind}`} onClick={() => apply([{ op: "add_track", kind }])}>
                  <Plus aria-hidden /> {kind[0]!.toUpperCase() + kind.slice(1)}
                </Button>
              ))}
            </div>
          ) : null}
          {canEdit && selectedClip ? (
            <Inspector key={selectedClip.clip.id + revision} track={selectedClip.track} clip={selectedClip.clip} fps={fps} onApply={(ops) => apply(ops)} onClose={() => setSelected(null)} />
          ) : null}
        </div>
        <div className="space-y-6 min-w-0">
          <Bin media={data.media} canEdit={canEdit} onAdd={(mediaId) => apply([{ op: "add_clip", mediaId }])} />
          {canEdit ? (
            <AgentPanel projectId={project.id} messages={data.messages} aiOff={data.aiOff} revision={revision} onChanged={() => router.invalidate()} />
          ) : null}
          <CommentsPanel projectId={project.id} comments={data.comments} playhead={playhead / fps} onSeek={(s) => setPlayhead(s * fps)} onChanged={() => router.invalidate()} />
        </div>
      </div>
    </div>
  );
}

function Bin({ media, canEdit, onAdd }: { media: EditorData["media"]; canEdit: boolean; onAdd: (id: string) => void }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">Media</h2>
      {media.length === 0 ? <p className="text-sm text-muted-foreground">Upload files on the Media tab.</p> : null}
      <ul className="space-y-1">
        {media.map((m) => (
          <li key={m.id} data-testid="bin-item" className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1">
            <span className="truncate text-sm">{m.name}</span>
            {canEdit ? (
              <Button size="icon-xs" variant="ghost" aria-label={`Add ${m.name} to the timeline`} data-testid="add-to-timeline" onClick={() => onAdd(m.id)}>
                <Plus aria-hidden />
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

type Change = { kind: "move"; start: number } | { kind: "trim"; start: number; in: number; duration: number };

function TrackRow({ track, ppf, width, selected, canEdit, byId, onSelect, onRemove, onChange }: {
  track: Track; ppf: number; width: number; selected: string | null; canEdit: boolean;
  byId: Map<string, EditorData["media"][number]>;
  onSelect: (id: string) => void; onRemove: () => void; onChange: (clipId: string, change: Change) => void;
}) {
  const [drag, setDrag] = useState<{ id: string; mode: "move" | "start" | "end"; x: number; dx: number } | null>(null);

  function preview(clip: Clip) {
    if (!drag || drag.id !== clip.id) return clip;
    const df = Math.round(drag.dx / ppf);
    if (drag.mode === "move") return { ...clip, start: Math.max(0, clip.start + df) };
    if (drag.mode === "end") return { ...clip, duration: Math.max(1, clip.duration + df) };
    const d = Math.min(clip.duration - 1, Math.max(df, -clip.in, -clip.start));
    return { ...clip, start: clip.start + d, in: clip.in + d, duration: clip.duration - d };
  }

  function begin(e: React.PointerEvent, clip: Clip, mode: "move" | "start" | "end") {
    e.stopPropagation();
    onSelect(clip.id);
    if (!canEdit) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ id: clip.id, mode, x: e.clientX, dx: 0 });
  }
  function move(e: React.PointerEvent) {
    if (drag) setDrag({ ...drag, dx: e.clientX - drag.x });
  }
  function end(clip: Clip) {
    if (!drag) return;
    const next = preview(clip);
    setDrag(null);
    if (Math.abs(drag.dx) < 3) return;
    if (drag.mode === "move") onChange(clip.id, { kind: "move", start: next.start });
    else onChange(clip.id, { kind: "trim", start: next.start, in: next.in, duration: next.duration });
  }

  return (
    <div data-testid="track" className="flex border-b border-border last:border-b-0">
      <div className="flex w-28 shrink-0 items-center justify-between gap-1 border-e border-border px-2" data-kind={track.kind}>
        <span className="truncate text-xs font-medium">{track.name}</span>
        {canEdit ? (
          <Button size="icon-xs" variant="ghost" aria-label={`Remove ${track.name}`} data-testid="remove-track" onClick={onRemove}>
            <X aria-hidden />
          </Button>
        ) : null}
      </div>
      <div className="relative h-12" style={{ width }}>
        {track.clips.map((raw) => {
          const clip = preview(raw);
          const m = clip.mediaId ? byId.get(clip.mediaId) : undefined;
          return (
            <div
              key={clip.id}
              data-testid="clip"
              data-id={clip.id}
              data-kind={track.kind}
              data-start={raw.start}
              data-duration={raw.duration}
              className={`absolute top-1 bottom-1 flex touch-none items-center overflow-hidden rounded-md border text-xs select-none ${
                selected === clip.id ? "border-primary ring-2 ring-primary/40" : "border-border"
              } ${track.kind === "audio" ? "bg-secondary" : track.kind === "text" ? "bg-accent" : "bg-muted"}`}
              style={{ left: clip.start * ppf, width: Math.max(4, clip.duration * ppf) }}
              onPointerDown={(e) => begin(e, raw, "move")}
              onPointerMove={move}
              onPointerUp={() => end(raw)}
            >
              {canEdit ? (
                <span data-testid="trim-start" className="absolute inset-y-0 start-0 w-2 cursor-ew-resize bg-foreground/10" onPointerDown={(e) => begin(e, raw, "start")} />
              ) : null}
              <span className="truncate px-3">{m ? m.name : clip.text}</span>
              {canEdit ? (
                <span data-testid="trim-end" className="absolute inset-y-0 end-0 w-2 cursor-ew-resize bg-foreground/10" onPointerDown={(e) => begin(e, raw, "end")} />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Inspector({ track, clip, fps, onApply, onClose }: { track: Track; clip: Clip; fps: number; onApply: (ops: Operation[]) => void; onClose: () => void }) {
  const [text, setText] = useState(clip.text);
  const [position, setPosition] = useState(clip.position);
  const [volume, setVolume] = useState(String(Math.round(clip.volume * 100)));
  const ops: Operation[] =
    track.kind === "text"
      ? [{ op: "set_text", clipId: clip.id, text, position }]
      : [{ op: "set_volume", clipId: clip.id, volume: Math.min(100, Math.max(0, Number(volume) || 0)) / 100 }];
  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Clip</h2>
        <span className="text-xs text-muted-foreground">
          {formatFrames(clip.start, fps)} · {formatFrames(clip.duration, fps)} long
        </span>
      </div>
      {track.kind === "text" ? (
        <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
          <div className="space-y-1">
            <Label htmlFor="clip-text">Text</Label>
            <Input id="clip-text" data-testid="clip-text" value={text} maxLength={500} onChange={(e) => setText(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Position</Label>
            <Select value={position} onValueChange={(v) => v && setPosition(v as typeof position)}>
              <SelectTrigger data-testid="clip-position" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="top">Top</SelectItem>
                <SelectItem value="center">Center</SelectItem>
                <SelectItem value="bottom">Bottom</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      ) : (
        <div className="max-w-40 space-y-1">
          <Label htmlFor="clip-volume">Volume (%)</Label>
          <Input id="clip-volume" data-testid="clip-volume" type="number" min={0} max={100} value={volume} onChange={(e) => setVolume(e.target.value)} />
        </div>
      )}
      <div className="flex gap-2">
        <Button size="sm" data-testid="apply-clip" onClick={() => onApply(ops)}>
          Apply
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    </section>
  );
}

function Preview({ aspect, timeline, playhead, playing, fps, byId }: {
  aspect: string; timeline: Timeline; playhead: number; playing: boolean; fps: number;
  byId: Map<string, EditorData["media"][number]>;
}) {
  const at = (t: Track) => t.clips.find((c) => playhead >= c.start && playhead < c.start + c.duration);
  const visual = timeline.tracks.filter((t) => t.kind === "video").map((t) => ({ t, c: at(t) })).find((x) => x.c);
  const texts = timeline.tracks.filter((t) => t.kind === "text").map(at).filter((c): c is Clip => !!c);
  const audios = timeline.tracks.filter((t) => t.kind === "audio").map(at).filter((c): c is Clip => !!c);
  const m = visual?.c?.mediaId ? byId.get(visual.c.mediaId) : undefined;
  const ratio = aspect === "9:16" ? "9 / 16" : aspect === "1:1" ? "1 / 1" : "16 / 9";
  return (
    <div data-testid="preview" className="relative mx-auto max-h-[38vh] overflow-hidden rounded-lg bg-foreground" style={{ aspectRatio: ratio, maxWidth: "100%" }}>
      {m && visual?.c ? (
        m.kind === "image" ? (
          <img src={`/api/media/${m.id}`} alt="" className="absolute inset-0 size-full object-contain" />
        ) : (
          <SyncedMedia kind="video" src={`/api/media/${m.id}`} time={(visual.c.in + playhead - visual.c.start) / fps} playing={playing} volume={visual.c.volume} />
        )
      ) : null}
      {audios.map((c) => (
        <SyncedMedia key={c.id} kind="audio" src={`/api/media/${c.mediaId}`} time={(c.in + playhead - c.start) / fps} playing={playing} volume={c.volume} />
      ))}
      {texts.map((c) => (
        <div key={c.id} className={`absolute inset-x-4 text-center text-lg font-semibold text-background md:text-2xl ${c.position === "top" ? "top-4" : c.position === "bottom" ? "bottom-4" : "top-1/2 -translate-y-1/2"}`}>
          {c.text}
        </div>
      ))}
    </div>
  );
}

function SyncedMedia({ kind, src, time, playing, volume }: { kind: "video" | "audio"; src: string; time: number; playing: boolean; volume: number }) {
  const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.volume = volume;
    if (!playing || Math.abs(el.currentTime - time) > 0.3) el.currentTime = time;
    if (playing && el.paused) void el.play().catch(() => undefined);
    if (!playing && !el.paused) el.pause();
  }, [time, playing, volume]);
  if (kind === "audio") return <audio ref={ref} src={src} preload="auto" />;
  return <video ref={ref} src={src} preload="auto" playsInline className="absolute inset-0 size-full object-contain" />;
}

