/**
 * Seedable RNG. The engine takes a random source as a parameter so tests can
 * assert exact rolls and distributions instead of hoping Math.random cooperates.
 */

/** mulberry32: small, fast, good enough spread for pack rolls. */
export function seeded(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const systemRandom = () => Math.random();

/** Pick one item from `items` using parallel `weights`. Weights need not sum to 1. */
export function weightedPick(items, weights, rng) {
  let total = 0;
  for (const w of weights) total += w;
  if (total <= 0) return items[Math.floor(rng() * items.length)];

  let roll = rng() * total;
  for (let i = 0; i < items.length; i += 1) {
    roll -= weights[i];
    if (roll <= 0) return items[i];
  }
  return items[items.length - 1];
}

export function pickOne(items, rng) {
  return items[Math.floor(rng() * items.length)];
}
