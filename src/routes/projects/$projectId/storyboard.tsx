import { createFileRoute, useRouter } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, Clapperboard, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import { EmptyState } from "@/client/components/EmptyState";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Card, CardContent } from "@/client/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/client/components/ui/dialog";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/client/components/ui/select";
import { Textarea } from "@/client/components/ui/textarea";
import { formatDuration } from "@/lib/timeline";
import { breakdownScript, deleteShot, getStoryboard, reorderShots, saveBreakdown, saveShot, sendToTimeline } from "@/serverFunctions/app";
import { projectRoute } from "../$projectId";
import { AiOffNote } from "./media";

export const Route = createFileRoute("/projects/$projectId/storyboard")({
  loader: ({ params }) => getStoryboard({ data: { projectId: params.projectId } }),
  component: StoryboardPage,
});

type Data = Awaited<ReturnType<typeof getStoryboard>>;
type Shot = Data["shots"][number];
type Proposed = Awaited<ReturnType<typeof breakdownScript>> extends infer R ? (R extends { off: false; result: infer T } ? T : never) : never;

const FRAMINGS = [
  ["wide", "Wide"],
  ["medium", "Medium"],
  ["close-up", "Close-up"],
  ["over-the-shoulder", "Over the shoulder"],
  ["overhead", "Overhead"],
] as const;
const FRAMING_LABEL = Object.fromEntries(FRAMINGS) as Record<string, string>;

function StoryboardPage() {
  const project = projectRoute.useLoaderData();
  const { shots, scenes, aiOff: initialAiOff } = Route.useLoaderData();
  const router = useRouter();
  const canEdit = project.role !== "viewer";
  const [editing, setEditing] = useState<Shot | "new" | null>(null);
  const [deleting, setDeleting] = useState<Shot | null>(null);
  const [proposed, setProposed] = useState<Proposed | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [aiOff, setAiOff] = useState(initialAiOff);
  const [sent, setSent] = useState(false);
  const total = shots.reduce((n, s) => n + s.duration, 0);
  const sceneLabel = (id: string | null) => {
    const i = scenes.findIndex((s) => s.id === id);
    return i >= 0 ? `Scene ${i + 1}${scenes[i]!.heading ? `: ${scenes[i]!.heading}` : ""}` : null;
  };

  async function run(name: string, work: () => Promise<unknown>) {
    setBusy(name);
    try {
      await work();
      await router.invalidate();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "That didn't work.");
    } finally {
      setBusy(null);
    }
  }

  async function reorder(i: number, by: number) {
    const ids = shots.map((s) => s.id);
    const [id] = ids.splice(i, 1);
    ids.splice(i + by, 0, id!);
    await run("reorder", () => reorderShots({ data: { projectId: project.id, ids } }));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground" data-testid="storyboard-total">
          {shots.length} {shots.length === 1 ? "shot" : "shots"} · {formatDuration(total)} planned
        </p>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" data-testid="breakdown" pending={busy === "breakdown"} onClick={() => run("breakdown", async () => {
              const result = await breakdownScript({ data: { projectId: project.id } });
              if (result.off) setAiOff(true);
              else {
                setAiOff(false);
                setProposed(result.result);
              }
            })}>
              <Sparkles aria-hidden /> Shots from script
            </Button>
            <Button variant="outline" data-testid="send-to-timeline" disabled={!shots.length} pending={busy === "send"} onClick={() => run("send", async () => {
              await sendToTimeline({ data: { projectId: project.id } });
              setSent(true);
            })}>
              <Clapperboard aria-hidden /> Send to timeline
            </Button>
            <Button data-testid="add-shot" onClick={() => setEditing("new")}>
              <Plus aria-hidden /> Shot
            </Button>
          </div>
        ) : null}
      </div>
      {sent ? (
        <p className="text-sm text-muted-foreground" data-testid="sent-to-timeline">
          Added to the timeline as a new text track.
        </p>
      ) : null}
      {aiOff && canEdit ? <AiOffNote /> : null}
      {proposed ? (
        <Card data-testid="breakdown-review" className="border-primary">
          <CardContent className="space-y-3">
            <p className="text-sm font-medium">Suggested shots</p>
            <ol className="list-inside list-decimal space-y-1 text-sm">
              {proposed.map((s, i) => (
                <li key={i}>
                  {s.description} <span className="text-muted-foreground">· {FRAMING_LABEL[s.framing]} · {s.move} · {s.duration}s</span>
                </li>
              ))}
            </ol>
            <div className="flex gap-2">
              <Button size="sm" data-testid="save-breakdown" pending={busy === "save-breakdown"} onClick={() => run("save-breakdown", async () => {
                await saveBreakdown({ data: { projectId: project.id, shots: proposed } });
                setProposed(null);
              })}>
                Add these shots
              </Button>
              <Button size="sm" variant="ghost" data-testid="discard-breakdown" onClick={() => setProposed(null)}>
                Discard
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
      {shots.length === 0 ? (
        <EmptyState title="No shots yet" description={canEdit ? "Add shots one by one, or have them suggested from the script." : undefined} />
      ) : (
        <ol className="grid gap-4 sm:grid-cols-2">
          {shots.map((shot, i) => (
            <li key={shot.id} data-testid="shot" className="space-y-2 rounded-lg border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="flex size-7 items-center justify-center rounded-full bg-muted text-sm font-semibold" data-testid="shot-number">
                    {i + 1}
                  </span>
                  <Badge variant="secondary">{FRAMING_LABEL[shot.framing]}</Badge>
                  <span className="text-sm text-muted-foreground">{shot.duration}s</span>
                </div>
                {canEdit ? (
                  <div className="flex">
                    <Button size="icon-sm" variant="ghost" aria-label="Move up" data-testid="shot-up" disabled={i === 0} onClick={() => reorder(i, -1)}>
                      <ArrowUp aria-hidden />
                    </Button>
                    <Button size="icon-sm" variant="ghost" aria-label="Move down" data-testid="shot-down" disabled={i === shots.length - 1} onClick={() => reorder(i, 1)}>
                      <ArrowDown aria-hidden />
                    </Button>
                    <Button size="icon-sm" variant="ghost" aria-label="Edit shot" data-testid="edit-shot" onClick={() => setEditing(shot)}>
                      <Pencil aria-hidden />
                    </Button>
                    <Button size="icon-sm" variant="ghost" aria-label="Delete shot" data-testid="delete-shot" onClick={() => setDeleting(shot)}>
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                ) : null}
              </div>
              {shot.hasImage ? <img src={`/api/shots/${shot.id}/image`} alt="" className="aspect-video w-full rounded-md bg-muted object-cover" /> : null}
              <p className="text-sm">{shot.description}</p>
              <p className="text-xs text-muted-foreground">
                {[shot.move, sceneLabel(shot.sceneId)].filter(Boolean).join(" · ")}
              </p>
            </li>
          ))}
        </ol>
      )}
      {editing ? <ShotDialog projectId={project.id} shot={editing === "new" ? null : editing} scenes={scenes} onClose={() => setEditing(null)} onSaved={() => router.invalidate()} /> : null}
      {deleting ? (
        <ConfirmDialog title="Delete this shot?" confirmLabel="Delete" destructive onClose={() => setDeleting(null)} onConfirm={() => {
          const target = deleting;
          setDeleting(null);
          void run("delete", () => deleteShot({ data: { projectId: project.id, id: target.id } }));
        }} />
      ) : null}
    </div>
  );
}

function ShotDialog({ projectId, shot, scenes, onClose, onSaved }: { projectId: string; shot: Shot | null; scenes: Data["scenes"]; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const [description, setDescription] = useState(shot?.description ?? "");
  const [framing, setFraming] = useState<string>(shot?.framing ?? "medium");
  const [move, setMove] = useState(shot?.move ?? "");
  const [duration, setDuration] = useState(String(shot?.duration ?? 3));
  const [sceneId, setSceneId] = useState<string>(shot?.sceneId ?? "none");
  const [image, setImage] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const { id } = await saveShot({
        data: { projectId, id: shot?.id, description, framing: framing as Shot["framing"] & "wide", move, duration: Number(duration), sceneId: sceneId === "none" ? null : sceneId },
      });
      if (image) {
        const res = await fetch(`/api/shots/${id}/image`, { method: "PUT", headers: { "content-type": image.type }, body: image });
        if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "The image wasn't uploaded.");
      }
      await onSaved();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The shot wasn't saved.");
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{shot ? "Edit shot" : "New shot"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="shot-description">Description</Label>
            <Textarea id="shot-description" data-testid="shot-description" required rows={3} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Framing</Label>
              <Select value={framing} onValueChange={(v) => v && setFraming(v)}>
                <SelectTrigger data-testid="shot-framing" className="w-full">
                  <SelectValue>{(v: string) => FRAMING_LABEL[v]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {FRAMINGS.map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="shot-move">Camera move</Label>
              <Input id="shot-move" data-testid="shot-move" placeholder="Static, pan left, push in…" maxLength={200} value={move} onChange={(e) => setMove(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="shot-duration">Duration (seconds)</Label>
              <Input id="shot-duration" data-testid="shot-duration" type="number" min={0.1} step={0.1} required value={duration} onChange={(e) => setDuration(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Scene</Label>
              <Select value={sceneId} onValueChange={(v) => v && setSceneId(v)}>
                <SelectTrigger data-testid="shot-scene" className="w-full">
                  <SelectValue>{(v: string) => (v === "none" ? "None" : `Scene ${scenes.findIndex((s) => s.id === v) + 1}`)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {scenes.map((s, i) => (
                    <SelectItem key={s.id} value={s.id}>
                      Scene {i + 1}
                      {s.heading ? `: ${s.heading}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="shot-image">Reference image</Label>
            <Input id="shot-image" data-testid="shot-image" type="file" accept="image/*" onChange={(e) => setImage(e.target.files?.[0] ?? null)} />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" data-testid="save-shot" pending={pending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
