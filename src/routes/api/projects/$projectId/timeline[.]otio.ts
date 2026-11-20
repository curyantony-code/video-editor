import { createFileRoute } from "@tanstack/react-router";
import { projectFile } from "@/server/projectFileRoute";
import { asMember } from "@/server/route";

export const Route = createFileRoute("/api/projects/$projectId/timeline.otio")({
  server: {
    handlers: {
      GET: ({ request, params }) => asMember(request, (actor) => projectFile(actor, params.projectId, "otio")),
    },
  },
});
