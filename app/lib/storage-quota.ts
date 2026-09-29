export const STORAGE_TOTAL_BYTES = 5 * 1024 ** 3;

export function fitsStorageQuota(committed: number, pending: number, output: number, total = STORAGE_TOTAL_BYTES) {
  return [committed, pending, output, total].every((value) => Number.isSafeInteger(value) && value >= 0) && committed + pending + output <= total;
}
