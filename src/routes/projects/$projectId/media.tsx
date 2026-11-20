import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Eye, Sparkles, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import { EmptyState } from "@/client/components/EmptyState";
import { Alert, AlertDescription } from "@/client/components/ui/alert";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/client/components/ui/dialog";
import { Input } from "@/client/components/ui/input";
import { Textarea } from "@/client/components/ui/textarea";
import { formatBytes, sampleFrames, uploadFile } from "@/client/lib/media";
import { formatDuration } from "@/lib/timeline";
import { deleteMedia, draftMediaNote, getMedia, setMediaNote } from "@/serverFunctions/app";
import { projectRoute } from "../$projectId";

export const Route = createFileRoute("/projects/$projectId/media")({
  validateSearch: (search: Record<string, unknown>) => ({ q: typeof search.q === "string" ? search.q : "" }),
  loaderDeps: ({ search }) => ({ q: search.q }),
  loader: ({ params, deps }) => getMedia({ data: { projectId: params.projectId, search: deps.q || undefined } }),
  component: MediaPage,
});

type Item = Awaited<ReturnType<typeof getMedia>>["media"][number];
const KIND_LABEL: Record<string, string> = { video: "Video", audio: "Audio", image: "Image" };

function MediaPage() {
  const project = projectRoute.useLoaderData();
  const { media, aiOff } = Route.useLoaderData();
  const { q } = Route.useSearch();
  const navigate = Route.useNavigate();
  const router = useRouter();
  const canEdit = project.role !== "viewer";
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(q);
  const [previewing, setPreviewing] = useState<Item | null>(null);
  const [deleting, setDeleting] = useState<Item | null>(null);
  const [aiIsOff, setAiOff] = useState(aiOff);

  useEffect(() => {
    const t = setTimeout(() => {
      if (search !== q) void navigate({ search: { q: search }, replace: true });
    }, 250);
    return () => clearTimeout(t);
  }, [search, q, navigate]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    setUploading(files.length);
    for (const file of Array.from(files)) {
      try {
        await uploadFile(project.id, file);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Upload failed.");
      }
      setUploading((n) => n - 1);
      await router.invalidate();
    }
    if (input.current) input.current.value = "";
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          data-testid="media-search"
          type="search"
          placeholder="Search names and notes"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm flex-1"
        />
        {canEdit ? (
          <>
            <input ref={input} data-testid="media-input" type="file" multiple accept="video/*,audio/*,image/*" className="hidden" onChange={(e) => void upload(e.target.files)} />
            <Button onClick={() => input.current?.click()} pending={uploading > 0}>
              <Upload aria-hidden /> {uploading > 0 ? `Uploading ${uploading}…` : "Upload"}
            </Button>
          </>
        ) : null}
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {aiIsOff && canEdit ? <AiOffNote /> : null}
      {media.length === 0 ? (
        q ? (
          <EmptyState kind="filtered" title="No matches" description="No file's name or note has those words." />
        ) : (
          <EmptyState title="No media yet" description={canEdit ? "Upload video, audio or images to use them on the timeline." : undefined} />
        )
      ) : (
        <ul className="space-y-3">
          {media.map((m) => (
            <MediaRow key={m.id} item={m} projectId={project.id} canEdit={canEdit} onPreview={() => setPreviewing(m)} onDelete={() => setDeleting(m)} onAiOff={() => setAiOff(true)} />
          ))}
        </ul>
      )}
      {previewing ? (
        <Dialog open onOpenChange={(open) => !open && setPreviewing(null)}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle className="truncate">{previewing.name}</DialogTitle>
            </DialogHeader>
            <MediaPreview item={previewing} />
          </DialogContent>
        </Dialog>
      ) : null}
      {deleting ? (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          confirmLabel="Delete"
          destructive
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            const target = deleting;
            setDeleting(null);
            await deleteMedia({ data: { projectId: project.id, mediaId: target.id } });
            await router.invalidate();
          }}
        >
          Clips that use it are removed from the timeline.
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

export function AiOffNote() {
  return (
    <Alert data-testid="ai-off">
      <AlertDescription>AI help is off. An admin can turn it on by adding an OpenRouter key to the Gateway.</AlertDescription>
    </Alert>
  );
}

function MediaPreview({ item }: { item: Item }) {
  const src = `/api/media/${item.id}`;
  if (item.kind === "image") return <img src={src} alt={item.name} className="max-h-[60vh] w-full rounded-md object-contain" />;
  if (item.kind === "audio") return <audio src={src} controls className="w-full" />;
  return <video src={src} controls className="max-h-[60vh] w-full rounded-md bg-muted" />;
}

function MediaRow({ item, projectId, canEdit, onPreview, onDelete, onAiOff }: { item: Item; projectId: string; canEdit: boolean; onPreview: () => void; onDelete: () => void; onAiOff: () => void }) {
  const [note, setNote] = useState(item.note);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState<"save" | "draft" | null>(null);
  const details = [
    item.duration != null ? formatDuration(item.duration) : null,
    item.width && item.height ? `${item.width}×${item.height}` : null,
    formatBytes(item.size),
  ].filter(Boolean);

  async function save() {
    setBusy("save");
    try {
      await setMediaNote({ data: { projectId, mediaId: item.id, note } });
      setSaved(true);
    } finally {
      setBusy(null);
    }
  }

  async function draft() {
    setBusy("draft");
    try {
      const frames = await sampleFrames(`/api/media/${item.id}`, item.kind);
      const result = await draftMediaNote({ data: { projectId, mediaId: item.id, frames } });
      if (result.off) onAiOff();
      else {
        setNote(result.result.note);
        setSaved(false);
      }
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "The note couldn't be drafted.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <li data-testid="media-item" data-id={item.id} className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="truncate font-medium">{item.name}</div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="secondary" data-testid="media-kind">
              {KIND_LABEL[item.kind]}
            </Badge>
            {details.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" aria-label="Preview" data-testid="preview-media" onClick={onPreview}>
            <Eye aria-hidden />
          </Button>
          {canEdit ? (
            <Button variant="ghost" size="icon-sm" aria-label="Delete" data-testid="delete-media" onClick={onDelete}>
              <Trash2 aria-hidden />
            </Button>
          ) : null}
        </div>
      </div>
      {canEdit ? (
        <div className="space-y-2">
          <Textarea
            data-testid="media-note"
            aria-label={`Note for ${item.name}`}
            placeholder="What's in this file"
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              setSaved(false);
            }}
            rows={2}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" data-testid="save-note" onClick={save} pending={busy === "save"}>
              Save note
            </Button>
            {item.kind !== "audio" ? (
              <Button size="sm" variant="ghost" data-testid="draft-note" onClick={draft} pending={busy === "draft"}>
                <Sparkles aria-hidden /> Draft with AI
              </Button>
            ) : null}
            {saved ? (
              <span className="text-sm text-muted-foreground" data-testid="note-saved">
                Saved
              </span>
            ) : null}
          </div>
        </div>
      ) : item.note ? (
        <p className="text-sm text-muted-foreground">{item.note}</p>
      ) : null}
    </li>
  );
}
