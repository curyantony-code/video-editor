// Model calls through the Gateway's OpenRouter provider. With no key set the
// Gateway refuses, and the organization's AI help shows as off.
import { env } from "cloudflare:workers";
import {
  aiBaseUrl,
  createGatewayFetch,
  GatewayRefusalError,
  refusalFromError,
} from "@every-app/sdk/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { aiState } from "@/db/schema";
import type { Actor } from "./access";

export const MODEL = "openai/gpt-4o-mini";

export class AiOff extends Error {
  constructor() {
    super("AI help is off.");
  }
}

type Content = string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;

/** Asks the model for a JSON object. Throws AiOff when no provider is set. */
export async function askJson(
  actor: Actor,
  task: string,
  system: string,
  user: Content,
): Promise<unknown> {
  const gatewayFetch = createGatewayFetch({ env });
  let response: Response;
  try {
    response = await gatewayFetch(`${aiBaseUrl("openrouter")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: `TASK:${task}\n${system}\nAnswer with one JSON object only.` },
          { role: "user", content: user },
        ],
      }),
    });
  } catch (error) {
    if (error instanceof GatewayRefusalError || refusalFromError(error)) {
      await setOff(actor, true);
      throw new AiOff();
    }
    throw error;
  }
  if (!response.ok) {
    if (response.headers.get("x-everyapp-error") || response.status === 503 || response.status === 403) {
      await setOff(actor, true);
      throw new AiOff();
    }
    throw new Error(`The model didn't answer (${response.status}).`);
  }
  await setOff(actor, false);
  const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = body.choices?.[0]?.message?.content ?? "";
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  try {
    return JSON.parse(json);
  } catch {
    throw new Error("The model's answer couldn't be read. Try again.");
  }
}

async function setOff(actor: Actor, off: boolean) {
  await db
    .insert(aiState)
    .values({ orgId: actor.orgId, off })
    .onConflictDoUpdate({ target: aiState.orgId, set: { off, checkedAt: new Date().toISOString() } });
}

/** Whether the last call found AI help off for this organization. */
export async function aiIsOff(actor: Actor): Promise<boolean> {
  const [row] = await db.select({ off: aiState.off }).from(aiState).where(eq(aiState.orgId, actor.orgId));
  return row?.off ?? false;
}

/** Runs AI work, turning AiOff into a state the page shows. */
export async function withAi<T>(work: () => Promise<T>): Promise<{ off: true } | { off: false; result: T }> {
  try {
    return { off: false, result: await work() };
  } catch (error) {
    if (error instanceof AiOff) return { off: true };
    throw error;
  }
}
