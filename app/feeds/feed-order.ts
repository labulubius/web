type Watchboard = { tagIds: string[] };

function sourceCreationSequence(id: string) {
  const match = /^feed\/(\d+)$/.exec(id);
  return match ? Number(match[1]) : Number.NEGATIVE_INFINITY;
}

export function sourceWatchboardCount(
  feedId: string,
  watchboards: Watchboard[],
  sourceTags: Record<string, string[]>,
) {
  const tags = new Set(sourceTags[feedId] ?? []);
  return watchboards.filter((board) => board.tagIds.length > 0 && board.tagIds.every((tagId) => tags.has(tagId))).length;
}

export function orderSourcesByWatchboards<T extends { id: string }>(
  sources: T[],
  watchboards: Watchboard[],
  sourceTags: Record<string, string[]>,
) {
  return sources.map((source) => ({
    source,
    count: sourceWatchboardCount(source.id, watchboards, sourceTags),
    sequence: sourceCreationSequence(source.id),
  })).sort((left, right) =>
    right.count - left.count ||
    right.sequence - left.sequence ||
    right.source.id.localeCompare(left.source.id)
  ).map(({ source }) => source);
}


export function orderTagsBySourceCount<T extends { id: string }>(
  tags: T[],
  sourceTags: Record<string, string[]>,
) {
  const counts = new Map<string, number>();
  for (const assignedTags of Object.values(sourceTags)) {
    for (const tagId of new Set(assignedTags)) counts.set(tagId, (counts.get(tagId) ?? 0) + 1);
  }
  return tags.map((tag, index) => ({ tag, count: counts.get(tag.id) ?? 0, index }))
    .sort((left, right) => right.count - left.count || right.index - left.index);
}
