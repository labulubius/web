const AMP_ENTITY = /&(?:amp|#0*38|#x0*26);/gi;

export function normalizeNewsArticleUrl(value: string) {
  let decoded = value.trim();
  // Feed readers can leave XML entities encoded (or encode them again).
  // Decode only ampersands, because they delimit URL parameters and do not
  // introduce a new URL scheme. The fixed bound handles historical rows safely.
  for (let pass = 0; pass < 3; pass++) {
    const next = decoded.replace(AMP_ENTITY, "&");
    if (next === decoded) break;
    decoded = next;
  }
  try {
    return ["http:", "https:"].includes(new URL(decoded).protocol) ? decoded : "";
  } catch {
    return "";
  }
}
