import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Download, Film, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import { EmptyState } from "@/client/components/EmptyState";
import { Alert, AlertDescription } from "@/client/components/ui/alert";
import { Button } from "@/client/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/client/components/ui/card";
import { formatBytes } from "@/client/lib/media";
import { renderMp4 } from "@/client/lib/render";
import { formatDuration, timelineFrames } from "@/lib/timeline";
import { deleteExport, getExports } from "@/serverFunctions/app";
import { projectRoute } from "../$projectId";

export const Route = createFileRoute("/projects/$projectId/exports")({
  ssr: false,
  loader: ({ params }) => getExports({ data: { projectId: params.projectId } }),
  component: ExportsPage,
});

function ExportsPage() {
  const project = projectRoute.useLoaderData();
  const data = Route.useLoaderData();
  const router = useRouter();
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zipping, setZipping] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const empty = timelineFrames(data.timeline) === 0;

  async function exportMp4() {
    setError(null);
    setProgress(0);
    try {
      const { blob, duration } = await renderMp4({ timeline: data.timeline, media: data.media, aspect: project.aspect, fps: project.fps }, setProgress);
      const res = await fetch(`/api/projects/${project.id}/exports?duration=${duration}`, { method: "PUT", headers: { "content-type": "video/mp4" }, body: blob });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "The export wasn't saved.");
      await router.invalidate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The export failed.");
    } finally {
      setProgress(null);
    }
  }

  async function downloadZip() {
    setZipping(true);
    try {
      const { zip } = await import("fflate");
      const files: Record<string, Uint8Array> = {};
      const name = project.title.replace(/[\\/:*?"<>|]/g, "_");
      files[`${name}.otio`] = new Uint8Array(await (await fetch(`/api/projects/${project.id}/timeline.otio`)).arrayBuffer());
      files[`${name}.xml`] = new Uint8Array(await (await fetch(`/api/projects/${project.id}/timeline.xml`)).arrayBuffer());
      for (const m of data.media) files[`media/${m.name}`] = new Uint8Array(await (await fetch(`/api/media/${m.id}`)).arrayBuffer());
      const bytes = await new Promise<Uint8Array>((resolve, reject) => zip(files, { level: 0 }, (err, out) => (err ? reject(err) : resolve(out))));
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/zip" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${name}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch {
      toast.error("The zip couldn't be made.");
    } finally {
      setZipping(false);
    }
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">MP4 exports</h2>
          {project.role !== "viewer" ? (
            <Button data-testid="export-mp4" onClick={exportMp4} pending={progress !== null} disabled={empty}>
              <Film aria-hidden /> {progress !== null ? `Rendering ${Math.round(progress * 100)}%` : "Export MP4"}
            </Button>
          ) : null}
        </div>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {data.exports.length === 0 ? (
          <EmptyState title="No exports yet" description={empty ? "Put something on the timeline first." : undefined} />
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {data.exports.map((e) => (
              <li key={e.id} data-testid="export-item" className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="text-sm">
                  <div className="font-medium">{new Date(`${e.createdAt.replace(" ", "T")}Z`).toLocaleString()}</div>
                  <div className="text-muted-foreground">
                    {formatDuration(e.duration)} · {formatBytes(e.size)}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="outline" data-testid="export-download" render={<a href={`/api/exports/${e.id}`} download />}>
                    <Download aria-hidden /> Download
                  </Button>
                  {project.role === "owner" ? (
                    <Button size="icon-sm" variant="ghost" aria-label="Delete export" data-testid="export-delete" onClick={() => setDeleting(e.id)}>
                      <Trash2 aria-hidden />
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <Card>
        <CardHeader>
          <CardTitle>Editable project</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" data-testid="download-otio" render={<a href={`/api/projects/${project.id}/timeline.otio`} download />}>
            OpenTimelineIO (.otio)
          </Button>
          <Button variant="outline" data-testid="download-xml" render={<a href={`/api/projects/${project.id}/timeline.xml`} download />}>
            FCP7 XML
          </Button>
          <Button variant="outline" data-testid="download-zip" pending={zipping} onClick={downloadZip}>
            Zip with media
          </Button>
        </CardContent>
      </Card>
      {deleting ? (
        <ConfirmDialog title="Delete this export?" confirmLabel="Delete" destructive onClose={() => setDeleting(null)} onConfirm={async () => {
          const id = deleting;
          setDeleting(null);
          await deleteExport({ data: { projectId: project.id, id } });
          await router.invalidate();
        }} />
      ) : null}
    </div>
  );
}
