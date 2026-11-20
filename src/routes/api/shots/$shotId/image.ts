import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { requireEditor } from "@/server/access";
import { serveObject } from "@/server/media";
import { asMember, notFound } from "@/server/route";
import { setShotImage, shotImageKey, shotOf } from "@/server/shots";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

// A shot's reference image.
export const Route = createFileRoute("/api/shots/$shotId/image")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        asMember(request, async (actor) => {
          const shot = await shotOf(actor, params.shotId);
          if (!shot) return notFound();
          return serveObject(env.media, shotImageKey(shot.projectId, shot.id), request);
        }),
      PUT: ({ request, params }) =>
        asMember(request, async (actor) => {
          const shot = await shotOf(actor, params.shotId);
          if (!shot) return notFound();
          await requireEditor(actor, shot.projectId);
          const mime = (request.headers.get("content-type") ?? "").toLowerCase();
          if (!mime.startsWith("image/")) return Response.json({ error: "Reference images are image files." }, { status: 415 });
          const body = await request.arrayBuffer();
          if (!body.byteLength || body.byteLength > MAX_IMAGE_BYTES) return Response.json({ error: "The image is empty or larger than 20 MB." }, { status: 413 });
          await env.media.put(shotImageKey(shot.projectId, shot.id), body, { httpMetadata: { contentType: mime } });
          await setShotImage(shot.projectId, shot.id, true);
          return Response.json({ ok: true }, { status: 201 });
        }),
    },
  },
});
