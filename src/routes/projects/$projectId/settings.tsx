import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { Link2, Trash2, UserMinus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import { CopyButton } from "@/client/components/CopyButton";
import { Button } from "@/client/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/client/components/ui/card";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/client/components/ui/select";
import { createReviewLink, deleteProject, getSharing, renameProject, revokeReviewLink, shareProject, unshareProject } from "@/serverFunctions/app";
import { projectRoute } from "../$projectId";

export const Route = createFileRoute("/projects/$projectId/settings")({
  ssr: false,
  loader: ({ params }) => getSharing({ data: { projectId: params.projectId } }),
  component: SettingsPage,
});

const ROLES = { editor: "Editor", viewer: "Viewer" } as const;
type ShareRole = keyof typeof ROLES;

function SettingsPage() {
  const project = projectRoute.useLoaderData();
  const { shares, reviewLinks } = Route.useLoaderData();
  const router = useRouter();
  const navigate = useNavigate();
  const owner = project.role === "owner";
  const [title, setTitle] = useState(project.title);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ShareRole>("editor");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  async function run(name: string, work: () => Promise<unknown>) {
    setBusy(name);
    try {
      await work();
      await router.invalidate();
      return true;
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "That didn't work.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  if (!owner) {
    return <p className="text-sm text-muted-foreground">Only the project's owner can change its settings and sharing.</p>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Sharing</CardTitle>
          <CardDescription>Editors change the project. Viewers watch, comment and download.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form className="flex flex-wrap items-end gap-2" onSubmit={async (e) => {
            e.preventDefault();
            if (await run("share", () => shareProject({ data: { projectId: project.id, email, role } }))) setEmail("");
          }}>
            <div className="min-w-56 flex-1 space-y-1">
              <Label htmlFor="share-email">Member's email</Label>
              <Input id="share-email" data-testid="share-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <Select value={role} onValueChange={(v) => v && setRole(v as ShareRole)}>
              <SelectTrigger data-testid="share-role" className="w-32">
                <SelectValue>{(v: ShareRole) => ROLES[v]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="editor">Editor</SelectItem>
                <SelectItem value="viewer">Viewer</SelectItem>
              </SelectContent>
            </Select>
            <Button type="submit" data-testid="share-add" pending={busy === "share"}>
              Share
            </Button>
          </form>
          {shares.length === 0 ? (
            <p className="text-sm text-muted-foreground">Only you can open this project.</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {shares.map((s) => (
                <li key={s.email} data-testid="share-member" className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0 text-sm">
                    <div className="truncate">{s.email}</div>
                    {!s.joined ? <div className="text-xs text-muted-foreground">Hasn't opened the app yet</div> : null}
                  </div>
                  <div className="flex items-center gap-1">
                    <Select value={s.role} onValueChange={(v) => v && v !== s.role && run(`role-${s.email}`, () => shareProject({ data: { projectId: project.id, email: s.email, role: v as ShareRole } }))}>
                      <SelectTrigger data-testid="member-role" size="sm" className="w-28">
                        <SelectValue>{(v: ShareRole) => ROLES[v]}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="editor">Editor</SelectItem>
                        <SelectItem value="viewer">Viewer</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button size="icon-sm" variant="ghost" aria-label={`Remove ${s.email}`} data-testid="member-remove" onClick={() => run(`remove-${s.email}`, () => unshareProject({ data: { projectId: project.id, email: s.email } }))}>
                      <UserMinus aria-hidden />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Review link</CardTitle>
          <CardDescription>Anyone with the link can watch the newest export and leave comments, without signing in.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {reviewLinks.map((link) => {
            const url = `${location.origin}/r/${link.token}`;
            return (
              <div key={link.token} className="flex flex-wrap items-center gap-2">
                <code data-testid="review-link" className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1 text-sm">
                  {url}
                </code>
                <CopyButton value={url} successMessage="Link copied" />
                <Button size="sm" variant="ghost" data-testid="revoke-review-link" onClick={() => run("revoke", () => revokeReviewLink({ data: { projectId: project.id, token: link.token } }))}>
                  Revoke
                </Button>
              </div>
            );
          })}
          {reviewLinks.length === 0 ? (
            <Button variant="outline" data-testid="create-review-link" pending={busy === "link"} onClick={() => run("link", () => createReviewLink({ data: { projectId: project.id } }))}>
              <Link2 aria-hidden /> Create review link
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Project</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => {
            e.preventDefault();
            void run("rename", () => renameProject({ data: { projectId: project.id, title } }));
          }}>
            <div className="min-w-56 flex-1 space-y-1">
              <Label htmlFor="project-rename">Title</Label>
              <Input id="project-rename" data-testid="project-rename" required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <Button type="submit" variant="outline" data-testid="save-rename" pending={busy === "rename"}>
              Rename
            </Button>
          </form>
          <Button variant="destructive" data-testid="delete-project" onClick={() => setConfirmDelete(true)}>
            <Trash2 aria-hidden /> Delete project
          </Button>
        </CardContent>
      </Card>
      {confirmDelete ? (
        <ConfirmDialog title={`Delete "${project.title}"?`} confirmLabel="Delete project" destructive pending={busy === "delete"} onClose={() => setConfirmDelete(false)} onConfirm={async () => {
          setBusy("delete");
          try {
            await deleteProject({ data: { projectId: project.id } });
            await navigate({ to: "/" });
          } catch (cause) {
            toast.error(cause instanceof Error ? cause.message : "The project wasn't deleted.");
            setBusy(null);
          }
        }}>
          Its media, timeline, script, storyboard, comments and exports are deleted too.
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
