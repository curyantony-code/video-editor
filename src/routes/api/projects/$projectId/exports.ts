import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { uploadExport } from "@/server/exports";
import { asMember } from "@/server/route";

// The MP4 the browser rendered; the query carries its duration in seconds.
export const Route = createFileRoute("/api/projects/$projectId/exports")({
  server: {
    handlers: {
      PUT: ({ request, params }) => asMember(request, (actor) => uploadExport(actor, params.projectId, request, env.media)),
    },
  },
});
