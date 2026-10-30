/** Canonical Shopify CDN image URL: https, no size suffix, no query. */
export function normalizeImageUrl(src: string): string {
  let u = src.trim();
  if (u.startsWith("//")) u = `https:${u}`;
  if (u.startsWith("http://")) u = `https://${u.slice(7)}`;
  const q = u.search(/[?#]/);
  if (q >= 0) u = u.slice(0, q);
  // cranberry5_720x960.jpg, x_200x.png, x_x200@2x.jpg, x_grande.jpg → cranberry5.jpg
  return u.replace(/_(?:\d+x\d*|x\d+|pico|icon|thumb|small|compact|medium|large|grande|original|master)(?:_crop_\w+)?(?:@\dx)?(\.\w+)$/i, "$1");
}

/** Ask the CDN for a bounded size so we don't copy 5000px originals. */
export function sizedImageUrl(src: string, width = 1600): string {
  return `${normalizeImageUrl(src)}?width=${width}`;
}
