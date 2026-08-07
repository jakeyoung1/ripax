/**
 * Ripax UI controller: data loading, view routing, reveal sequencing, auth.
 * Rendering lives in views.js / collection.js / auth-ui.js, roll logic in
 * engine.js, persistence behind store.js.
 */

import {
  buildPool,
  costOf,
  packsInProduct,
  productAvailable,
  registerImageSources,
  resolveEra,
  rollProduct,
} from './engine.js';
import { local, markMergeOffered, store, wasMergeOffered } from './store.js';
import { endRip, startRip } from './rip.js';
import { renderAuthSlot, renderMergePrompt, renderSignInModal } from './auth-ui.js';
import {
  renderCollection,
  resetFilters,
  state as colState,
} from './collection.js';
import {
  renderProductHead,
  renderProducts,
  renderResults,
  renderSetGroups,
} from './views.js';

const state = {
  index: null,
  rules: null,
  poolCache: new Map(),
  providers: { providers: [], devLogin: false },
  set: null,
  era: null,
  pool: null,
  result: null,
  collection: null,
  mergeOffered: false,
};

const el = (id) => document.getElementById(id);
const views = ['sets', 'product', 'rip', 'results', 'collection'];

function show(name) {
  for (const v of views) el(`view-${v}`).hidden = v !== name;
  window.scrollTo({ top: 0, behavior: 'instant' });
}

let toastTimer;
function toast(message, bad = false) {
  const node = el('toast');
  node.textContent = message;
  node.classList.toggle('bad', bad);
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, 4200);
}

function modal(html) {
  el('modal-host').innerHTML = html || '';
}

function updateChrome() {
  const totals = local.binderTotals(store.binder);
  const count = store.signedIn && store.serverStats
    ? store.serverStats.total_cards || 0
    : totals.total;
  el('nav-collection-count').textContent = count.toLocaleString();
  el('auth-slot').innerHTML = renderAuthSlot(store.user, state.providers);
}

// ── boot ───────────────────────────────────────────────────────────

async function boot() {
  try {
    const [index, rules] = await Promise.all([
      fetch('data/index.json').then(okJson),
      fetch('config/pack-rules.json').then(okJson),
    ]);
    state.index = index;
    state.rules = rules;
    // Must run before anything renders a card image.
    registerImageSources(index.sets);
  } catch (err) {
    el('set-groups').innerHTML =
      `<p class="loading">Could not load card data (${escapeText(err.message)}).<br>
       Run <code>python3 scripts/fetch.py</code>, then start the server with <code>node server/index.js</code>.</p>`;
    return;
  }

  const packable = state.index.sets.filter((s) => s.packable);
  const eras = [...new Set(packable.map((s) => s.series))];
  el('era-filter').insertAdjacentHTML(
    'beforeend',
    eras.map((e) => `<option value="${escapeAttr(e)}">${escapeText(e)}</option>`).join(''),
  );

  drawSets();

  // Auth is optional: if the server has no providers the site stays local-only.
  [state.providers] = await Promise.all([store.providers(), store.refreshSession()]);
  updateChrome();

  // Landing straight back from an OAuth redirect with local cards waiting.
  if (store.signedIn) maybeOfferMerge();
}

function okJson(response) {
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

// ── set list ───────────────────────────────────────────────────────

function drawSets() {
  const query = el('set-search').value.trim().toLowerCase();
  const era = el('era-filter').value;

  const matches = state.index.sets.filter((s) => {
    if (!s.packable) return false;
    if (era && s.series !== era) return false;
    if (query && !`${s.name} ${s.id}`.toLowerCase().includes(query)) return false;
    return true;
  });

  el('set-count').textContent = `${matches.length} set${matches.length === 1 ? '' : 's'}`;
  el('set-groups').innerHTML = matches.length
    ? renderSetGroups(matches)
    : '<p class="loading">No sets match that search.</p>';
}

// ── product picker ─────────────────────────────────────────────────

async function openSet(setId) {
  const entry = state.index.sets.find((s) => s.id === setId);
  if (!entry) return;

  state.set = entry;
  state.era = resolveEra(state.rules, entry.series);

  el('product-head').innerHTML = renderProductHead(entry, state.era);
  const options = Object.entries(state.rules.products)
    .filter(([key]) => productAvailable(state.era, key, state.rules))
    .map(([key, product]) => ({
      key,
      label: product.label,
      packs: packsInProduct(state.era, key, state.rules),
      cost: costOf(state.era, key, state.rules),
    }))
    .sort((a, b) => a.packs - b.packs);

  el('product-list').innerHTML = renderProducts(options);
  el('product-fineprint').textContent = fineprintFor(entry, state.era);
  show('product');

  loadPool(setId).catch(() => { /* surfaced on rip */ });
}

function fineprintFor(entry, era) {
  const bits = [`Pack structure and pull rates modelled on the ${era.label} era — community approximations, not official odds.`];
  bits.push(`Costs are original-release MSRP${entry.released < '2010' ? ", so a 1999 box is priced at 1999 money, not today's sealed market" : ''}.`);
  if (!entry.priced) bits.push('This set has no market price data yet, so the value readout is unavailable.');
  else if (entry.priced < entry.cards) {
    bits.push(`${entry.cards - entry.priced} of ${entry.cards} cards have no price on file and count as $0.`);
  }
  return bits.join(' ');
}

async function loadPool(setId) {
  if (state.poolCache.has(setId)) {
    state.pool = state.poolCache.get(setId);
    return state.pool;
  }
  const data = await fetch(`data/sets/${encodeURIComponent(setId)}.json`).then(okJson);
  const pool = buildPool(data.cards, state.era);
  state.poolCache.set(setId, pool);
  state.pool = pool;
  return pool;
}

// ── ripping ────────────────────────────────────────────────────────

async function rip(productKey) {
  let pool;
  try {
    pool = await loadPool(state.set.id);
  } catch (err) {
    toast(`Could not load ${state.set.name}: ${err.message}`, true);
    return;
  }

  try {
    state.result = rollProduct(pool, state.era, productKey, state.rules);
  } catch (err) {
    toast(err.message, true);
    return;
  }

  state.collection = null; // collection is now stale

  startReveal();

  // Persist after showing cards so the reveal never waits on the network.
  const outcome = await store.recordRip({
    setId: state.set.id,
    setName: state.set.name,
    result: state.result,
    packs: state.result.packs.length,
  });
  updateChrome();

  if (!outcome.saved && !store.signedIn) {
    toast('Could not save to this browser — sign in to keep your collection.', true);
  } else if (store.signedIn && !outcome.synced) {
    toast('Saved locally, but syncing to your account failed.', true);
  }
}

function startReveal() {
  show('rip');
  startRip({
    mount: el('rip-stage'),
    set: state.set,
    result: state.result,
    onFinish: showResults,
    onSkip: showResults,
  });
}

function showResults() {
  endRip();
  el('results-body').innerHTML = renderResults({
    set: state.set,
    era: state.era,
    result: state.result,
  });
  show('results');
}

// ── collection ─────────────────────────────────────────────────────

async function showCollection(reload = true) {
  show('collection');
  if (reload || !state.collection) {
    el('collection-body').innerHTML = '<p class="loading">Loading your collection…</p>';
    try {
      state.collection = await store.collection();
    } catch (err) {
      el('collection-body').innerHTML = `<p class="loading">Could not load collection: ${escapeText(err.message)}</p>`;
      return;
    }
  }
  drawCollection();
}

function drawCollection() {
  el('collection-body').innerHTML = renderCollection(
    state.collection,
    state.index,
    store.user,
    { localTotal: local.binderTotals(store.binder).total },
  );
  wireCollectionControls();
}

function wireCollectionControls() {
  const bind = (id, key, event = 'change') => {
    const node = el(id);
    if (!node) return;
    node.addEventListener(event, () => {
      colState.filters[key] = node.value;
      drawCollection();
    });
  };
  bind('col-set', 'set');
  bind('col-rarity', 'rarity');
  bind('col-variant', 'variant');
  bind('col-illustrator', 'illustrator');

  const search = el('col-search');
  if (search) {
    search.addEventListener('input', debounce(() => {
      colState.filters.query = search.value;
      const caret = search.selectionStart;
      drawCollection();
      const next = el('col-search');
      if (next) {
        next.focus();
        next.setSelectionRange(caret, caret);
      }
    }, 200));
  }

  const sort = el('col-sort');
  if (sort) {
    sort.addEventListener('change', () => {
      colState.sort = sort.value;
      drawCollection();
    });
  }
}

// ── auth ───────────────────────────────────────────────────────────

function openSignIn() {
  modal(renderSignInModal(state.providers, location.pathname));
}

async function devSignIn() {
  const handle = el('dev-handle')?.value || 'dev';
  try {
    await store.devSignIn(handle);
  } catch (err) {
    toast(err.message, true);
    return;
  }
  modal('');
  await store.refreshSession();
  updateChrome();
  toast(`Signed in as ${store.user.name}.`);
  state.collection = null;
  maybeOfferMerge();
}

async function signOut() {
  await store.signOut();
  updateChrome();
  modal('');
  state.collection = null;
  toast('Signed out. Your local collection is still here.');
  if (!el('view-collection').hidden) showCollection();
}

/**
 * Offer the local→cloud copy once per account, with the answer persisted so it
 * does not reappear on every page load. Declining is not final: the collection
 * view keeps a permanent copy button whenever local cards exist.
 */
function maybeOfferMerge() {
  if (state.mergeOffered || !store.signedIn) return;
  if (wasMergeOffered(store.user.id)) return;
  const totals = local.binderTotals(store.binder);
  if (!totals.total) return;

  state.mergeOffered = true;
  markMergeOffered(store.user.id);
  modal(renderMergePrompt(totals.total));
}

async function doMerge() {
  try {
    const { added } = await store.uploadLocalBinder();
    modal('');
    state.collection = null;
    updateChrome();
    toast(`Copied ${added.toLocaleString()} cards into your account.`);
    if (!el('view-collection').hidden) showCollection();
  } catch (err) {
    toast(`Copy failed: ${err.message}`, true);
  }
}

// ── export / import ────────────────────────────────────────────────

function exportBinder() {
  // Export what's on screen: signed in that's the account's collection, not the
  // local binder (which by then holds only unsynced leftovers).
  const binder = store.signedIn && state.collection
    ? local.fromCollectionRows(state.collection.rows, {
        rips: state.collection.stats.rips,
        packs: state.collection.stats.packs,
        spent: state.collection.stats.spent,
        pulled: state.collection.stats.pulled,
        best: state.collection.stats.best,
      })
    : store.binder;

  const payload = JSON.stringify(local.toExport(binder), null, 1);
  const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `ripax-collection-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  toast('Collection exported.');
}

async function importBinder(file) {
  if (!file) return;
  if (file.size > 12 * 1024 * 1024) {
    toast('That file is too large to be a binder export.', true);
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    toast('That file is not valid JSON.', true);
    return;
  }

  const outcome = local.merge(store.binder, parsed);
  if (!outcome.ok) {
    toast(outcome.error, true);
    return;
  }

  store.binder = outcome.binder;
  local.save(store.binder);

  // Signed in, the account is the source of truth, so push the import up too.
  if (store.signedIn) {
    try {
      await store.uploadLocalBinder();
    } catch (err) {
      toast(`Imported locally, but syncing failed: ${err.message}`, true);
    }
  }

  state.collection = null;
  updateChrome();
  await showCollection();
  toast(`Imported ${outcome.added.toLocaleString()} cards.`);
}

async function wipe() {
  const where = store.signedIn ? 'your account and this browser' : 'this browser';
  if (!confirm(`Delete your whole collection from ${where}? This cannot be undone.`)) return;
  await store.clearCollection();
  state.collection = null;
  updateChrome();
  await showCollection();
  toast('Collection cleared.');
}

// ── events ─────────────────────────────────────────────────────────

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-nav],[data-set],[data-product],[data-act],[data-filterset]');

  // A click anywhere else closes the account menu.
  const menu = el('account-menu');
  if (menu && !menu.hidden && !event.target.closest('.account')) menu.hidden = true;

  if (!target) return;

  if (target.dataset.nav) {
    const to = target.dataset.nav;
    if (to === 'collection') showCollection();
    else show(to);
    if (menu) menu.hidden = true;
    return;
  }
  if (target.dataset.set) { openSet(target.dataset.set); return; }
  if (target.dataset.product) { rip(target.dataset.product); return; }
  if (target.dataset.filterset) {
    resetFilters();
    colState.filters.set = target.dataset.filterset;
    drawCollection();
    return;
  }

  switch (target.dataset.act) {
    case 'again': rip(state.result.product); break;
    case 'another': show('product'); break;
    case 'export': exportBinder(); break;
    case 'import': el('import-file').click(); break;
    case 'wipe': wipe(); break;
    case 'signin': openSignIn(); break;
    case 'devsignin': devSignIn(); break;
    case 'signout': signOut(); break;
    case 'mergeyes': doMerge(); break;
    case 'clearfilters': resetFilters(); drawCollection(); break;
    case 'account': {
      const node = el('account-menu');
      if (node) node.hidden = !node.hidden;
      break;
    }
    case 'closemodal':
      // Only a backdrop or close-button click dismisses; clicks inside do not.
      if (event.target === target) modal('');
      break;
    default: break;
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && el('modal-host').innerHTML) {
    modal('');
    return;
  }
  if (el('view-rip').hidden) return;
  if (event.key === 'Escape') showResults();
});

el('set-search').addEventListener('input', debounce(drawSets, 120));
el('era-filter').addEventListener('change', drawSets);
el('import-file').addEventListener('change', (event) => {
  importBinder(event.target.files[0]);
  event.target.value = '';
});

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function escapeText(value) {
  return String(value).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
}

function escapeAttr(value) {
  return escapeText(value).replace(/"/g, '&quot;');
}

boot();
