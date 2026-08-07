/**
 * Local binder: the anonymous user's collection, in localStorage.
 *
 * v2 stores a row per printing with the metadata the collection view needs —
 * name, rarity, illustrator, best price seen, first/last pulled — so an
 * anonymous collection looks exactly like a signed-in one. v1 stored only
 * counts and is migrated on read.
 */

// Storage identifiers deliberately keep the original "packrip" name even though
// the app is now called Ripax: renaming the key would orphan every collection
// already saved in a browser, and renaming EXPORT_KIND would reject export files
// people have already downloaded.
const KEY = 'packrip.binder.v1';
const VERSION = 2;
export const EXPORT_KIND = 'packrip-binder';

function emptyBinder() {
  return {
    v: VERSION,
    created: new Date().toISOString(),
    stats: { rips: 0, packs: 0, spent: 0, pulled: 0 },
    cards: {},
    best: null,
  };
}

/** Storage key for one physical card: a reverse holo is a different card. */
export function cardKey(setId, card, variant) {
  return `${setId}:${card.i}:${variant}`;
}

export function parseCardKey(key) {
  const [setId, number, variant] = key.split(':');
  return { setId, number, variant };
}

function readRaw() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null; // private mode / storage disabled
  }
}

export function load() {
  const raw = readRaw();
  if (!raw) return emptyBinder();
  try {
    return sanitize(JSON.parse(raw)) || emptyBinder();
  } catch {
    return emptyBinder();
  }
}

export function save(binder) {
  try {
    localStorage.setItem(KEY, JSON.stringify(binder));
    return true;
  } catch {
    return false; // quota or disabled; the session still works in memory
  }
}

export function clear() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
  return emptyBinder();
}

function cleanString(value, max) {
  if (typeof value !== 'string') return null;
  const trimmed = value.slice(0, max);
  return trimmed || null;
}

function cleanCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(Math.floor(n), 99999);
}

function cleanPrice(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 1e7) : 0;
}

/**
 * Validate an untrusted binder object (localStorage or an imported file) and
 * upgrade v1 to v2. Returns a clean binder, or null when unusable.
 */
export function sanitize(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const version = Number(input.v);
  if (version !== 1 && version !== VERSION) return null;
  if (!input.cards || typeof input.cards !== 'object' || Array.isArray(input.cards)) return null;

  const out = emptyBinder();
  out.created = typeof input.created === 'string' ? input.created : out.created;

  const stats = input.stats && typeof input.stats === 'object' ? input.stats : {};
  for (const field of ['rips', 'packs', 'spent', 'pulled']) {
    const value = Number(stats[field]);
    out.stats[field] = Number.isFinite(value) && value >= 0 ? value : 0;
  }

  let kept = 0;
  for (const [key, value] of Object.entries(input.cards)) {
    if (kept >= 200000) break; // refuse to blow up memory on a hostile file
    if (typeof key !== 'string' || key.split(':').length !== 3) continue;

    // v1 rows were a bare count; v2 rows are an object.
    if (typeof value === 'number' || typeof value === 'string') {
      const count = cleanCount(value);
      if (!count) continue;
      out.cards[key] = { c: count, n: null, r: null, a: null, p: 0, f: out.created, l: out.created };
      kept += 1;
      continue;
    }
    if (!value || typeof value !== 'object') continue;

    const count = cleanCount(value.c);
    if (!count) continue;
    out.cards[key] = {
      c: count,
      n: cleanString(value.n, 120),
      r: cleanString(value.r, 60),
      a: cleanString(value.a, 80),
      p: cleanPrice(value.p),
      f: cleanString(value.f, 40) || out.created,
      l: cleanString(value.l, 40) || out.created,
    };
    kept += 1;
  }

  const best = input.best;
  if (best && typeof best === 'object' && typeof best.name === 'string') {
    out.best = {
      setId: String(best.setId || ''),
      setName: String(best.setName || ''),
      number: String(best.number || ''),
      name: best.name.slice(0, 120),
      rarity: String(best.rarity || ''),
      illustrator: cleanString(best.illustrator, 80),
      variant: ['n', 'h', 'r'].includes(best.variant) ? best.variant : 'n',
      price: cleanPrice(best.price),
      at: typeof best.at === 'string' ? best.at : null,
    };
  }
  return out;
}

/** Fold a finished rip into the binder. Mutates and returns it. */
export function recordRip(binder, { setId, setName, result, packs }) {
  binder.stats.rips += 1;
  binder.stats.packs += packs;
  binder.stats.spent = round2(binder.stats.spent + result.cost);
  binder.stats.pulled = round2(binder.stats.pulled + result.value);

  const at = new Date().toISOString();
  for (const pull of result.cards) {
    const key = cardKey(setId, pull.card, pull.variant);
    const row = binder.cards[key];
    if (row) {
      row.c += 1;
      row.l = at;
      row.p = Math.max(row.p || 0, pull.price || 0);
      row.n = row.n || pull.card.n || null;
      row.r = row.r || pull.card.r || null;
      row.a = row.a || pull.card.a || null;
    } else {
      binder.cards[key] = {
        c: 1,
        n: pull.card.n || null,
        r: pull.card.r || null,
        a: pull.card.a || null,
        p: pull.price || 0,
        f: at,
        l: at,
      };
    }
  }

  const best = result.best;
  if (best && (!binder.best || best.price > binder.best.price)) {
    binder.best = {
      setId,
      setName,
      number: best.card.i,
      name: best.card.n,
      rarity: best.card.r,
      illustrator: best.card.a || null,
      variant: best.variant,
      price: best.price,
      at,
    };
  }
  return binder;
}

export function binderTotals(binder) {
  let unique = 0;
  let total = 0;
  for (const row of Object.values(binder.cards)) {
    unique += 1;
    total += row.c;
  }
  return {
    unique,
    total,
    spent: binder.stats.spent,
    pulled: binder.stats.pulled,
    profit: round2(binder.stats.pulled - binder.stats.spent),
    rips: binder.stats.rips,
    packs: binder.stats.packs,
  };
}

/** Merge an imported binder into the current one: counts add, best pull wins. */
export function merge(current, incoming) {
  const clean = sanitize(incoming);
  if (!clean) return { ok: false, error: 'Not a Ripax collection file (or an unsupported version).' };

  const merged = sanitize(current) || emptyBinder();
  let added = 0;
  for (const [key, row] of Object.entries(clean.cards)) {
    const existing = merged.cards[key];
    if (existing) {
      existing.c += row.c;
      existing.p = Math.max(existing.p || 0, row.p || 0);
      existing.n = existing.n || row.n;
      existing.r = existing.r || row.r;
      existing.a = existing.a || row.a;
      if (row.l > existing.l) existing.l = row.l;
      if (row.f < existing.f) existing.f = row.f;
    } else {
      merged.cards[key] = { ...row };
    }
    added += row.c;
  }
  for (const field of ['rips', 'packs']) {
    merged.stats[field] += clean.stats[field];
  }
  merged.stats.spent = round2(merged.stats.spent + clean.stats.spent);
  merged.stats.pulled = round2(merged.stats.pulled + clean.stats.pulled);
  if (clean.best && (!merged.best || clean.best.price > merged.best.price)) {
    merged.best = clean.best;
  }
  return { ok: true, binder: merged, added };
}

export function toExport(binder) {
  return {
    kind: EXPORT_KIND,
    exportedAt: new Date().toISOString(),
    ...binder,
  };
}

/**
 * Flatten the binder into the wire shape the server's /api/import accepts, so a
 * local binder can be pushed into a cloud account on first sign-in.
 */
export function toPulls(binder) {
  return Object.entries(binder.cards).map(([key, row]) => {
    const { setId, number, variant } = parseCardKey(key);
    return {
      setId,
      number,
      variant,
      count: row.c,
      name: row.n,
      rarity: row.r,
      illustrator: row.a,
      price: row.p,
    };
  });
}

/**
 * Build an exportable binder from normalised collection rows, so a cloud
 * collection can be exported in exactly the format import accepts.
 */
export function fromCollectionRows(rows, stats = {}) {
  const binder = emptyBinder();
  binder.stats = {
    rips: Number(stats.rips) || 0,
    packs: Number(stats.packs) || 0,
    spent: round2(Number(stats.spent) || 0),
    pulled: round2(Number(stats.pulled) || 0),
  };

  let best = null;
  for (const row of rows) {
    binder.cards[`${row.set_id}:${row.number}:${row.variant}`] = {
      c: cleanCount(row.count) || 1,
      n: cleanString(row.name, 120),
      r: cleanString(row.rarity, 60),
      a: cleanString(row.illustrator, 80),
      p: cleanPrice(row.best_price),
      f: cleanString(row.first_at, 40) || binder.created,
      l: cleanString(row.last_at, 40) || binder.created,
    };
    if (!best || (row.best_price || 0) > (best.best_price || 0)) best = row;
  }

  const source = stats.best || best;
  if (source) {
    binder.best = {
      setId: String(source.set_id || ''),
      setName: '',
      number: String(source.number || ''),
      name: String(source.name || ''),
      rarity: String(source.rarity || ''),
      illustrator: cleanString(source.illustrator, 80),
      variant: ['n', 'h', 'r'].includes(source.variant) ? source.variant : 'n',
      price: cleanPrice(source.best_price),
      at: cleanString(source.last_at, 40),
    };
  }
  return binder;
}

/** Normalised rows for the collection view: same shape the server returns. */
export function toCollectionRows(binder) {
  return Object.entries(binder.cards).map(([key, row]) => {
    const { setId, number, variant } = parseCardKey(key);
    return {
      set_id: setId,
      number,
      variant,
      count: row.c,
      name: row.n,
      rarity: row.r,
      illustrator: row.a,
      best_price: row.p,
      first_at: row.f,
      last_at: row.l,
    };
  });
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
