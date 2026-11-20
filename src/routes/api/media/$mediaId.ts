import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { mediaFile, mediaKey, serveObject } from "@/server/media";
import { asMember, attachment, notFound } from "@/server/route";

export const Route = createFileRoute("/api/media/$mediaId")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        asMember(request, async (actor) => {
          const row = await mediaFile(actor, params.mediaId);
          if (!row) return notFound();
          const download = new URL(request.url).searchParams.has("download");
          return serveObject(env.media, mediaKey(row.projectId, row.id), request, download ? { "content-disposition": attachment(row.name) } : {});
        }),
    },
  },
});
