import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { uploadMedia } from "@/server/media";
import { asMember } from "@/server/route";

// Uploads one file: the body is the file, the query its name, kind and the
// duration and size the browser measured.
export const Route = createFileRoute("/api/projects/$projectId/media")({
  server: {
    handlers: {
      PUT: ({ request, params }) => asMember(request, (actor) => uploadMedia(actor, params.projectId, request, env.media)),
    },
  },
});
