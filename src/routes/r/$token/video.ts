import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { latestExport, reviewProject } from "@/server/comments";
import { exportKey } from "@/server/exports";
import { serveObject } from "@/server/media";
import { notFound } from "@/server/route";

// Public: the newest export of the project behind a live review token.
export const Route = createFileRoute("/r/$token/video")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const project = await reviewProject(params.token);
        if (!project) return notFound();
        const latest = await latestExport(project.projectId);
        if (!latest) return notFound();
        return serveObject(env.media, exportKey(project.projectId, latest.id), request);
      },
    },
  },
});
