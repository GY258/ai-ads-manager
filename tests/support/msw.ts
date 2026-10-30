import { afterAll, afterEach, beforeAll } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { fixtureResponse } from "@/lib/adapters/fixture-http";

/** MSW serves the recorded store fixtures to real fetch() calls; anything else is a network error. */
export const mswServer = setupServer(
  http.all("*", ({ request }) => {
    const url = new URL(request.url);
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return; // local test servers pass through
    return fixtureResponse(request.url) ?? HttpResponse.error();
  }),
);

export function useMsw() {
  beforeAll(() => {
    process.env.FIXTURE_HTTP = "0";
    mswServer.listen();
  });
  afterEach(() => mswServer.resetHandlers());
  afterAll(() => {
    mswServer.close();
    delete process.env.FIXTURE_HTTP;
  });
}
