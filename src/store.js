/**
 * One collection interface over two backends.
 *
 * Signed out, everything lives in localStorage. Signed in, the server is the
 * source of truth. The views never branch on which is active — they read the
 * same normalised row shape either way.
 */

import * as local from './binder.js';

const json = { 'content-type': 'application/json' };

// Remembers which accounts have already been offered the local->cloud copy, so
// the prompt does not reappear on every page load and a decline stays declined.
const ASKED_KEY = 'packrip.mergeAsked.v1';

function readAsked() {
  try {
    const parsed = JSON.parse(localStorage.getItem(ASKED_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function wasMergeOffered(userId) {
  return Boolean(userId && readAsked()[userId]);
}

export function markMergeOffered(userId) {
  if (!userId) return;
  const asked = readAsked();
  asked[userId] = new Date().toISOString();
  try {
    localStorage.setItem(ASKED_KEY, JSON.stringify(asked));
  } catch {
    /* the in-memory guard still stops a repeat within this page load */
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options });
  if (response.status === 401) return { unauthorized: true };
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `${response.status} ${response.statusText}`);
  return body;
}

export const store = {
  user: null,
  binder: local.load(),
  serverStats: null,

  get signedIn() {
    return Boolean(this.user);
  },

  /** Ask the server who we are. Safe to call when auth is not configured. */
  async refreshSession() {
    try {
      const body = await api('/api/me');
      this.user = body.user || null;
      this.serverStats = body.stats || null;
    } catch {
      this.user = null; // server unreachable: carry on anonymously
      this.serverStats = null;
    }
    return this.user;
  },

  async providers() {
    try {
      return await api('/auth/providers');
    } catch {
      return { providers: [], devLogin: false };
    }
  },

  async devSignIn(handle) {
    const body = await api('/auth/dev', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ handle }),
    });
    if (body.unauthorized) throw new Error('dev login is disabled');
    this.user = body.user;
    return this.user;
  },

  async signOut() {
    await api('/auth/signout', { method: 'POST' }).catch(() => {});
    this.user = null;
    this.serverStats = null;
  },

  /**
   * Record a finished rip.
   *
   * The local binder holds exactly the cards the server does not have: pulls
   * from before sign-in, plus anything whose sync failed. Signed-in pulls that
   * sync cleanly are not written locally, otherwise "copy my local cards" would
   * re-upload cards the account already has and double their counts.
   */
  async recordRip({ setId, setName, result, packs }) {
    if (!this.signedIn) {
      local.recordRip(this.binder, { setId, setName, result, packs });
      return { saved: local.save(this.binder), synced: false };
    }

    try {
      const body = await api('/api/rip', {
        method: 'POST',
        headers: json,
        body: JSON.stringify({
          setId,
          setName,
          product: result.product,
          packs,
          cost: result.cost,
          value: result.value,
          bestName: result.best?.card?.n || null,
          bestPrice: result.best?.price || 0,
          pulls: result.cards.map((pull) => ({
            setId,
            number: pull.card.i,
            variant: pull.variant,
            count: 1,
            name: pull.card.n,
            rarity: pull.card.r,
            illustrator: pull.card.a || null,
            price: pull.price,
          })),
        }),
      });
      if (body.unauthorized) throw new Error('session expired');
      if (body.stats) this.serverStats = body.stats;
      return { saved: true, synced: true };
    } catch (err) {
      // Sync failed, so keep the rip locally rather than losing it. It becomes
      // part of what "copy my local cards" will push up later.
      local.recordRip(this.binder, { setId, setName, result, packs });
      return { saved: local.save(this.binder), synced: false, error: err.message };
    }
  },

  /**
   * Push the local binder into the signed-in account, then clear it: those
   * cards now live on the server, and keeping a copy would let a second click
   * upload them again.
   */
  async uploadLocalBinder() {
    const pulls = local.toPulls(this.binder);
    if (!pulls.length) return { added: 0 };
    const body = await api('/api/import', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ pulls }),
    });
    if (body.unauthorized) throw new Error('sign in required');
    if (body.stats) this.serverStats = body.stats;
    this.binder = local.clear();
    return { added: body.added || 0 };
  },

  /**
   * Rows + facets + stats for the collection view, from whichever backend is
   * active. Facets are computed locally for anonymous users.
   */
  async collection() {
    if (this.signedIn) {
      const body = await api('/api/collection');
      if (!body.unauthorized) {
        return {
          rows: body.cards,
          facets: body.facets,
          stats: normaliseServerStats(body.stats),
          source: 'cloud',
        };
      }
      this.user = null; // session expired underneath us
    }

    const rows = local.toCollectionRows(this.binder);
    const totals = local.binderTotals(this.binder);
    return {
      rows,
      facets: facetsFrom(rows),
      stats: {
        uniqueCards: totals.unique,
        totalCards: totals.total,
        rips: totals.rips,
        packs: totals.packs,
        spent: totals.spent,
        pulled: totals.pulled,
        best: this.binder.best
          ? {
              set_id: this.binder.best.setId,
              number: this.binder.best.number,
              variant: this.binder.best.variant,
              name: this.binder.best.name,
              rarity: this.binder.best.rarity,
              illustrator: this.binder.best.illustrator,
              best_price: this.binder.best.price,
            }
          : null,
      },
      source: 'local',
    };
  },

  async clearCollection() {
    this.binder = local.clear();
    if (this.signedIn) {
      await api('/api/collection', { method: 'DELETE' }).catch(() => {});
      this.serverStats = null;
    }
  },
};

function normaliseServerStats(stats) {
  if (!stats) return null;
  return {
    uniqueCards: stats.unique_cards || 0,
    totalCards: stats.total_cards || 0,
    rips: stats.rips || 0,
    packs: stats.packs || 0,
    spent: stats.spent || 0,
    pulled: stats.pulled || 0,
    best: stats.best || null,
  };
}

/** Same facet shape the server produces, computed from local rows. */
export function facetsFrom(rows) {
  const bucket = (keyOf) => {
    const map = new Map();
    for (const row of rows) {
      const key = keyOf(row);
      if (key === null || key === undefined || key === '') continue;
      const entry = map.get(key) || { unique_cards: 0, total: 0 };
      entry.unique_cards += 1;
      entry.total += row.count;
      map.set(key, entry);
    }
    return [...map.entries()].sort((a, b) => b[1].total - a[1].total);
  };

  return {
    sets: bucket((r) => r.set_id).map(([set_id, v]) => ({ set_id, ...v })),
    rarities: bucket((r) => r.rarity).map(([rarity, v]) => ({ rarity, ...v })),
    illustrators: bucket((r) => r.illustrator).map(([illustrator, v]) => ({ illustrator, ...v })),
    variants: bucket((r) => r.variant).map(([variant, v]) => ({ variant, ...v })),
  };
}

export { local };
