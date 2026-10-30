import { env } from "@/lib/env";
import { sleep } from "@/lib/util";
import { buildScene, layoutFromPrompt, paletteFromPrompt } from "@/lib/compose/scene-builder";

export type SceneRequest = {
  prompt: string;
  /** Public URL of the product photo in our Storage (live models fetch it). */
  referenceUrl: string;
  /** Same photo's bytes (mock builds the scene locally). */
  referenceBytes: Uint8Array;
  seed?: number;
};
export type SceneResult = { bytes?: Uint8Array; url?: string; model: string; seed: number | null };

export interface ImageGenerator {
  generate(req: SceneRequest): Promise<SceneResult>;
}

/** Every call is counted so tests can assert "zero image calls" (spy) and retries. */
export const imageCalls: SceneRequest[] = [];

export function imageGenerator(): ImageGenerator {
  const e = env();
  if (e.AI_MODE === "mock") return mockGenerator;
  return withBudget(e.IMAGE_MODEL.startsWith("fal-ai/") ? falGenerator : gatewayGenerator);
}

/** Hard cap on paid image calls per process (LIVE_IMAGE_CALL_LIMIT). Smoke tests set it to 1. */
let liveImageCalls = 0;
function withBudget(g: ImageGenerator): ImageGenerator {
  return {
    async generate(req) {
      const limit = Number(process.env.LIVE_IMAGE_CALL_LIMIT ?? "Infinity");
      if (liveImageCalls >= limit) throw new Error(`live image call limit reached (${limit})`);
      liveImageCalls++;
      return g.generate(req);
    },
  };
}

const mockGenerator: ImageGenerator = {
  async generate(req) {
    imageCalls.push(req);
    const e = env();
    if (e.MOCK_IMAGE_DELAY_MS) await sleep(e.MOCK_IMAGE_DELAY_MS);
    if (e.MOCK_IMAGE_FAIL === "1") throw new Error("mock image model failure (MOCK_IMAGE_FAIL=1)");
    const bytes = await buildScene(req.referenceBytes, layoutFromPrompt(req.prompt), paletteFromPrompt(req.prompt));
    return { bytes: new Uint8Array(bytes), model: "mock-scene", seed: req.seed ?? 0 };
  },
};

const falGenerator: ImageGenerator = {
  async generate(req) {
    imageCalls.push(req);
    const e = env();
    if (!e.FAL_KEY) throw new Error("FAL_KEY not configured");
    const { fal } = await import("@fal-ai/client");
    fal.config({ credentials: e.FAL_KEY });
    const seed = req.seed ?? Math.floor(Math.random() * 2 ** 31);
    const result = await fal.subscribe(e.IMAGE_MODEL, {
      input: { prompt: req.prompt, image_urls: [req.referenceUrl], aspect_ratio: "9:16", num_images: 1, output_format: "png", seed },
      logs: false,
    });
    const url = (result.data as { images?: { url: string }[] }).images?.[0]?.url;
    if (!url) throw new Error(`${e.IMAGE_MODEL} returned no image`);
    return { url, model: e.IMAGE_MODEL, seed };
  },
};

/** Image-output language models through AI Gateway (e.g. google/gemini-3.1-flash-image): reference photo in, scene out. */
const gatewayGenerator: ImageGenerator = {
  async generate(req) {
    imageCalls.push(req);
    const e = env();
    const { generateText } = await import("ai");
    const result = await generateText({
      model: e.IMAGE_MODEL,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: `Edit this product photo into a new vertical 9:16 ad scene.\n${req.prompt}` },
            { type: "file", data: req.referenceBytes, mediaType: "image/jpeg" },
          ],
        },
      ],
      providerOptions: { google: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "9:16" } } },
    });
    const file = result.files.find((f) => f.mediaType.startsWith("image/"));
    if (!file) throw new Error(`${e.IMAGE_MODEL} returned no image`);
    return { bytes: file.uint8Array, model: e.IMAGE_MODEL, seed: null };
  },
};
