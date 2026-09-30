export function conciseSummary(value: string) {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return "";
  const sentences = [...new Intl.Segmenter(undefined, { granularity: "sentence" }).segment(text)]
    .map(({ segment }) => segment.trim()).filter(Boolean).slice(0, 2);
  const summary = sentences.join(" ").replace(/([。！？])\s+/g, "$1");
  if (summary.length <= 220) return summary;
  const prefix = summary.slice(0, 219);
  const lastSpace = prefix.lastIndexOf(" ");
  const end = lastSpace >= 140 ? lastSpace : prefix.length;
  return `${prefix.slice(0, end).replace(/[\s,，;；:：-]+$/, "")}…`;
}
