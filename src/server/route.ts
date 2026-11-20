import { getEveryAppUser } from "@every-app/sdk/server";
import { env } from "cloudflare:workers";
import { type Actor, actorOf, errorResponse } from "./access";

/** Runs a private server route as the signed-in member. */
export async function asMember(request: Request, work: (actor: Actor) => Promise<Response>): Promise<Response> {
  const user = await getEveryAppUser(request, env);
  if (!user) return Response.json({ error: "Sign in first" }, { status: 401 });
  try {
    return await work(await actorOf(user));
  } catch (error) {
    return errorResponse(error);
  }
}

const notFound = () => Response.json({ error: "Not found" }, { status: 404 });
export { notFound };

/** A Content-Disposition value for a download. */
export function attachment(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
