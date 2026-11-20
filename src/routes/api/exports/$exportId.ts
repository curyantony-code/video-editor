import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { exportKey, exportOf } from "@/server/exports";
import { serveObject } from "@/server/media";
import { asMember, attachment, notFound } from "@/server/route";

export const Route = createFileRoute("/api/exports/$exportId")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        asMember(request, async (actor) => {
          const row = await exportOf(actor, params.exportId);
          if (!row) return notFound();
          return serveObject(env.media, exportKey(row.projectId, row.id), request, { "content-disposition": attachment(`${row.title}.mp4`) });
        }),
    },
  },
});
