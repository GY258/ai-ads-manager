// Live scene-QA check: a scene built from the right product should pass, a wrong product should fail.
import { config } from "dotenv";
config({ path: ".env.local" });
process.env.AI_MODE = "live";
import { readFileSync } from "node:fs";

async function main() {
  const { runSceneQa, classify } = await import("../lib/pipeline/scene-qa");
  const reference = readFileSync("tests/fixtures/loopycases/images/cranberry-stripes-0.jpg");
  for (const name of ["lifestyle-top", "wrong-product"]) {
    const scene = readFileSync(`tests/fixtures/scenes/${name}.png`);
    const { qa } = await runSceneQa({ scene, reference, referenceType: "image/jpeg", layout: "top_headline" });
    console.log(name.padEnd(14), classify(qa).padEnd(6), JSON.stringify(qa));
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
