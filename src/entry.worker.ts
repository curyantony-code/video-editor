import tanstackEntry from "@tanstack/react-start/server-entry";
import { everyApp, getEveryAppUser } from "@every-app/sdk/server";
import { env } from "cloudflare:workers";
import { actorOf, NotFound, projectAccess } from "@/server/access";
import { tools } from "./tools";

export { ProjectRoom } from "@/server/room";

const ROOM = /^\/api\/rooms\/([0-9a-f-]{36})$/;

// everyApp() verifies the identity the Gateway sent before any request reaches
// the app (a request from anywhere else is a 401), and serves the tools.
export default everyApp<Env>(
  async (request) => {
    const room = new URL(request.url).pathname.match(ROOM);
    if (room) return openRoom(request, room[1]!);
    return tanstackEntry.fetch(request);
  },
  { tools },
);

/** A project's live room. Only people with access to the project get in. */
async function openRoom(request: Request, projectId: string): Promise<Response> {
  const user = await getEveryAppUser(request, env);
  if (!user) return Response.json({ error: "Sign in first" }, { status: 401 });
  const actor = await actorOf(user);
  try {
    await projectAccess(actor, projectId);
  } catch (error) {
    if (error instanceof NotFound) return Response.json({ error: "Not found" }, { status: 404 });
    throw error;
  }
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket")
    return Response.json({ error: "Expected a WebSocket" }, { status: 426 });
  const headers = new Headers(request.headers);
  headers.set("x-room-email", actor.email);
  const stub = env.ROOMS.get(env.ROOMS.idFromName(projectId));
  return stub.fetch(new Request(request.url, { headers }));
}
