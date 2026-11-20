import { useEffect, useState } from "react";

/** The project's live room: who's here, and a callback when something changed. */
export function useRoom(projectId: string, onChange: (message: { what?: string; revision?: number }) => void) {
  const [people, setPeople] = useState<string[]>([]);
  useEffect(() => {
    let socket: WebSocket | null = null;
    let stopped = false;
    let retry: ReturnType<typeof setTimeout>;
    const connect = () => {
      const protocol = location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(`${protocol}://${location.host}/api/rooms/${projectId}`);
      socket.onmessage = (event) => {
        if (typeof event.data !== "string" || event.data === "pong") return;
        const message = JSON.parse(event.data) as { type: string; people?: string[]; what?: string; revision?: number };
        if (message.type === "presence") setPeople(message.people ?? []);
        else onChange(message);
      };
      socket.onclose = () => {
        if (!stopped) retry = setTimeout(connect, 2000);
      };
    };
    connect();
    const ping = setInterval(() => socket?.readyState === WebSocket.OPEN && socket.send("ping"), 30000);
    return () => {
      stopped = true;
      clearTimeout(retry);
      clearInterval(ping);
      socket?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);
  return people;
}
