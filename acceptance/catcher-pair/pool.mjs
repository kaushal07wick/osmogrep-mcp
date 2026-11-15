export const capacity = 8;
export function acquireBatch(count) {
  if (count > capacity) throw new Error('capacity exhausted');
  return Array.from({ length: count }, (_, i) => i);
}
