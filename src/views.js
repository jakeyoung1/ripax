/**
 * HTML rendering. Pure string builders — no state, no listeners. Every value
 * that reaches markup goes through esc()/attr(): card names, artists and set
 * names come from a third-party API, so they are untrusted text.
 */

import { imageUrl, rarityTier } from './engine.js';

const TIER_GLOW = {
  2: 'var(--t2)', 3: 'var(--t3)', 4: 'var(--t4)', 5: 'var(--t5)',
  6: 'var(--t6)', 7: 'var(--t7)', 8: 'var(--t8)', 9: 'var(--t9)',
};

const VARIANT_LABEL = { n: '', h: 'holo', r: 'reverse holo' };

export function glowFor(tier) {
  return TIER_GLOW[tier] || '';
}

export function esc(value) {
  return String(value ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
}

export function attr(value) {
  return esc(value).replace(/"/g, '&quot;');
}

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export function money(amount) {
  return USD.format(amount || 0);
}

/** Compact money for tiles: $1,204 rather than $1,204.37. */
export function money0(amount) {
  return `$${Math.round(amount || 0).toLocaleString()}`;
}

/**
 * A 1x1 transparent gif stands in when an image 404s, which happens for a
 * handful of oddly numbered promo cards.
 */
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

export function cardImage(setId, card, { hires = false, alt = '', lazy = false, eager = false } = {}) {
  const src = imageUrl(setId, card, { hires });

  // No source has art for this set: draw a card-shaped panel naming the card
  // rather than showing a card back, which would misrepresent what was pulled.
  if (src === null) {
    return `<div class="noart" role="img" aria-label="${attr(alt || card.n || 'card')}">
      <span class="noart-name">${esc(card.n || `#${card.i}`)}</span>
      <span class="noart-note">no art available</span>
    </div>`;
  }

  // decoding="async" always: decoding a 600x825 PNG on the main thread is what
  // makes a flip stutter. onload clears the skeleton behind the image.
  return `<img src="${attr(src)}" alt="${attr(alt || card.n)}" decoding="async"
    ${lazy ? 'loading="lazy"' : ''}${eager ? ' fetchpriority="high"' : ''}
    onload="this.closest('.loading-shim')?.classList.remove('loading-shim')"
    onerror="this.onerror=null;this.src='${BLANK}';this.style.background='var(--bg-raise-2)';this.closest('.loading-shim')?.classList.remove('loading-shim')">`;
}

// ── set picker ─────────────────────────────────────────────────────

export function renderSetGroups(sets) {
  const groups = new Map();
  for (const set of sets) {
    if (!groups.has(set.series)) groups.set(set.series, []);
    groups.get(set.series).push(set);
  }

  // Newest era first; newest set first inside each era.
  const ordered = [...groups.entries()].sort(
    (a, b) => latest(b[1]).localeCompare(latest(a[1])),
  );

  return ordered.map(([series, list]) => `
    <section class="era-group">
      <h2 class="era-title">${esc(series)} <span>${list.length}</span></h2>
      <div class="set-grid">
        ${list
          .slice()
          .sort((a, b) => b.released.localeCompare(a.released))
          .map(setCard)
          .join('')}
      </div>
    </section>`).join('');
}

function latest(list) {
  return list.reduce((max, s) => (s.released > max ? s.released : max), '');
}

function setCard(set) {
  const year = set.released.slice(0, 4);
  return `
    <button class="set-card ${set.priced ? '' : 'unpriced'}" data-set="${attr(set.id)}" type="button"
            aria-label="${attr(`${set.name}, ${year}, ${set.cards} cards`)}">
      <span class="set-logo">
        ${set.logo ? `<img src="${attr(set.logo)}" alt="" loading="lazy" decoding="async">` : ''}
      </span>
      <span class="set-name">${esc(set.name)}</span>
      <span class="set-meta">
        <span>${year} · ${set.cards} cards</span>
        ${set.priced ? '' : '<span class="noprice">no prices</span>'}
      </span>
    </button>`;
}

// ── product picker ─────────────────────────────────────────────────

export function renderProductHead(set, era) {
  return `
    ${set.logo ? `<img src="${attr(set.logo)}" alt="">` : ''}
    <div>
      <h2>${esc(set.name)}</h2>
      <div class="sub">
        ${esc(era.label)} · released ${esc(set.released)} · ${set.cards} cards
        ${set.priced ? '' : ' · no price data'}
      </div>
    </div>`;
}

export function renderProducts(options) {
  return options.map((option) => `
    <button class="product" data-product="${attr(option.key)}" type="button"
            aria-label="${attr(`Open ${option.label}, ${option.packs} packs, ${money(option.cost)}`)}">
      <h3>${esc(option.label)}</h3>
      <div class="packs">${option.packs} pack${option.packs === 1 ? '' : 's'}</div>
      <div class="cost">${money(option.cost)}<small>original MSRP</small></div>
    </button>`).join('');
}

// ── results ────────────────────────────────────────────────────────

export function renderResults({ set, era, result }) {
  const packs = result.packs.length;
  const priced = result.pricesAvailable;
  const up = result.profit >= 0;

  const verdict = priced
    ? `
      <div class="verdict">
        <div class="line1">
          ${esc(set.name)} · ${packs} pack${packs === 1 ? '' : 's'} ·
          ${money(result.cost)} spent
        </div>
        <div class="big ${up ? 'up' : 'down'}">
          ${up ? '+' : '−'}${money(Math.abs(result.profit)).replace('$', '$')}
        </div>
        <div class="line2">
          pulled ${money(result.value)} of cards —
          ${up ? 'you came out ahead' : `you're down ${money(Math.abs(result.profit))}`}
        </div>
      </div>`
    : `
      <div class="verdict">
        <div class="line1">${esc(set.name)} · ${packs} pack${packs === 1 ? '' : 's'}</div>
        <div class="big">${result.cards.length} cards</div>
        <div class="line2">No market prices on file for this set yet, so there's no value readout.</div>
      </div>`;

  const notice = !priced
    ? `<p class="notice">${esc(set.name)} is new enough that no price source covers it yet.
       Rerun <code>scripts/enrich_prices.py</code> once prices appear.</p>`
    : result.unpricedCards
      ? `<p class="notice">${result.unpricedCards} of ${result.cards.length} cards pulled have no
         price on file and counted as $0, so the real value is a little higher.</p>`
      : '';

  const stats = priced ? `
    <div class="stat-row">
      ${tile('Spent', money(result.cost))}
      ${tile('Pulled', money(result.value))}
      ${tile('Per pack', money(result.value / packs))}
      ${tile('Return', `${Math.round((result.value / (result.cost || 1)) * 100)}%`)}
      ${tile('Cards', result.cards.length.toLocaleString())}
    </div>
    <p class="fineprint" style="margin:-18px 0 30px">
      Every card is counted at its TCGplayer market price, commons included.
      Real bulk sells for far less than market, so treat this as the ceiling,
      not what you'd actually get for the pile.
    </p>` : '';

  return `
    <button class="back" data-nav="sets" type="button">← All sets</button>
    ${verdict}
    ${notice}
    ${stats}
    ${result.best ? bestPull(set, result, priced) : ''}
    ${packs === 1 ? pricedSpread(set, result, priced) : notables(set, result, priced)}
    ${rarityTable(result)}
    <div class="actions">
      <button class="btn" data-act="again" type="button">Rip another ${esc(productNoun(result.product))}</button>
      <button class="btn sec" data-act="another" type="button">Different product</button>
      <button class="btn sec" data-nav="sets" type="button">Different set</button>
      <button class="btn sec" data-nav="collection" type="button">View collection</button>
    </div>
    ${packs === 1 ? '' : fullList(set, result, priced)}`;
}

function productNoun(key) {
  return { pack: 'pack', box: 'box', etb: 'ETB' }[key] || 'product';
}

function tile(key, value) {
  return `<div class="stat"><div class="k">${esc(key)}</div><div class="v">${esc(value)}</div></div>`;
}

function bestPull(set, result, priced) {
  const best = result.best;
  const glow = glowFor(best.tier);
  const variant = VARIANT_LABEL[best.variant];
  return `
    <h3 class="section-title">Best pull</h3>
    <div class="best-wrap">
      <div class="card-shell ${best.tier >= 3 ? 'foil' : ''} ${glow ? 'glow' : ''}"
           ${glow ? `style="--gl:${glow};border-radius:11px"` : ''}>
        ${cardImage(set.id, best.card, { hires: true, alt: best.card.n })}
      </div>
      <div class="info">
        <div class="nm">${esc(best.card.n)}</div>
        <div class="rr">
          ${esc(best.card.r)}${variant ? ` · ${variant}` : ''} · #${esc(best.card.i)}
          ${best.card.a ? ` · art by ${esc(best.card.a)}` : ''}
        </div>
        ${priced ? `<div class="pr">${money(best.price)}</div>` : ''}
      </div>
    </div>`;
}

/** Hits worth looking at, deduped, richest first. Keeps the DOM (and image
 *  requests) sane when a booster box produces 360 cards. */
/**
 * A single pack is small enough to price every card, which is the point of the
 * summary now that value is withheld during the rip. Boxes fall through to the
 * notable-pulls view — 360 priced tiles would be a wall, not a reveal.
 */
function pricedSpread(set, result, priced) {
  const rows = result.cards
    .slice()
    .sort((a, b) => b.price - a.price || b.tier - a.tier);

  return `
    <h3 class="section-title">Every card, by value</h3>
    <div class="card-grid">${rows.map((pull) => mini(set, pull, 1, priced)).join('')}</div>`;
}

function notables(set, result, priced) {
  const seen = new Map();
  for (const pull of result.cards) {
    if (pull.tier < 3 && !(priced && pull.price >= 1)) continue;
    const key = `${pull.card.i}:${pull.variant}`;
    const found = seen.get(key);
    if (found) found.count += 1;
    else seen.set(key, { pull, count: 1 });
  }
  if (!seen.size) return '';

  const list = [...seen.values()]
    .sort((a, b) => b.pull.price - a.pull.price || b.pull.tier - a.pull.tier)
    .slice(0, 40);

  return `
    <h3 class="section-title">Notable pulls (${seen.size})</h3>
    <div class="card-grid">${list.map(({ pull, count }) => mini(set, pull, count, priced)).join('')}</div>`;
}

function mini(set, pull, count, priced) {
  const glow = glowFor(pull.tier);
  const variant = VARIANT_LABEL[pull.variant];
  return `
    <div class="mini ${pull.tier >= 3 ? 'foil' : ''} ${glow ? 'glow' : ''}"
         ${glow ? `style="--gl:${glow};border-radius:8px"` : ''}>
      ${count > 1 ? `<span class="dupe">×${count}</span>` : ''}
      ${cardImage(set.id, pull.card, { lazy: true, alt: pull.card.n })}
      <div class="cap">
        <span>${esc(pull.card.n)}${variant ? ` <i>${variant[0]}</i>` : ''}</span>
        ${priced ? `<b>${money(pull.price)}</b>` : ''}
      </div>
    </div>`;
}

function rarityTable(result) {
  const rows = Object.entries(result.byRarity)
    .sort((a, b) => rarityTier(b[0]) - rarityTier(a[0]) || b[1] - a[1]);
  return `
    <h3 class="section-title" style="margin-top:32px">What came out</h3>
    <table class="rarity-table">
      ${rows.map(([rarity, count]) => `
        <tr><td>${esc(rarity)}</td><td>${count}</td></tr>`).join('')}
    </table>`;
}

function fullList(set, result, priced) {
  return `
    <details class="more">
      <summary>Every card, pack by pack (${result.cards.length})</summary>
      ${result.packs.map((pack, i) => `
        <h3 class="section-title" style="margin-top:18px">Pack ${i + 1}</h3>
        <div class="card-grid">
          ${pack.map((pull) => mini(set, pull, 1, priced)).join('')}
        </div>`).join('')}
    </details>`;
}
