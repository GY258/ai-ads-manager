import { env } from "@/lib/env";
import { fixtureResponse } from "./fixture-http";

/**
 * All store HTTP (Shopify JSON, homepages, CDN images) goes through here.
 * Mock mode serves recorded fixtures for known domains; tests set FIXTURE_HTTP=0 and let MSW answer real fetches.
 */
export async function httpGet(url: string, init: RequestInit = {}): Promise<Response> {
  if (env().AI_MODE === "mock" && process.env.FIXTURE_HTTP !== "0") {
    const hit = fixtureResponse(url);
    if (hit) return hit;
  }
  return fetch(url, {
    ...init,
    headers: { "user-agent": "Mozilla/5.0 (compatible; AIAdsManager/1.0)", accept: "*/*", ...init.headers },
    signal: init.signal ?? AbortSignal.timeout(15_000),
    redirect: "follow",
  });
}
