import { Check, MessageSquare } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Textarea } from "@/client/components/ui/textarea";
import { addComment, resolveComment } from "@/serverFunctions/app";

interface Comment {
  id: string;
  parentId: string | null;
  time: number;
  body: string;
  authorName: string;
  fromReview: boolean;
  resolved: boolean;
}

export function formatSeconds(s: number) {
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
}

export function CommentsPanel({ projectId, comments, playhead, onSeek, onChanged }: { projectId: string; comments: Comment[]; playhead: number; onSeek: (s: number) => void; onChanged: () => Promise<unknown> }) {
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const top = comments.filter((c) => !c.parentId);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    try {
      await addComment({ data: { projectId, body, time: Math.max(0, playhead), parentId: null } });
      setBody("");
      await onChanged();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "The comment wasn't added.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-1 text-sm font-semibold">
        <MessageSquare className="size-4" aria-hidden /> Comments
      </h2>
      <form onSubmit={add} className="space-y-2">
        <Textarea data-testid="comment-input" aria-label="Comment" placeholder={`Comment at ${formatSeconds(playhead)}`} value={body} onChange={(e) => setBody(e.target.value)} rows={2} maxLength={2000} />
        <Button type="submit" size="sm" variant="outline" data-testid="add-comment" pending={pending} disabled={!body.trim()}>
          Comment
        </Button>
      </form>
      {top.length === 0 ? <p className="text-sm text-muted-foreground">No comments yet.</p> : null}
      <ul className="space-y-2">
        {top.map((c) => (
          <CommentItem key={c.id} comment={c} replies={comments.filter((r) => r.parentId === c.id)} projectId={projectId} onSeek={onSeek} onChanged={onChanged} />
        ))}
      </ul>
    </section>
  );
}

function CommentItem({ comment, replies, projectId, onSeek, onChanged }: { comment: Comment; replies: Comment[]; projectId: string; onSeek: (s: number) => void; onChanged: () => Promise<unknown> }) {
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState("");
  return (
    <li data-testid="comment" className={`space-y-1 rounded-md border border-border p-3 text-sm ${comment.resolved ? "opacity-70" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="font-mono text-xs text-primary" onClick={() => onSeek(comment.time)}>
          {formatSeconds(comment.time)}
        </button>
        <span className="truncate text-xs text-muted-foreground">{comment.authorName}</span>
        {comment.fromReview ? <Badge variant="outline">Review</Badge> : null}
        {comment.resolved ? <Badge variant="secondary">Resolved</Badge> : null}
      </div>
      <p className="whitespace-pre-wrap">{comment.body}</p>
      {replies.map((r) => (
        <div key={r.id} className="ms-3 border-s border-border ps-3">
          <span className="text-xs text-muted-foreground">{r.authorName}</span>
          <p className="whitespace-pre-wrap">{r.body}</p>
        </div>
      ))}
      <div className="flex gap-1">
        <Button size="xs" variant="ghost" data-testid="reply-toggle" onClick={() => setReplying((r) => !r)}>
          Reply
        </Button>
        <Button size="xs" variant="ghost" data-testid="resolve-comment" onClick={async () => {
          await resolveComment({ data: { projectId, id: comment.id, resolved: !comment.resolved } });
          await onChanged();
        }}>
          <Check aria-hidden /> {comment.resolved ? "Reopen" : "Resolve"}
        </Button>
      </div>
      {replying ? (
        <form className="flex gap-2" onSubmit={async (e) => {
          e.preventDefault();
          if (!reply.trim()) return;
          await addComment({ data: { projectId, body: reply, time: comment.time, parentId: comment.id } });
          setReply("");
          setReplying(false);
          await onChanged();
        }}>
          <Input data-testid="reply-input" aria-label="Reply" value={reply} onChange={(e) => setReply(e.target.value)} maxLength={2000} />
          <Button type="submit" size="sm" data-testid="send-reply">
            Send
          </Button>
        </form>
      ) : null}
    </li>
  );
}
