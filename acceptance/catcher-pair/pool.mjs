export const capacity = 4;
export function acquireBatch(count) {
  if (count > capacity) throw new Error('capacity exhausted');
  return Array.from({ length: count }, (_, i) => i);
}
