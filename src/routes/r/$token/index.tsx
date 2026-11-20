import { createFileRoute, notFound } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { formatSeconds } from "@/client/components/CommentsPanel";
import { NotFound } from "@/client/components/NotFound";
import { PageHeader } from "@/client/components/PageHeader";
import { EmptyState } from "@/client/components/EmptyState";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import { Textarea } from "@/client/components/ui/textarea";
import { getReview } from "@/serverFunctions/review";

// Public (everyapp.config.ts): someone outside the organization reviews the
// newest export. The page renders on the server; its data never comes from a
// call the visitor could make.
export const Route = createFileRoute("/r/$token/")({
  loader: async ({ params }) => {
    const data = await getReview({ data: { token: params.token } });
    if (!data) throw notFound();
    return data;
  },
  head: ({ loaderData }) => ({ meta: loaderData ? [{ title: `Review: ${loaderData.title}` }] : [] }),
  component: Review,
  notFoundComponent: () => (
    <ReviewFrame>
      <NotFound home={false} />
    </ReviewFrame>
  ),
});

function ReviewFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-dvh overflow-y-auto">
      <main className="mx-auto w-full max-w-4xl space-y-8 px-4 pt-8 pb-24 md:px-10">{children}</main>
    </div>
  );
}

function Review() {
  const data = Route.useLoaderData();
  const { token } = Route.useParams();
  const video = useRef<HTMLVideoElement>(null);
  const [comments, setComments] = useState(data.comments);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/r/${token}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, body, time: video.current?.currentTime ?? 0 }),
      });
      const json = (await res.json()) as { comments?: typeof comments; error?: string };
      if (!res.ok || !json.comments) throw new Error(json.error ?? "The comment wasn't sent.");
      setComments(json.comments);
      setBody("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The comment wasn't sent.");
    } finally {
      setPending(false);
    }
  }

  return (
    <ReviewFrame>
      <PageHeader title={data.title} />
      {data.hasExport ? (
        <video ref={video} data-testid="review-video" src={`/r/${token}/video`} controls playsInline className="max-h-[70vh] w-full rounded-lg bg-muted" />
      ) : (
        <EmptyState title="Nothing to watch yet" description="The video will appear here once it's exported." />
      )}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Comments</h2>
        <form onSubmit={submit} className="space-y-3 rounded-lg border border-border bg-card p-4">
          <div className="space-y-1">
            <Label htmlFor="review-name">Your name</Label>
            <Input id="review-name" data-testid="review-name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="review-comment">Comment at the video's current time</Label>
            <Textarea id="review-comment" data-testid="review-comment" required maxLength={2000} rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" data-testid="review-submit" pending={pending}>
            Send
          </Button>
        </form>
        <ul className="space-y-2">
          {comments.map((c) => (
            <li key={c.id} data-testid="review-comment-item" className="rounded-md border border-border p-3 text-sm">
              <div className="flex gap-2 text-xs text-muted-foreground">
                <button type="button" className="font-mono text-primary" onClick={() => { if (video.current) video.current.currentTime = c.time; }}>
                  {formatSeconds(c.time)}
                </button>
                <span>{c.authorName}</span>
              </div>
              <p className="whitespace-pre-wrap">{c.body}</p>
            </li>
          ))}
        </ul>
      </section>
    </ReviewFrame>
  );
}
