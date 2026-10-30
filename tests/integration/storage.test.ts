import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { download, publicUrl, upload, uploadFromUrl } from "@/lib/storage";

describe("storage (local driver)", () => {
  it("round-trips bytes and copies from a URL", async () => {
    await upload("ad-finals/t/a.txt", new TextEncoder().encode("hello"), "text/plain");
    expect(new TextDecoder().decode(await download("ad-finals/t/a.txt"))).toBe("hello");
    expect(publicUrl("ad-finals/t/a.txt")).toMatch(/\/api\/local-storage\/ad-finals\/t\/a\.txt$/);

    const server = createServer((_q, r) => {
      r.writeHead(200, { "content-type": "image/png" });
      r.end(Buffer.from([137, 80, 78, 71]));
    });
    await new Promise<void>((ok) => server.listen(0, ok));
    const port = (server.address() as { port: number }).port;
    const res = await uploadFromUrl("product-images/b/p/0.png", `http://127.0.0.1:${port}/x.png`);
    server.close();
    expect(res.contentType).toBe("image/png");
    expect([...(await download("product-images/b/p/0.png"))]).toEqual([137, 80, 78, 71]);
  });
  it("refuses unknown buckets and path escapes", async () => {
    await expect(download("secrets/x")).rejects.toThrow(/bad storage path/);
    await expect(download("ad-finals/../../etc/passwd")).rejects.toThrow(/escapes/);
  });
});
