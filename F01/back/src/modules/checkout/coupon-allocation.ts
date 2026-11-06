export function allocateCouponDiscount(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  if (!Number.isFinite(total) || !weights.every((w) => Number.isFinite(w))) {
    return weights.map(() => 0);
  }
  if (total <= 0 || weights.some((w) => w < 0)) {
    return weights.map(() => 0);
  }
  const sumWeights = weights.reduce((acc, w) => acc + w, 0);
  if (sumWeights <= 0) {
    return weights.map(() => 0);
  }

  const floors: number[] = [];
  const remainders: { index: number; remainder: number }[] = [];
  let allocated = 0;
  for (let i = 0; i < weights.length; i++) {
    const exact = (weights[i] / sumWeights) * total;
    const floor = Math.floor(exact);
    floors.push(floor);
    allocated += floor;
    remainders.push({ index: i, remainder: exact - floor });
  }

  let remaining = total - allocated;
  // largest remainder first; tie-break by input order (stable sort)
  const order = remainders
    .map((r, i) => ({ ...r, order: i }))
    .sort((a, b) => {
      if (b.remainder !== a.remainder) return b.remainder - a.remainder;
      return a.order - b.order;
    });

  const result = [...floors];
  for (let k = 0; k < remaining; k++) {
    result[order[k].index] += 1;
  }

  return result;
}