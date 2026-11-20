import { createFileRoute } from "@tanstack/react-router";
import { getEveryAppUser } from "@every-app/sdk/server";
import { env } from "cloudflare:workers";

// A JSON endpoint for uptime checks, reached with a personal access token.
export const Route = createFileRoute("/health")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const user = await getEveryAppUser(request, env);
        return Response.json({ ok: true, user: user?.email ?? null });
      },
    },
  },
});
