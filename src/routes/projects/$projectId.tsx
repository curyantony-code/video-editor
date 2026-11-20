import { createFileRoute, getRouteApi, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { AppShell } from "@/client/components/AppShell";
import { NotFound } from "@/client/components/NotFound";
import { PageHeader } from "@/client/components/PageHeader";
import { Badge } from "@/client/components/ui/badge";
import { getProject } from "@/serverFunctions/app";

export const Route = createFileRoute("/projects/$projectId")({
  loader: ({ params }) => getProject({ data: { projectId: params.projectId } }),
  head: ({ loaderData }) => ({ meta: loaderData ? [{ title: `${loaderData.title} · Video Editor` }] : [] }),
  component: ProjectLayout,
  notFoundComponent: () => (
    <AppShell>
      <NotFound />
    </AppShell>
  ),
});

export const projectRoute = getRouteApi("/projects/$projectId");

const TABS = [
  { to: "/projects/$projectId", label: "Editor", exact: true },
  { to: "/projects/$projectId/media", label: "Media" },
  { to: "/projects/$projectId/script", label: "Script" },
  { to: "/projects/$projectId/storyboard", label: "Storyboard" },
  { to: "/projects/$projectId/exports", label: "Exports" },
  { to: "/projects/$projectId/settings", label: "Settings" },
] as const;

function ProjectLayout() {
  const project = Route.useLoaderData();
  const wide = useRouterState({ select: (s) => /\/projects\/[^/]+\/?$/.test(s.location.pathname) });
  return (
    <AppShell wide={wide}>
      <PageHeader
        backLink={
          <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
            <ChevronLeft className="size-4" aria-hidden />
            Projects
          </Link>
        }
        title={project.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{project.aspect}</Badge>
            <span>{project.fps} fps</span>
            {project.role === "viewer" ? (
              <Badge variant="outline" data-testid="read-only">
                View only
              </Badge>
            ) : null}
          </span>
        }
      />
      <nav className="-mt-4 flex gap-1 overflow-x-auto border-b border-border" aria-label="Project">
        {TABS.map((tab) => (
          <Link
            key={tab.to}
            to={tab.to}
            params={{ projectId: project.id }}
            activeOptions={{ exact: "exact" in tab }}
            className="-mb-px border-b-2 border-transparent px-3 py-2 text-sm whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground"
            activeProps={{ className: "border-primary text-foreground" }}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      <Outlet />
    </AppShell>
  );
}
