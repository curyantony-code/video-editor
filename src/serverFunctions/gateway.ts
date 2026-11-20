import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { ConfigurationError, gatewayUrl } from "@every-app/sdk/server";
import { ensureUserMiddleware } from "@every-app/sdk/tanstack-start";

/** The Gateway's origin: the way back to the other apps, and the shared theme cookie's host. */
export const getGatewayUrl = createServerFn()
  .middleware([ensureUserMiddleware])
  .handler(() => {
    try {
      return { gatewayUrl: new URL(gatewayUrl(env)).origin };
    } catch (error) {
      if (!(error instanceof ConfigurationError)) throw error;
      return { gatewayUrl: null };
    }
  });
