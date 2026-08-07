/**
 * Collection view. Every card ever pulled, with how many times it was pulled,
 * filterable by set, rarity, illustrator and print variant.
 *
 * "Full art", "illustration rare", "special illustration rare", "hyper rare"
 * and friends are all rarity values as printed on the card, so the rarity filter
 * covers them. Holo and reverse holo are print variants rather than rarities,
 * which is why variant is tracked as its own axis and keyed separately.
 */

import { rarityTier } from './engine.js';
import { attr, cardImage, esc, glowFor, money } from './views.js';

export const VARIANT_NAME = { n: 'Normal', h: 'Holo', r: 'Reverse Holo' };
export const VARIANT_SHORT = { n: '', h: 'holo', r: 'rev' };

export const SORTS = {
  recent: { label: 'Recently pulled', compare: (a, b) => String(b.last_at).localeCompare(String(a.last_at)) },
  count: { label: 'Most pulled', compare: (a, b) => b.count - a.count || b.best_price - a.best_price },
  value: { label: 'Most valuable', compare: (a, b) => b.best_price - a.best_price },
  rarity: { label: 'Rarest', compare: (a, b) => rarityTier(b.rarity) - rarityTier(a.rarity) || b.best_price - a.best_price },
  name: { label: 'Name A–Z', compare: (a, b) => String(a.name || '').localeCompare(String(b.name || '')) },
};

export const state = {
  filters: { set: '', rarity: '', illustrator: '', variant: '', query: '' },
  sort: 'recent',
};

export function resetFilters() {
  state.filters = { set: '', rarity: '', illustrator: '', variant: '', query: '' };
}

export function applyFilters(rows) {
  const { set, rarity, illustrator, variant, query } = state.filters;
  const needle = query.trim().toLowerCase();

  const filtered = rows.filter((row) => {
    if (set && row.set_id !== set) return false;
    if (rarity && row.rarity !== rarity) return false;
    if (illustrator && row.illustrator !== illustrator) return false;
    if (variant && row.variant !== variant) return false;
    if (needle) {
      const haystack = `${row.name || ''} ${row.number} ${row.illustrator || ''} ${row.rarity || ''}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });

  return filtered.sort(SORTS[state.sort]?.compare || SORTS.recent.compare);
}

/**
 * Render the whole view. `setIndex` is data/index.json, used for set names and
 * completion percentages.
 */
export function renderCollection({ rows, facets, stats, source }, setIndex, user, options = {}) {
  const setMeta = new Map((setIndex?.sets || []).map((s) => [s.id, s]));
  const visible = applyFilters(rows);

  // Signed in with cards still sitting in this browser: always offer the copy,
  // so declining the one-time prompt never traps them here.
  const localPending = source === 'cloud' && options.localTotal > 0
    ? `<button class="btn sec" data-act="mergeyes" type="button">
         Copy ${options.localTotal.toLocaleString()} local cards to my account
       </button>`
    : '';

  if (!rows.length) {
    return `
      ${header(stats, source, user)}
      <p class="empty">
        Nothing collected yet. Open a pack and every card lands here —
        including each holo and reverse holo as its own entry.
      </p>
      <div class="actions">
        <button class="btn" data-nav="sets" type="button">Rip a pack</button>
        ${localPending}
      </div>`;
  }

  return `
    ${header(stats, source, user)}
    ${statTiles(stats)}
    ${bestEver(stats)}
    ${filterBar(facets, setMeta, rows.length, visible.length)}
    ${completion(facets, setMeta)}
    ${visible.length
      ? `<div class="card-grid">${visible.slice(0, 600).map((row) => cardTile(row, setMeta)).join('')}</div>
         ${visible.length > 600 ? `<p class="fineprint">Showing the first 600 of ${visible.length} — narrow the filters to see the rest.</p>` : ''}`
      : '<p class="empty">No cards match those filters.</p>'}
    <div class="actions">
      ${localPending}
      <button class="btn sec" data-act="export" type="button">Export JSON</button>
      <button class="btn sec" data-act="import" type="button">Import JSON</button>
      <button class="btn sec" data-nav="sets" type="button">Rip more</button>
      <button class="btn danger" data-act="wipe" type="button">Clear collection</button>
    </div>`;
}

function header(stats, source, user) {
  const where = source === 'cloud'
    ? `<span class="chip cloud">☁ synced to ${esc(user?.name || 'your account')}</span>`
    : '<span class="chip">this browser only</span>';
  return `
    <div class="binder-head">
      <h2>Collection</h2>
      <span class="chip">${(stats.uniqueCards || 0).toLocaleString()} unique</span>
      <span class="chip">${(stats.totalCards || 0).toLocaleString()} pulled</span>
      ${where}
    </div>`;
}

function statTiles(stats) {
  const profit = (stats.pulled || 0) - (stats.spent || 0);
  const up = profit >= 0;
  const tile = (k, v) => `<div class="stat"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`;
  return `
    <div class="stat-row">
      ${tile('Rips', (stats.rips || 0).toLocaleString())}
      ${tile('Packs', (stats.packs || 0).toLocaleString())}
      ${tile('Spent', money0(stats.spent))}
      ${tile('Pulled', money0(stats.pulled))}
      ${tile(up ? 'Up' : 'Down', `${up ? '+' : '−'}${money0(Math.abs(profit))}`)}
    </div>`;
}

function bestEver(stats) {
  const best = stats.best;
  if (!best) return '';
  const glow = glowFor(rarityTier(best.rarity));
  return `
    <h3 class="section-title">Best pull ever</h3>
    <div class="best-wrap">
      <div class="card-shell foil ${glow ? 'glow' : ''}" ${glow ? `style="--gl:${glow};border-radius:11px"` : ''}>
        ${cardImage(best.set_id, { i: best.number, n: best.name }, { hires: true, alt: best.name })}
      </div>
      <div class="info">
        <div class="nm">${esc(best.name)}</div>
        <div class="rr">
          ${esc(best.rarity || '')}${best.variant && best.variant !== 'n' ? ` · ${esc(VARIANT_NAME[best.variant])}` : ''}
          ${best.illustrator ? ` · illus. ${esc(best.illustrator)}` : ''}
        </div>
        <div class="pr">${money(best.best_price)}</div>
      </div>
    </div>`;
}

function filterBar(facets, setMeta, totalRows, visibleRows) {
  const option = (value, label, selected, count) =>
    `<option value="${attr(value)}"${selected ? ' selected' : ''}>${esc(label)}${count ? ` (${count})` : ''}</option>`;

  const setOptions = (facets.sets || [])
    .map((f) => option(f.set_id, setMeta.get(f.set_id)?.name || f.set_id, state.filters.set === f.set_id, f.unique_cards))
    .join('');

  // Rarity list ordered by the ladder, not by count: reads like a card binder.
  const rarityOptions = (facets.rarities || [])
    .slice()
    .sort((a, b) => rarityTier(b.rarity) - rarityTier(a.rarity))
    .map((f) => option(f.rarity, f.rarity, state.filters.rarity === f.rarity, f.unique_cards))
    .join('');

  const illustratorOptions = (facets.illustrators || [])
    .map((f) => option(f.illustrator, f.illustrator, state.filters.illustrator === f.illustrator, f.unique_cards))
    .join('');

  const variantOptions = (facets.variants || [])
    .slice()
    .sort((a, b) => ['n', 'h', 'r'].indexOf(a.variant) - ['n', 'h', 'r'].indexOf(b.variant))
    .map((f) => option(f.variant, VARIANT_NAME[f.variant] || f.variant, state.filters.variant === f.variant, f.unique_cards))
    .join('');

  const sortOptions = Object.entries(SORTS)
    .map(([key, s]) => option(key, s.label, state.sort === key))
    .join('');

  const active = Object.values(state.filters).some(Boolean);

  return `
    <div class="filters">
      <input id="col-search" type="search" placeholder="Search name, number, illustrator…"
             value="${attr(state.filters.query)}" autocomplete="off">
      <select id="col-set"><option value="">All sets</option>${setOptions}</select>
      <select id="col-rarity"><option value="">All rarities</option>${rarityOptions}</select>
      <select id="col-variant"><option value="">All variants</option>${variantOptions}</select>
      <select id="col-illustrator"><option value="">All illustrators</option>${illustratorOptions}</select>
      <select id="col-sort">${sortOptions}</select>
      ${active ? '<button class="ghost" data-act="clearfilters" type="button">Clear filters</button>' : ''}
      <span class="toolbar-count">${visibleRows.toLocaleString()} of ${totalRows.toLocaleString()}</span>
    </div>`;
}

/**
 * Per-set completion. Counts distinct card numbers owned against the set's card
 * count, so holo + reverse holo of one card count once toward the set, which is
 * how a physical binder works.
 */
function completion(facets, setMeta) {
  const sets = (facets.sets || []).slice(0, 12);
  if (!sets.length) return '';

  const rows = sets.map((f) => {
    const meta = setMeta.get(f.set_id);
    const total = meta?.cards || 0;
    const owned = f.unique_cards;
    const pct = total ? Math.min(100, Math.round((owned / total) * 100)) : 0;
    return `
      <button class="comp" data-filterset="${attr(f.set_id)}" type="button"
              aria-label="${attr(`Filter to ${meta?.name || f.set_id}`)}">
        <span class="comp-name">${esc(meta?.name || f.set_id)}</span>
        <span class="comp-bar"><span style="width:${total ? pct : 0}%"></span></span>
        <span class="comp-num">${owned.toLocaleString()}${total ? ` / ${total}` : ''}${total ? ` · ${pct}%` : ''}</span>
      </button>`;
  }).join('');

  return `<h3 class="section-title">Set progress</h3><div class="comp-list">${rows}</div>`;
}

function cardTile(row, setMeta) {
  const tier = rarityTier(row.rarity);
  const glow = glowFor(tier);
  const foil = tier >= 3 || row.variant !== 'n';
  const short = VARIANT_SHORT[row.variant];
  const setName = setMeta.get(row.set_id)?.name || row.set_id;

  return `
    <div class="mini col-card ${foil ? 'foil' : ''} ${glow ? 'glow' : ''}"
         ${glow ? `style="--gl:${glow};border-radius:8px"` : ''}
         title="${attr(`${row.name || `#${row.number}`} — ${setName} #${row.number}${row.rarity ? ` · ${row.rarity}` : ''}${short ? ` · ${VARIANT_NAME[row.variant]}` : ''}${row.illustrator ? ` · illus. ${row.illustrator}` : ''} — pulled ${row.count}×`)}">
      ${row.count > 1 ? `<span class="dupe">×${row.count}</span>` : ''}
      ${short ? `<span class="vtag ${row.variant}">${esc(short)}</span>` : ''}
      ${cardImage(row.set_id, { i: row.number, n: row.name || row.number }, { lazy: true, alt: row.name || `#${row.number}` })}
      <div class="col-meta">
        <div class="col-name">${esc(row.name || `#${row.number}`)}</div>
        <div class="col-sub">${esc(row.rarity || '—')}</div>
        ${row.illustrator ? `<div class="col-illus">illus. ${esc(row.illustrator)}</div>` : ''}
        <div class="col-foot">
          <span>#${esc(row.number)}</span>
          ${row.best_price ? `<b>${money(row.best_price)}</b>` : ''}
        </div>
      </div>
    </div>`;
}

function money0(amount) {
  return `$${Math.round(amount || 0).toLocaleString()}`;
}
