import { Sparkles, Undo2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AiOffNote } from "@/routes/projects/$projectId/media";
import { Button } from "@/client/components/ui/button";
import { Textarea } from "@/client/components/ui/textarea";
import { OPERATION_LABELS, type Operation } from "@/lib/timeline";
import { revertAgent, runAgent } from "@/serverFunctions/app";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  operations: Operation[];
  revision: number | null;
}

export function AgentPanel({ projectId, messages, aiOff, revision, onChanged }: { projectId: string; messages: Message[]; aiOff: boolean; revision: number; onChanged: () => Promise<unknown> }) {
  const [request, setRequest] = useState("");
  const [pending, setPending] = useState(false);
  const [off, setOff] = useState(aiOff);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!request.trim()) return;
    setPending(true);
    try {
      const result = await runAgent({ data: { projectId, request } });
      if (result.off) setOff(true);
      else {
        setOff(false);
        setRequest("");
      }
      await onChanged();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "The agent didn't answer.");
    } finally {
      setPending(false);
    }
  }

  async function revert(target: number) {
    try {
      await revertAgent({ data: { projectId, revision: target, baseRevision: revision } });
      await onChanged();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "That edit couldn't be reverted.");
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-1 text-sm font-semibold">
        <Sparkles className="size-4" aria-hidden /> Agent
      </h2>
      {messages.length > 0 ? (
        <ol className="max-h-80 space-y-2 overflow-y-auto">
          {messages.map((m) => (
            <li key={m.id} data-testid="agent-message" className={`rounded-md px-3 py-2 text-sm ${m.role === "user" ? "bg-muted" : "border border-border"}`}>
              <p>{m.content}</p>
              {m.operations.length > 0 ? (
                <ul data-testid="agent-ops" className="mt-1 list-inside list-disc text-xs text-muted-foreground">
                  {m.operations.map((op, i) => (
                    <li key={i}>
                      {OPERATION_LABELS[op.op]}
                      {"text" in op && op.text ? `: ${op.text}` : ""}
                    </li>
                  ))}
                </ul>
              ) : null}
              {m.revision ? (
                <Button size="xs" variant="ghost" className="mt-1" data-testid="agent-revert" onClick={() => revert(m.revision!)}>
                  <Undo2 aria-hidden /> Revert
                </Button>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
      {off ? <AiOffNote /> : null}
      <form onSubmit={send} className="space-y-2">
        <Textarea data-testid="agent-input" aria-label="Edit request" placeholder="Cut the pauses, add a caption over the second clip…" value={request} onChange={(e) => setRequest(e.target.value)} rows={2} maxLength={2000} />
        <Button type="submit" size="sm" data-testid="agent-send" pending={pending} disabled={!request.trim()}>
          Ask
        </Button>
      </form>
    </section>
  );
}
