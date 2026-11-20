import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { AppShell } from "@/client/components/AppShell";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import { EmptyState } from "@/client/components/EmptyState";
import { PageHeader } from "@/client/components/PageHeader";
import { Alert, AlertDescription } from "@/client/components/ui/alert";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/client/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/client/components/ui/dialog";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/client/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/client/components/ui/toggle-group";
import { createProject, deleteProject, getProjects } from "@/serverFunctions/app";

export const Route = createFileRoute("/")({
  loader: () => getProjects(),
  component: Projects,
});

const ROLE_LABEL = { owner: "Yours", editor: "Editor", viewer: "Viewer" } as const;

function Projects() {
  const { projects, org } = Route.useLoaderData();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<{ id: string; title: string } | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <AppShell>
      <PageHeader
        title="Projects"
        actions={
          <Button data-testid="new-project" onClick={() => setCreating(true)}>
            <Plus aria-hidden /> New project
          </Button>
        }
      />
      {projects.length === 0 ? (
        <EmptyState
          title="No projects yet"
          description="Create one to upload footage and start cutting."
          action={<Button onClick={() => setCreating(true)}>New project</Button>}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {projects.map((p) => (
            <Link key={p.id} to="/projects/$projectId" params={{ projectId: p.id }} data-testid="project-card" className="block">
              <Card className="h-full transition-colors hover:bg-muted/50">
                <CardHeader>
                  <CardTitle>{p.title}</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <Badge variant="secondary">{p.aspect}</Badge>
                  <span>{p.fps} fps</span>
                  <Badge variant={p.role === "owner" ? "outline" : "default"}>{ROLE_LABEL[p.role]}</Badge>
                  {p.role !== "owner" && p.ownerEmail ? <span className="truncate">{p.ownerEmail}</span> : null}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
      {org ? (
        <section className="space-y-3" data-testid="org-projects">
          <h2 className="text-lg font-semibold">Everyone else's projects</h2>
          {org.length === 0 ? (
            <p className="text-sm text-muted-foreground">None.</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {org.map((p) => (
                <li key={p.id} data-testid="org-project-row" className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{p.title}</div>
                    <div className="truncate text-sm text-muted-foreground">{p.ownerEmail}</div>
                  </div>
                  <Button variant="ghost" size="icon-sm" aria-label={`Delete ${p.title}`} data-testid="org-project-delete" onClick={() => setDeleting(p)}>
                    <Trash2 aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
      {creating ? <NewProjectDialog onClose={() => setCreating(false)} /> : null}
      {deleting ? (
        <ConfirmDialog
          title={`Delete "${deleting.title}"?`}
          confirmLabel="Delete project"
          destructive
          pending={pending}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            setPending(true);
            try {
              await deleteProject({ data: { projectId: deleting.id } });
              await router.invalidate();
            } finally {
              setPending(false);
              setDeleting(null);
            }
          }}
        >
          Its media, timeline, script, storyboard, comments and exports are deleted too.
        </ConfirmDialog>
      ) : null}
    </AppShell>
  );
}

function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [aspect, setAspect] = useState<"16:9" | "9:16" | "1:1">("16:9");
  const [fps, setFps] = useState("30");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const { id } = await createProject({ data: { title, aspect, fps: Number(fps) } });
      await navigate({ to: "/projects/$projectId", params: { projectId: id } });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The project couldn't be created.");
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="project-title">Title</Label>
            <Input id="project-title" data-testid="project-title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={120} autoFocus />
          </div>
          <div className="space-y-2">
            <Label>Aspect ratio</Label>
            <ToggleGroup value={[aspect]} onValueChange={(v) => v[0] && setAspect(v[0] as typeof aspect)} variant="outline">
              {(["16:9", "9:16", "1:1"] as const).map((a) => (
                <ToggleGroupItem key={a} value={a} data-testid={`aspect-${a}`}>
                  {a}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <div className="space-y-2">
            <Label>Frame rate</Label>
            <Select value={fps} onValueChange={(v) => v && setFps(v)}>
              <SelectTrigger data-testid="project-fps" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["24", "25", "30", "60"].map((r) => (
                  <SelectItem key={r} value={r}>
                    {r} fps
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" data-testid="create-project" pending={pending}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
