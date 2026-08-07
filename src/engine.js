/**
 * Pack roll engine. Pure functions: a card pool plus an era config in, rolled
 * packs out. No DOM, no fetch, no globals — everything the UI needs to render
 * comes back in the result object.
 *
 * Card records come from data/sets/{id}.json in the fetch script's slim shape:
 *   { i: number, n: name, r: rarity, p: { n?, h?, r? }, e?: 1|2, a?: artist }
 * where p maps a variant to its market price: n = normal, h = holofoil,
 * r = reverse holofoil.
 */

import { pickOne, systemRandom, weightedPick } from './rng.js';

export const VARIANT = { NORMAL: 'n', HOLO: 'h', REVERSE: 'r' };

/** Rarities that are printed as holos, so the holo price is the real price. */
const HOLO_RARITIES = /holo|ultra|secret|rainbow|shiny|illustration|hyper|star|prime|legend|break|lv\.x|radiant|amazing|ace spec|double rare|classic/i;

/**
 * Ordering for "biggest hit" and glow intensity. Higher = more of an event.
 *
 * Calibrated against median market value per rarity across every packable set,
 * not by how impressive the rarity's name sounds. That correction mattered: Gold
 * Stars (median $1,250) used to rank below Ultra Rares (median $2.47), and gold
 * Hyper Rares (median $8.40) used to trigger the full walkout.
 */
const RARITY_TIER = [
  // Genuine grails — median value in the hundreds or thousands.
  ['rare holo star', 9],          // Gold Stars, median ~$1250
  ['black white rare', 9],        // ~$595
  ['mega hyper rare', 9],         // ~$210
  ['rare shining', 9],            // Shining Charizard etc, ~$197
  ['legend', 9],                  // ~$180

  // Big money, just short of a grail.
  ['rare holo lv.x', 8],          // ~$100
  ['rare prime', 8],              // ~$73
  ['rare holo ex', 8],            // ~$37
  ['special illustration rare', 8], // ~$35

  ['rare shiny gx', 7],           // ~$26
  ['rare ultra', 7],              // ~$18
  ['rare secret', 7],             // ~$16, long tail to $300+
  ['rare rainbow', 7],            // ~$16

  ['illustration rare', 6],       // ~$13
  ['hyper rare', 6],              // scarce but only ~$8
  ['classic collection', 6],      // ~$6
  ['rare ace', 6],

  ['ultra rare', 5],              // SV full-art trainers, ~$2.50
  ['rare holo gx', 5],            // ~$6
  ['trainer gallery rare holo', 5], // ~$6
  ['amazing rare', 5],            // ~$5
  ['rare holo vmax', 5],          // ~$4
  ['shiny ultra rare', 5],        // ~$2

  ['rare break', 4],
  ['rare prism star', 4],
  ['rare holo vstar', 4],
  ['shiny rare', 4],
  ['rare shiny', 4],
  ['radiant rare', 4],
  ['double rare', 4],             // SV ex cards, median under $1
  ['rare holo v', 4],

  ['rare holo', 3],
  ['ace spec rare', 3],           // ~$0.58

  ['uncommon', 1],
  ['common', 0],
  ['rare', 2],
];

/**
 * Value can outrank rarity. A Base Set Charizard is only a "Rare Holo", but at
 * $800 it deserves the same fanfare as a modern grail — and grading purely on
 * the printed rarity would give it a polite blue pulse.
 */
const VALUE_TIER = [
  [400, 9], [150, 8], [60, 7], [25, 6], [12, 5], [6, 4], [3, 3],
];

export function valueTier(price) {
  const p = Number(price) || 0;
  for (const [floor, tier] of VALUE_TIER) if (p >= floor) return tier;
  return 0;
}

/** What the reveal should actually celebrate: the greater of rarity and value. */
export function pullTier(rarity, price) {
  return Math.max(rarityTier(rarity), valueTier(price));
}

export function rarityTier(rarity) {
  const key = String(rarity || '').toLowerCase();
  for (const [name, tier] of RARITY_TIER) {
    if (key === name) return tier;
  }
  // Unknown rarity: infer from wording rather than dumping it at the bottom.
  for (const [name, tier] of RARITY_TIER) {
    if (key.includes(name) && name !== 'rare') return tier;
  }
  return key.includes('rare') ? 2 : 0;
}

/** Resolve an era config, following `extends` chains. */
export function resolveEra(rules, series) {
  const eras = rules.eras || {};
  let name = eras[series] ? series : rules.fallbackEra;
  const chain = [];
  let guard = 0;

  while (name && eras[name] && guard < 10) {
    chain.push(eras[name]);
    name = eras[name].extends;
    guard += 1;
  }
  if (!chain.length) throw new Error(`no era config for series "${series}" and no usable fallback`);

  // Nearest definition wins; parents fill the gaps.
  const merged = {};
  for (let i = chain.length - 1; i >= 0; i -= 1) Object.assign(merged, chain[i]);
  merged.series = series;
  merged.matched = Boolean(eras[series]);
  return merged;
}

/** Group a set's cards by exact rarity string. */
export function groupByRarity(cards) {
  const groups = new Map();
  for (const card of cards) {
    const key = card.r || 'Unknown';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(card);
  }
  return groups;
}

/**
 * Precompute everything a roll needs once per set, so rolling 36 packs doesn't
 * regroup 250 cards 36 times.
 */
/**
 * Alternate prints that never came out of a booster pack.
 *
 * Several sets list cards numbered "101a", "143b" and so on alongside a plain
 * "101". Those lettered twins are alternate arts distributed through tins,
 * collection boxes, Trainer Kits and promos — not pack contents. Leaving them in
 * lets a pack yield things like the $381 Togepi & Cleffa & Igglybuff-GX from
 * Unified Minds, which wildly inflates both the chase pool and box EV.
 *
 * The plain twin existing in the same set is what identifies them. Prefixed
 * numbers like TG01, SV01, GG01 and H1 are different — those subsets really were
 * pack-pullable — and they don't match this shape.
 */
function withoutAlternatePrints(cards) {
  const numbers = new Set(cards.map((c) => String(c.i)));
  const packable = cards.filter((c) => {
    const twin = /^(\d+)[a-z]$/i.exec(String(c.i));
    return !(twin && numbers.has(twin[1]));
  });
  // If a set were somehow all lettered, keep everything rather than empty out.
  return packable.length ? packable : cards;
}

export function buildPool(allCards, era) {
  const cards = withoutAlternatePrints(allCards);
  const byRarity = groupByRarity(cards);

  // The energy slot holds a bulk basic energy. Sets like 151 also print a gold
  // secret-rare basic energy, which is a chase card from the hit slot — never
  // the guaranteed filler — so anything above uncommon is excluded here. It
  // stays reachable through byRarity, which the hit slot draws from directly.
  const isFillerEnergy = (c) => rarityTier(c.r) < 2;
  const basicEnergy = cards.filter((c) => c.e === 2 && isFillerEnergy(c));
  const anyEnergy = cards.filter((c) => c.e >= 1 && isFillerEnergy(c));

  // Hit-slot tiers the set actually contains, with weights renormalised over
  // just those. A set missing Illustration Rares redistributes that weight
  // instead of rolling a tier that cannot be filled.
  const hitRarities = [];
  const hitWeights = [];
  for (const [rarity, weight] of Object.entries(era.hitWeights || {})) {
    const pool = byRarity.get(rarity);
    if (pool && pool.length) {
      hitRarities.push(rarity);
      hitWeights.push(weight);
    }
  }

  // Nothing in the configured table exists here (odd promo-ish set): fall back
  // to the rarest tiers present so the hit slot still yields something special.
  if (!hitRarities.length) {
    const candidates = [...byRarity.keys()]
      .filter((r) => rarityTier(r) >= 2)
      .sort((a, b) => rarityTier(a) - rarityTier(b));
    for (const rarity of candidates) {
      hitRarities.push(rarity);
      hitWeights.push(1 / (1 + rarityTier(rarity)));
    }
  }

  return {
    cards,
    byRarity,
    basicEnergy,
    anyEnergy,
    hitRarities,
    hitWeights,
    reverseCandidates: cards.filter((c) => c.p && c.p.r !== undefined),
    unpriced: cards.every((c) => !c.p || Object.keys(c.p).length === 0),
  };
}

/** Which price variant a card pulled in this slot should be valued at. */
export function variantFor(card, slot) {
  const prices = card.p || {};
  if (slot.reverse) {
    if (prices.r !== undefined) return VARIANT.REVERSE;
    return prices.h !== undefined ? VARIANT.HOLO : VARIANT.NORMAL;
  }
  if (HOLO_RARITIES.test(card.r || '')) {
    if (prices.h !== undefined) return VARIANT.HOLO;
    return prices.n !== undefined ? VARIANT.NORMAL : VARIANT.REVERSE;
  }
  if (prices.n !== undefined) return VARIANT.NORMAL;
  return prices.h !== undefined ? VARIANT.HOLO : VARIANT.REVERSE;
}

export function priceOf(card, variant) {
  const prices = card.p || {};
  const direct = prices[variant];
  if (direct !== undefined) return direct;
  // Any known price beats reporting zero for a card that clearly has value.
  for (const key of [VARIANT.NORMAL, VARIANT.HOLO, VARIANT.REVERSE]) {
    if (prices[key] !== undefined) return prices[key];
  }
  return 0;
}

function drawFrom(candidates, isUsed, rng, tries = 12) {
  if (!candidates.length) return null;
  for (let i = 0; i < tries; i += 1) {
    const card = pickOne(candidates, rng);
    if (!isUsed(card)) return card;
  }
  // Small pool with everything already taken: allow the repeat rather than
  // shipping a short pack.
  return pickOne(candidates, rng);
}

function poolFor(pool, rarities) {
  const out = [];
  for (const rarity of rarities || []) {
    const group = pool.byRarity.get(rarity);
    if (group) out.push(...group);
  }
  // Basic energy is printed on its own row, so it is only ever reachable via
  // the energy slot. Leaving it in the common pool lets a set with a single
  // basic energy hand out the same card twice in one pack.
  const withoutEnergy = out.filter((c) => c.e !== 2);
  return withoutEnergy.length ? withoutEnergy : out;
}

/** Roll a single pack. Returns cards in reveal order, hit slot last. */
export function rollPack(pool, era, rng = systemRandom) {
  const used = new Set();
  const out = [];

  for (const slot of era.slots || []) {
    for (let n = 0; n < (slot.count || 1); n += 1) {
      let candidates;

      if (slot.hit) {
        const rarity = weightedPick(pool.hitRarities, pool.hitWeights, rng);
        candidates = pool.byRarity.get(rarity) || [];
      } else if (slot.energy) {
        candidates = pool.basicEnergy.length ? pool.basicEnergy : pool.anyEnergy;
        // Sets with no in-set energy (most modern ones) put a common here.
        if (!candidates.length) candidates = poolFor(pool, slot.pool);
      } else if (slot.reverse) {
        candidates = pool.reverseCandidates.length
          ? pool.reverseCandidates.filter(
              (c) => c.e !== 2 && (slot.pool || []).includes(c.r),
            )
          : [];
        if (!candidates.length) candidates = poolFor(pool, slot.pool);
      } else {
        candidates = poolFor(pool, slot.pool);
      }

      if (!candidates.length) candidates = pool.cards;
      // Keyed on the printing, not the card: a pack can legitimately hold both
      // the normal and the reverse holo of one card (separate print rows), but
      // never the same printing twice. Matches collateBox.
      const card = drawFrom(candidates, (c) => used.has(`${c.i}:${variantFor(c, slot)}`), rng);
      if (!card) continue;

      const variant = variantFor(card, slot);
      used.add(`${card.i}:${variant}`);
      const price = priceOf(card, variant);
      out.push({
        card,
        variant,
        price,
        tier: pullTier(card.r, price),
        isHit: Boolean(slot.hit),
        isReverse: Boolean(slot.reverse),
      });
    }
  }

  // Reveal order: hit slot last so the flip sequence builds to the chase card.
  out.sort((a, b) => Number(a.isHit) - Number(b.isHit));
  return out;
}

// ── box collation ──────────────────────────────────────────────────
//
// A real booster box is not 36 independent packs. Cards are printed on uncut
// sheets and the packs in a box are collated from them in sequence, which has
// two consequences worth modelling:
//
//   1. Hit counts per box are near-fixed. A modern box reliably yields about
//      6 Double Rares and 1 Special Illustration Rare — you almost never open a
//      box with zero, and almost never one with four. Rolling each pack
//      independently produces the right *average* but far too much variance.
//   2. Commons and uncommons cycle the sheet, so a box gives you close to a
//      full set of them rather than a random pile with lucky duplicates.
//
// Single packs still roll independently, which is correct: one pack really is
// one arbitrary draw off the sheet.

/** How often a box runs one chase tier hot, e.g. a two-secret-rare box. */
const HOT_BOX_CHANCE = 0.18;

/** Fisher-Yates, seeded through the injected rng. */
function shuffled(items, rng) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * A sheet dealer: hands out cards without replacement, reshuffling only once the
 * sheet is exhausted. This is what makes a box cover most of a set's commons.
 */
function sheetDealer(cards, rng) {
  let bag = [];
  return () => {
    if (!cards.length) return null;
    if (!bag.length) bag = shuffled(cards, rng);
    return bag.pop();
  };
}

/**
 * Decide the box's chase cards up front.
 *
 * Each configured rarity gets a quota of `packs * normalisedWeight`: the whole
 * part is guaranteed, and the fraction is settled with a single coin flip for
 * the whole box. So a 0.76-per-box Special Illustration Rare becomes "76% of
 * boxes contain exactly one", not a 36-trial binomial that sometimes yields
 * three and sometimes none.
 */
export function planBoxHits(pool, era, packs, rng) {
  const rarities = pool.hitRarities;
  const weights = pool.hitWeights;
  if (!rarities.length) return [];

  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const quotas = rarities.map((rarity, i) => {
    const expected = packs * (weights[i] / total);
    const whole = Math.floor(expected);
    const extra = rng() < expected - whole ? 1 : 0;
    return { rarity, count: whole + extra };
  });

  const bulkIndex = weights.indexOf(Math.max(...weights));

  // Pure quotas are too tidy: they make a two-secret-rare box impossible, and
  // those genuinely happen. Occasionally run one chase tier hot by a single card,
  // biased toward the rarer tiers, which restores the tail without bringing back
  // the binomial's wild spread.
  if (rng() < HOT_BOX_CHANCE) {
    const chase = quotas
      .map((q, i) => ({ i, tier: rarityTier(q.rarity) }))
      .filter((q) => q.tier >= 5);
    if (chase.length) {
      const pick = chase[Math.floor(rng() * chase.length)];
      quotas[pick.i].count += 1;
      if (pick.i !== bulkIndex) quotas[bulkIndex].count = Math.max(0, quotas[bulkIndex].count - 1);
    }
  }

  // The hit slots must add up to exactly one per pack. Drift is absorbed by the
  // bulk tier, never spread across the chase tiers: doing that inflates them and
  // makes a legitimate miss box (no secret rare at all) impossible.
  const surplus = packs - quotas.reduce((sum, q) => sum + q.count, 0);
  quotas[bulkIndex].count = Math.max(0, quotas[bulkIndex].count + surplus);

  // If the bulk tier bottomed out at zero we are still over budget. Trim from
  // the commonest tiers first so the rarest pull in the box survives.
  let over = quotas.reduce((sum, q) => sum + q.count, 0) - packs;
  if (over > 0) {
    const byCommonest = quotas
      .map((q, i) => ({ i, tier: rarityTier(q.rarity) }))
      .sort((a, b) => a.tier - b.tier);
    for (const { i } of byCommonest) {
      while (over > 0 && quotas[i].count > 0) { quotas[i].count -= 1; over -= 1; }
      if (over === 0) break;
    }
  }

  // Draw the actual cards. Sampling without replacement inside a rarity means a
  // box rarely contains the same secret rare twice, which matches sheet layout.
  const picks = [];
  for (const { rarity, count } of quotas) {
    const group = pool.byRarity.get(rarity) || [];
    if (!group.length || count <= 0) continue;
    let bag = shuffled(group, rng);
    for (let i = 0; i < count; i += 1) {
      if (!bag.length) bag = shuffled(group, rng);
      picks.push(bag.pop());
    }
  }
  return shuffled(picks, rng);
}

/**
 * Collate a whole box: plan the hits, then deal the bulk slots off sheets.
 * Returns an array of packs in the same shape rollPack produces.
 */
export function collateBox(pool, era, packs, rng = systemRandom) {
  const hits = planBoxHits(pool, era, packs, rng);

  const dealers = new Map();
  const dealerFor = (key, cards) => {
    if (!dealers.has(key)) dealers.set(key, sheetDealer(cards, rng));
    return dealers.get(key);
  };

  const out = [];
  for (let p = 0; p < packs; p += 1) {
    const used = new Set();
    const pack = [];

    for (const slot of era.slots || []) {
      for (let n = 0; n < (slot.count || 1); n += 1) {
        let card = null;
        let deal = null;

        if (slot.hit) {
          card = hits[p] ?? null;
          if (!card) {
            const fallback = poolFor(pool, ['Rare']).length ? poolFor(pool, ['Rare']) : pool.cards;
            deal = dealerFor('hit-fallback', fallback);
            card = deal();
          }
        } else if (slot.energy) {
          const energy = pool.basicEnergy.length ? pool.basicEnergy
            : pool.anyEnergy.length ? pool.anyEnergy
            : poolFor(pool, slot.pool);
          deal = dealerFor('energy', energy);
          card = deal();
        } else if (slot.reverse) {
          const reverses = pool.reverseCandidates.length
            ? pool.reverseCandidates.filter((c) => c.e !== 2 && (slot.pool || []).includes(c.r))
            : [];
          deal = dealerFor('reverse', reverses.length ? reverses : poolFor(pool, slot.pool));
          card = deal();
        } else {
          deal = dealerFor(`bulk:${(slot.pool || []).join(',')}`, poolFor(pool, slot.pool));
          card = deal();
        }

        if (!card) {
          deal = dealerFor('any', pool.cards);
          card = deal();
        }
        if (!card) continue;

        // Dedupe by PRINTING, not by card: a real pack can hold both the normal
        // and the reverse holo of the same card, since they come off separate
        // print rows. Two of the same printing in one pack cannot happen, so if
        // the sheet hands one back, take the next card from that same sheet.
        let variant = variantFor(card, slot);
        if (used.has(`${card.i}:${variant}`) && deal) {
          const retry = deal();
          if (retry && !used.has(`${retry.i}:${variantFor(retry, slot)}`)) {
            card = retry;
            variant = variantFor(card, slot);
          }
        }
        used.add(`${card.i}:${variant}`);

        const price = priceOf(card, variant);
        pack.push({
          card,
          variant,
          price,
          tier: pullTier(card.r, price),
          isHit: Boolean(slot.hit),
          isReverse: Boolean(slot.reverse),
        });
      }
    }

    pack.sort((a, b) => Number(a.isHit) - Number(b.isHit));
    out.push(pack);
  }
  return out;
}

export function packsInProduct(era, productKey, rules) {
  const product = (rules.products || {})[productKey];
  if (!product) throw new Error(`unknown product "${productKey}"`);
  const packs = product.packs;
  if (typeof packs === 'number') return packs;
  const count = (era.msrp || {})[packs];
  return typeof count === 'number' ? count : 0;
}

export function costOf(era, productKey, rules) {
  const msrp = era.msrp || {};
  if (productKey === 'pack') return msrp.pack || 0;
  if (productKey === 'box') return msrp.box || (msrp.pack || 0) * packsInProduct(era, 'box', rules);
  if (productKey === 'etb') return msrp.etb || (msrp.pack || 0) * packsInProduct(era, 'etb', rules);
  return 0;
}

/** Is this product sold for this era at all? (No ETBs existed before 2011.) */
export function productAvailable(era, productKey, rules) {
  return packsInProduct(era, productKey, rules) > 0;
}

/**
 * Roll a whole product and summarise it.
 * Returns { packs, cards, cost, value, profit, best, byRarity, unpricedCards }.
 */
export function rollProduct(pool, era, productKey, rules, rng = systemRandom) {
  const count = packsInProduct(era, productKey, rules);
  if (count <= 0) throw new Error(`product "${productKey}" is not sold for era "${era.series}"`);

  // One pack is genuinely one arbitrary draw off the sheet, so it rolls
  // independently. Anything sealed with multiple packs is collated as a unit.
  const packs = count === 1
    ? [rollPack(pool, era, rng)]
    : collateBox(pool, era, count, rng);

  const all = [];
  for (const pack of packs) all.push(...pack);

  let value = 0;
  let unpricedCards = 0;
  let best = null;
  const byRarity = {};

  for (const pull of all) {
    value += pull.price;
    if (!pull.price) unpricedCards += 1;
    const rarity = pull.card.r || 'Unknown';
    byRarity[rarity] = (byRarity[rarity] || 0) + 1;
    if (
      !best ||
      pull.price > best.price ||
      (pull.price === best.price && pull.tier > best.tier)
    ) {
      best = pull;
    }
  }

  const cost = costOf(era, productKey, rules);
  return {
    product: productKey,
    packs,
    cards: all,
    cost: round2(cost),
    value: round2(value),
    profit: round2(value - cost),
    best,
    byRarity,
    unpricedCards,
    pricesAvailable: !pool.unpriced,
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Per-set image-source overrides, populated from data/index.json at boot.
 *
 * images.pokemontcg.io has no art for a handful of very new sets, and rather
 * than 404 cleanly it serves a card-BACK image with a 404 status. Browsers paint
 * it, so an onerror fallback cannot catch it — the only fix is to not ask
 * pokemontcg.io for those sets at all. scripts/fix_images.py records where to
 * look instead.
 */
const imageOverrides = new Map();

export function registerImageSources(sets = []) {
  imageOverrides.clear();
  for (const set of sets) {
    if (set.imagesMissing) {
      imageOverrides.set(set.id, { missing: true });
    } else if (set.imageBase) {
      imageOverrides.set(set.id, { base: set.imageBase, pad: set.imagePad || 0 });
    }
  }
  return imageOverrides.size;
}

/** True when no source anywhere has art for this set, so the UI should draw its own. */
export function hasArt(setId) {
  return !imageOverrides.get(setId)?.missing;
}

/** Image URLs derive from ids, so nothing image-related is stored per card. */
export function imageUrl(setId, card, { hires = false, base = 'https://images.pokemontcg.io' } = {}) {
  const override = imageOverrides.get(setId);
  if (override?.missing) return null;

  if (override?.base) {
    // tcgdex zero-pads the number in its asset paths (me05/001, not me05/1).
    const number = String(card.i);
    const segment = override.pad && /^\d+$/.test(number)
      ? number.padStart(override.pad, '0')
      : number;
    return `${override.base}/${segment}/${hires ? 'high' : 'low'}.png`;
  }

  return `${base}/${setId}/${card.i}${hires ? '_hires' : ''}.png`;
}
