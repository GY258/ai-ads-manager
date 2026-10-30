/** Bundled fonts (public/fonts). Satori needs TTF/OTF; nothing is fetched at render time. Client-safe. */
export const FONTS = [
  { family: "Inter", category: "sans", files: { 400: "Inter-Regular.ttf", 800: "Inter-ExtraBold.ttf" } },
  { family: "Roboto", category: "sans", files: { 400: "Roboto-Regular.ttf", 800: "Roboto-ExtraBold.ttf" } },
  { family: "Montserrat", category: "sans", files: { 400: "Montserrat-Regular.ttf", 800: "Montserrat-ExtraBold.ttf" } },
  { family: "Poppins", category: "sans", files: { 400: "Poppins-Regular.ttf", 800: "Poppins-ExtraBold.ttf" } },
  { family: "Nunito", category: "rounded", files: { 400: "Nunito-Regular.ttf", 800: "Nunito-ExtraBold.ttf" } },
  { family: "Exo 2", category: "display", files: { 400: "Exo2-Regular.ttf", 800: "Exo2-ExtraBold.ttf" } },
  { family: "Bebas Neue", category: "display", files: { 400: "BebasNeue-Regular.ttf", 800: "BebasNeue-Regular.ttf" } },
  { family: "Playfair Display", category: "serif", files: { 400: "PlayfairDisplay-Regular.ttf", 800: "PlayfairDisplay-ExtraBold.ttf" } },
  { family: "Lora", category: "serif", files: { 400: "Lora-Regular.ttf", 800: "Lora-Bold.ttf" } },
] as const;

export type FontFamily = (typeof FONTS)[number]["family"];

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Map a detected brand font to the closest bundled one. */
export function closestFont(detected: string | null | undefined): FontFamily {
  if (!detected) return "Inter";
  const d = squash(detected);
  const exact = FONTS.find((f) => squash(f.family) === d || d.startsWith(squash(f.family)));
  if (exact) return exact.family;
  if (/serif|garamond|times|georgia|baskerville|caslon|didot|bodoni|merriweather|playfair/.test(d) && !/sans/.test(d)) return /display|didot|bodoni|playfair/.test(d) ? "Playfair Display" : "Lora";
  if (/rounded|nunito|quicksand|varela|comfortaa|fredoka/.test(d)) return "Nunito";
  if (/bebas|oswald|anton|league|condensed|impact/.test(d)) return "Bebas Neue";
  if (/futura|gotham|montserrat|avenir|proxima|brandon|gilroy/.test(d)) return "Montserrat";
  if (/poppins|circular|dm|manrope|outfit/.test(d)) return "Poppins";
  if (/roboto|open|lato|source|noto|arial|helvetica/.test(d)) return "Roboto";
  return "Inter";
}
