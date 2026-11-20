import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { reviewData } from "@/server/comments";

/**
 * The review page's data. No member middleware: review links are for people
 * outside the organization, and the unguessable token is the check. The page
 * loads it during server rendering only.
 */
export const getReview = createServerFn({ method: "GET" })
  .validator((data: unknown) => z.object({ token: z.string().max(64) }).strict().parse(data))
  .handler(({ data }) => reviewData(data.token));
