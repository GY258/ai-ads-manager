import { env } from "@/lib/env";
import { download } from "@/lib/storage";

/** Serves the local storage driver's files (dev, tests, e2e). 404 when Supabase storage is active. */
export async function GET(_req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  if (env().STORAGE_DRIVER !== "local") return new Response("not found", { status: 404 });
  const { path } = await ctx.params;
  try {
    const bytes = await download(path.join("/"));
    const type = path.at(-1)?.endsWith(".png") ? "image/png" : path.at(-1)?.match(/\.jpe?g$/) ? "image/jpeg" : path.at(-1)?.endsWith(".webp") ? "image/webp" : "application/octet-stream";
    return new Response(Buffer.from(bytes), { headers: { "content-type": type, "cache-control": "public, max-age=31536000, immutable" } });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
