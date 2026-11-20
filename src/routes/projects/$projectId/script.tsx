import { createFileRoute, useRouter } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, Plus, Sparkles, Trash2, Wand2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/client/components/EmptyState";
import { Button } from "@/client/components/ui/button";
import { Card, CardContent } from "@/client/components/ui/card";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import { Textarea } from "@/client/components/ui/textarea";
import { formatDuration } from "@/lib/timeline";
import { draftScript, getScript, rewriteScene, saveScript } from "@/serverFunctions/app";
import { projectRoute } from "../$projectId";
import { AiOffNote } from "./media";

export const Route = createFileRoute("/projects/$projectId/script")({
  loader: ({ params }) => getScript({ data: { projectId: params.projectId } }),
  component: ScriptPage,
});

interface Scene {
  id?: string;
  key: string;
  heading: string;
  action: string;
  dialogue: string;
}

type Suggestion =
  | { kind: "draft"; title: string; scenes: Omit<Scene, "key">[] }
  | { kind: "rewrite"; index: number; scene: Omit<Scene, "key"> };

/** About 150 spoken words a minute. */
const WORDS_PER_MINUTE = 150;

function words(scenes: Pick<Scene, "action" | "dialogue">[]) {
  return scenes.reduce((n, s) => n + `${s.action} ${s.dialogue}`.split(/\s+/).filter(Boolean).length, 0);
}

const withKeys = (list: Omit<Scene, "key">[]): Scene[] => list.map((s) => ({ ...s, key: s.id ?? crypto.randomUUID() }));

function ScriptPage() {
  const project = projectRoute.useLoaderData();
  const data = Route.useLoaderData();
  const router = useRouter();
  const canEdit = project.role !== "viewer";
  const [title, setTitle] = useState(data.title);
  const [scenes, setScenes] = useState<Scene[]>(() => withKeys(data.scenes));
  const [brief, setBrief] = useState("");
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [rewriting, setRewriting] = useState<number | null>(null);
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState<"save" | "draft" | "rewrite" | null>(null);
  const [saved, setSaved] = useState(false);
  const [aiOff, setAiOff] = useState(data.aiOff);

  const count = words(scenes);
  const change = (i: number, patch: Partial<Scene>) => {
    setSaved(false);
    setScenes((list) => list.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  };
  const move = (i: number, by: number) => {
    setSaved(false);
    setScenes((list) => {
      const next = [...list];
      const [s] = next.splice(i, 1);
      next.splice(i + by, 0, s!);
      return next;
    });
  };

  async function save() {
    setBusy("save");
    try {
      const result = await saveScript({ data: { projectId: project.id, title, scenes: scenes.map(({ key: _key, ...s }) => s) } });
      setScenes(withKeys(result.scenes));
      setSaved(true);
      await router.invalidate();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "The script wasn't saved.");
    } finally {
      setBusy(null);
    }
  }

  async function ai<T>(kind: "draft" | "rewrite", work: () => Promise<{ off: true } | { off: false; result: T }>, use: (r: T) => void) {
    setBusy(kind);
    try {
      const result = await work();
      if (result.off) setAiOff(true);
      else {
        setAiOff(false);
        use(result.result);
      }
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "AI help didn't answer.");
    } finally {
      setBusy(null);
    }
  }

  function accept() {
    if (!suggestion) return;
    setSaved(false);
    if (suggestion.kind === "draft") {
      if (suggestion.title) setTitle(suggestion.title);
      setScenes(withKeys(suggestion.scenes));
    } else change(suggestion.index, suggestion.scene);
    setSuggestion(null);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <Label htmlFor="script-title">Script title</Label>
          <Input id="script-title" data-testid="script-title" value={title} maxLength={200} disabled={!canEdit} onChange={(e) => { setTitle(e.target.value); setSaved(false); }} />
        </div>
        <div className="text-sm text-muted-foreground" data-testid="runtime-estimate">
          {count} words · about {formatDuration((count / WORDS_PER_MINUTE) * 60)}
        </div>
      </div>

      {canEdit ? (
        <Card>
          <CardContent className="space-y-2">
            <Label htmlFor="script-brief">Draft from a brief</Label>
            <Textarea id="script-brief" data-testid="script-brief" rows={2} maxLength={4000} placeholder="What the video is about, who it's for, how long" value={brief} onChange={(e) => setBrief(e.target.value)} />
            <Button size="sm" variant="outline" data-testid="draft-script" pending={busy === "draft"} disabled={!brief.trim()} onClick={() => ai("draft", () => draftScript({ data: { projectId: project.id, brief } }), (r) => setSuggestion({ kind: "draft", ...r }))}>
              <Sparkles aria-hidden /> Draft script
            </Button>
          </CardContent>
        </Card>
      ) : null}
      {aiOff && canEdit ? <AiOffNote /> : null}

      {suggestion ? (
        <Card data-testid="suggestion" className="border-primary">
          <CardContent className="space-y-3">
            <p className="text-sm font-medium">{suggestion.kind === "draft" ? "Suggested script" : `Suggested rewrite of scene ${suggestion.index + 1}`}</p>
            {(suggestion.kind === "draft" ? suggestion.scenes : [suggestion.scene]).map((s, i) => (
              <div key={i} className="space-y-1 text-sm">
                <p className="font-semibold">{s.heading}</p>
                <p>{s.action}</p>
                <p className="whitespace-pre-wrap text-muted-foreground">{s.dialogue}</p>
              </div>
            ))}
            <div className="flex gap-2">
              <Button size="sm" data-testid="accept-suggestion" onClick={accept}>
                {suggestion.kind === "draft" ? "Replace script" : "Replace scene"}
              </Button>
              <Button size="sm" variant="ghost" data-testid="discard-suggestion" onClick={() => setSuggestion(null)}>
                Discard
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {scenes.length === 0 ? (
        <EmptyState title="No scenes yet" description={canEdit ? "Add a scene, or draft a script from a brief." : undefined} />
      ) : (
        <ol className="space-y-4">
          {scenes.map((scene, i) => (
            <li key={scene.key} data-testid="scene" className="space-y-2 rounded-lg border border-border bg-card p-4">
              <div className="flex items-center gap-2">
                <span className="w-6 shrink-0 text-sm text-muted-foreground">{i + 1}</span>
                <Input data-testid="scene-heading" aria-label={`Scene ${i + 1} heading`} placeholder="EXT. PLACE - TIME" value={scene.heading} disabled={!canEdit} maxLength={300} onChange={(e) => change(i, { heading: e.target.value })} />
                {canEdit ? (
                  <div className="flex shrink-0">
                    <Button size="icon-sm" variant="ghost" aria-label="Move up" data-testid="scene-up" disabled={i === 0} onClick={() => move(i, -1)}>
                      <ArrowUp aria-hidden />
                    </Button>
                    <Button size="icon-sm" variant="ghost" aria-label="Move down" data-testid="scene-down" disabled={i === scenes.length - 1} onClick={() => move(i, 1)}>
                      <ArrowDown aria-hidden />
                    </Button>
                    <Button size="icon-sm" variant="ghost" aria-label="Rewrite with AI" data-testid="rewrite-scene" onClick={() => { setRewriting(rewriting === i ? null : i); setInstruction(""); }}>
                      <Wand2 aria-hidden />
                    </Button>
                    <Button size="icon-sm" variant="ghost" aria-label="Delete scene" data-testid="delete-scene" onClick={() => { setSaved(false); setScenes((l) => l.filter((_, j) => j !== i)); }}>
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                ) : null}
              </div>
              <Textarea data-testid="scene-action" aria-label={`Scene ${i + 1} action`} placeholder="What we see" rows={2} value={scene.action} disabled={!canEdit} onChange={(e) => change(i, { action: e.target.value })} />
              <Textarea data-testid="scene-dialogue" aria-label={`Scene ${i + 1} dialogue`} placeholder="NAME: What they say" rows={2} value={scene.dialogue} disabled={!canEdit} onChange={(e) => change(i, { dialogue: e.target.value })} />
              {rewriting === i ? (
                <form className="flex gap-2" onSubmit={(e) => {
                  e.preventDefault();
                  void ai("rewrite", () => rewriteScene({ data: { projectId: project.id, scene: { heading: scene.heading, action: scene.action, dialogue: scene.dialogue }, instruction } }), (r) => {
                    setSuggestion({ kind: "rewrite", index: i, scene: { ...r, id: scene.id } });
                    setRewriting(null);
                  });
                }}>
                  <Input data-testid="rewrite-instruction" aria-label="How to rewrite it" placeholder="Make it shorter, add a joke…" value={instruction} maxLength={2000} onChange={(e) => setInstruction(e.target.value)} />
                  <Button type="submit" size="sm" data-testid="run-rewrite" pending={busy === "rewrite"} disabled={!instruction.trim()}>
                    Rewrite
                  </Button>
                </form>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" data-testid="add-scene" onClick={() => { setSaved(false); setScenes((l) => [...l, { key: crypto.randomUUID(), heading: "", action: "", dialogue: "" }]); }}>
            <Plus aria-hidden /> Scene
          </Button>
          <Button data-testid="save-script" pending={busy === "save"} onClick={save}>
            Save script
          </Button>
          {saved ? (
            <span className="text-sm text-muted-foreground" data-testid="script-saved">
              Saved
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
