// One ProjectRoom per project: the open editors' WebSockets. It tells each
// who else is present and when the timeline changed. The Worker checks
// access before a socket reaches it (src/entry.worker.ts).
import { DurableObject } from "cloudflare:workers";

interface Attachment {
  email: string;
}

export class ProjectRoom extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/changed" && request.method === "POST") {
      this.send(await request.text());
      return new Response(null, { status: 204 });
    }
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket")
      return new Response("Expected a WebSocket", { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ email: request.headers.get("x-room-email") ?? "" } satisfies Attachment);
    this.presence();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (message === "ping") ws.send("pong");
  }

  async webSocketClose(ws: WebSocket) {
    try {
      ws.close();
    } catch {
      // already closed
    }
    this.presence(ws);
  }

  async webSocketError(ws: WebSocket) {
    this.presence(ws);
  }

  private presence(leaving?: WebSocket) {
    const people = [
      ...new Set(
        this.ctx
          .getWebSockets()
          .filter((ws) => ws !== leaving && ws.readyState === WebSocket.OPEN)
          .map((ws) => (ws.deserializeAttachment() as Attachment | null)?.email ?? ""),
      ),
    ].filter(Boolean);
    this.send(JSON.stringify({ type: "presence", people }));
  }

  private send(message: string) {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(message);
      } catch {
        // a closing socket
      }
    }
  }
}

/** Tells the project's open editors that something changed. */
export async function announce(env: Env, projectId: string, what: Record<string, unknown>) {
  try {
    const stub = env.ROOMS.get(env.ROOMS.idFromName(projectId));
    await stub.fetch("https://room/changed", { method: "POST", body: JSON.stringify({ type: "changed", ...what }) });
  } catch {
    // Live updates are best effort; the page also reloads on focus.
  }
}
