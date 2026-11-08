import { safeMinor, sumMinor, CouponError } from '../coupon/coupon.domain';

/** Exact largest remainder allocation; identity, not request order, breaks ties. */
export function allocateMinorDiscount(total: number, lines: { key: string; weight: number }[]): number[] {
  safeMinor(total);
  const sum = sumMinor(lines.map(l => l.weight));
  if (total > sum || new Set(lines.map(l => l.key)).size !== lines.length) throw new CouponError('INVALID_MONEY');
  if (!sum) return lines.map(() => 0);
  const divisor = BigInt(sum);
  const ranked = lines.map((line, index) => {
    const numerator = BigInt(total) * BigInt(line.weight);
    return { index, key: line.key, floor: Number(numerator / divisor), remainder: numerator % divisor };
  });
  const result = ranked.map(r => r.floor);
  ranked.sort((a, b) => a.remainder === b.remainder ? (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) : a.remainder > b.remainder ? -1 : 1);
  const remaining = total - sumMinor(result);
  for (let i = 0; i < remaining; i++) result[ranked[i].index]++;
  return result;
}

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
