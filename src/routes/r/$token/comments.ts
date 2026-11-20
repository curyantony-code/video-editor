import { createFileRoute } from "@tanstack/react-router";
import { addReviewComment, reviewCommentInput } from "@/server/comments";
import { notFound } from "@/server/route";

// Public: a review visitor's comment, under the name they give.
export const Route = createFileRoute("/r/$token/comments")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const text = await request.text();
        if (text.length > 8000) return Response.json({ error: "Too long" }, { status: 400 });
        let body: unknown;
        try {
          body = JSON.parse(text);
        } catch {
          return Response.json({ error: "Send JSON" }, { status: 400 });
        }
        const parsed = reviewCommentInput.safeParse(body);
        if (!parsed.success) return Response.json({ error: "Give a name and a comment of up to 2,000 characters." }, { status: 400 });
        const data = await addReviewComment(params.token, parsed.data);
        if (!data) return notFound();
        return Response.json(data, { status: 201 });
      },
    },
  },
});
