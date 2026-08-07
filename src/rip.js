/**
 * The physical rip: tear the wrapper, then slide cards off the stack one at a
 * time, each one flipping over as it moves.
 *
 * The interaction is deliberately one gesture per card. Dragging the top card
 * rotates it from face-down toward face-up in proportion to how far it has
 * travelled, so the reveal happens *during* the motion rather than after it —
 * which is what sifting through a fresh pack actually feels like.
 */

import { imageUrl } from './engine.js';
import { attr, cardImage, esc, glowFor, money } from './views.js';
import {
  isMuted,
  playBoxOpen,
  playHit,
  playLand,
  playPackPull,
  playSlide,
  playTear,
  toggleMute,
} from './audio.js';
import {
  beginTell,
  clearTell,
  gradeFor,
  onWalkoutClose,
  payoff,
} from './reveal-fx.js';

const FLIP_DISTANCE = 110; // px of drag that turns the card fully face-up
const MAX_STACK_SHADOWS = 6;

let session = null;

export function isRipping() {
  return Boolean(session);
}

export function endRip() {
  if (!session) return;
  if (session.cleanup) session.cleanup();
  // Drop the scene so its card images and pointer handlers are not left
  // parked in a hidden view until the next rip replaces them.
  if (session.mount) session.mount.innerHTML = '';
  session = null;
}

/**
 * @param {object} opts
 * @param {HTMLElement} opts.mount   container to render into
 * @param {object} opts.set          index entry for the set being opened
 * @param {object} opts.result       rollProduct() output
 * @param {Function} opts.onFinish   called when every pack has been opened
 * @param {Function} opts.onSkip     called when the user bails to the summary
 */
export function startRip({ mount, set, result, onFinish, onSkip }) {
  endRip();

  session = {
    mount,
    set,
    result,
    onFinish,
    onSkip,
    packIndex: 0,
    revealed: 0,
    review: null,
    livePull: null,
    runningValue: 0,
    seen: [],
    phase: result.packs.length > 1 ? 'box' : 'sealed',
    cleanup: null,
  };

  countFrom = 0;
  render();
  preloadPack(result.packs[0]);
  return session;
}

// ── rendering ──────────────────────────────────────────────────────

function render() {
  if (!session) return;
  const { phase } = session;
  if (phase === 'box') return renderBox();
  if (phase === 'sealed') return renderSealed();
  return renderTable();
}

/** Where the running total sits against the cost. Used by both the initial
 *  render and every live update, so they can never disagree. */
function moneyState() {
  const cost = session.result.cost || 0;
  const value = session.runningValue;
  return {
    ahead: cost > 0 && value >= cost,
    pct: cost > 0 ? Math.min(100, (value / cost) * 100) : 0,
  };
}

function hud() {
  const { result, packIndex } = session;
  const total = result.packs.length;
  const priced = result.pricesAvailable;
  const { ahead, pct } = moneyState();

  return `
    <div class="rip-hud">
      <div class="rip-hud-left">
        <span class="rip-set">${esc(session.set.name)}</span>
        <span class="rip-count">${total > 1 ? `Pack ${Math.min(packIndex + 1, total)} of ${total}` : '1 pack'}</span>
      </div>
      <div class="rip-hud-right">
        ${priced ? `
          <div class="rip-money${ahead ? ' ahead' : ''}" id="rip-money">
            <div class="rip-money-row">
              <span class="rip-value" id="rip-value">${money(session.runningValue)}</span>
              <span class="rip-goal">of ${money(result.cost)}</span>
            </div>
            <!-- Fills toward break-even and flips green once you clear it.
                 Rendered pre-filled: a box re-renders this HUD between every
                 pack, and a blank bar would read as "underwater" mid-box. -->
            <div class="rip-bar"><span id="rip-bar-fill" style="width:${pct}%"></span></div>
          </div>` : ''}
        <button class="icon-btn" id="rip-mute" type="button"
                aria-label="${isMuted() ? 'Unmute' : 'Mute'} sound">${isMuted() ? '🔇' : '🔊'}</button>
        <button class="ghost" id="rip-bail" type="button">Skip to results →</button>
      </div>
    </div>`;
}

/** Booster box: a closed box, then a tray of packs to pull from. */
function renderBox() {
  const { result, packIndex, set } = session;
  const remaining = result.packs.length - packIndex;
  const opened = packIndex;

  session.mount.innerHTML = `
    ${hud()}
    <div class="rip-scene">
      <div class="box-shell ${session.boxOpen ? 'open' : ''}" id="box-shell"
           style="${skinFor(set)}">
        <div class="box-lid">
          ${set.symbol ? `<img class="box-lid-sym" src="${attr(set.symbol)}" alt="">` : ''}
        </div>
        <div class="box-body">
          ${heroArt(set)}
          <div class="pack-wash"></div>
          ${set.logo ? `<img class="box-logo" src="${attr(set.logo)}" alt="">` : ''}
          <span class="box-label">Booster Box · ${result.packs.length} packs</span>
          <span class="box-era">${esc(set.series)}</span>
        </div>
      </div>

      ${session.boxOpen ? `
        <div class="pack-tray" id="pack-tray" style="${skinFor(set)}">
          ${Array.from({ length: Math.min(remaining, 12) }, (_, i) => `
            <button class="tray-pack" data-pull="1" style="--i:${i}" type="button"
                    aria-label="Pull the next pack">
              ${set.logo ? `<img src="${attr(set.logo)}" alt="">` : ''}
            </button>`).join('')}
        </div>
        <p class="rip-hint">
          ${opened ? `${opened} opened · ${remaining} left in the box` : 'Grab a pack'}
        </p>
        <button class="btn sec small" id="rip-rest" type="button">
          Rip the remaining ${remaining} instantly
        </button>
      ` : `
        <p class="rip-hint">Tap the box to open it</p>
      `}
    </div>`;

  wireCommon();

  const shell = document.getElementById('box-shell');
  if (shell && !session.boxOpen) {
    shell.addEventListener('click', () => {
      session.boxOpen = true;
      playBoxOpen();
      render();
    }, { once: true });
  }

  for (const pack of session.mount.querySelectorAll('[data-pull]')) {
    pack.addEventListener('click', () => {
      playPackPull();
      session.phase = 'sealed';
      render();
      preloadPack(session.result.packs[session.packIndex]);
    }, { once: true });
  }

  const rest = document.getElementById('rip-rest');
  if (rest) rest.addEventListener('click', () => session.onSkip());
}

/** A sealed pack you tear across the top. */
function renderSealed() {
  const { set } = session;

  session.mount.innerHTML = `
    ${hud()}
    <div class="rip-scene">
      <div class="pack" id="pack" role="button" tabindex="0"
           style="${skinFor(set)}" aria-label="Tear open the pack">
        <div class="pack-foil">
          <div class="pack-crimp top"></div>
          ${heroArt(set)}
          <div class="pack-wash"></div>
          <div class="pack-art">
            <div class="pack-brand">Pok&eacute;mon<span>TCG</span></div>
            ${set.logo ? `<img class="pack-logo" src="${attr(set.logo)}" alt="">` : ''}
          </div>
          <div class="pack-foot">
            ${set.symbol ? `<img class="pack-sym" src="${attr(set.symbol)}" alt="">` : ''}
            <span class="pack-count">${session.result.packs[0].length} GAME CARDS</span>
          </div>
          <div class="pack-seam"></div>
          <div class="pack-shine"></div>
          <div class="pack-crimp bottom"></div>
        </div>
        <div class="pack-strip" id="pack-strip"></div>
        <!-- Diagonal corner flap that lifts and curls as you drag, showing the
             matte inside of the foil the way a real wrapper does. -->
        <div class="pack-curl" id="pack-curl"><span class="curl-lip"></span></div>
        <div class="tear-guide" id="tear-guide"><span class="tear-hot"></span></div>
      </div>
      <p class="rip-hint" id="rip-hint">Swipe across the line to tear it open</p>
    </div>`;

  wireCommon();
  wireTear();
}

/** The opened pack: a stack of face-down cards plus the pile you've seen. */
function renderTable() {
  const pack = session.result.packs[session.packIndex];
  const left = pack.length - session.revealed;

  session.mount.innerHTML = `
    ${hud()}
    <div class="rip-scene table">
      <div class="fan" id="fan"></div>
      <div class="stack-zone">
        <!-- Page back through cards already turned over, the way TCG Pocket
             lets you flick back to re-look at something. -->
        <button class="chev prev" id="chev-prev" type="button"
                aria-label="Previous card" disabled>&lsaquo;</button>
        <div class="stack" id="stack"></div>
        <div class="review" id="review" hidden></div>
        <button class="chev next" id="chev-next" type="button"
                aria-label="Back to the pack" disabled>&rsaquo;</button>
        <!-- Details of whatever is currently face-up in hand. -->
        <div class="hand-meta" id="hand-meta"></div>
      </div>
      <!-- Outside .stack-zone on purpose: the zone is hidden once the pack is
           empty, and this holds the button that continues from there. -->
      <p class="rip-hint" id="rip-hint">
        ${left ? 'Tap the card to flip it' : 'Pack empty'}
      </p>
    </div>`;

  wireCommon();
  wireChevrons();
  paintStack();
  paintFan();
}

/**
 * Review mode. `session.review` is null when you're on the live stack, otherwise
 * an index into the cards already seen. Stepping past the newest card returns
 * you to the pack rather than dead-ending.
 */
function wireChevrons() {
  const prev = document.getElementById('chev-prev');
  const next = document.getElementById('chev-next');
  if (!prev || !next) return;

  prev.addEventListener('click', () => {
    if (!session.seen.length) return;
    session.review = session.review === null
      ? session.seen.length - 1
      : Math.max(0, session.review - 1);
    paintReview();
  });

  next.addEventListener('click', () => {
    if (session.review === null) return;
    session.review += 1;
    if (session.review >= session.seen.length) session.review = null;
    paintReview();
  });
}

function updateChevrons() {
  const prev = document.getElementById('chev-prev');
  const next = document.getElementById('chev-next');
  if (!prev || !next) return;
  const reviewing = session.review !== null;
  prev.disabled = reviewing ? session.review === 0 : session.seen.length === 0;
  next.disabled = !reviewing;
  prev.classList.toggle('lit', !prev.disabled);
  next.classList.toggle('lit', !next.disabled);
}

/** Swap between the live stack and a card being re-examined. */
function paintReview() {
  const stack = document.getElementById('stack');
  const review = document.getElementById('review');
  if (!stack || !review) return;

  if (session.review === null) {
    review.hidden = true;
    review.innerHTML = '';
    // visibility, not `hidden`: the stack must keep occupying space or the flex
    // column collapses and the review overlay has no box to fill.
    stack.classList.remove('reviewing');
    // Restore whatever the live card was showing.
    if (session.livePull && document.querySelector('.rcard.live.up')) {
      showHandMeta(session.livePull);
    } else {
      clearHandMeta();
    }
    updateChevrons();
    return;
  }

  const pull = session.seen[session.review];
  stack.classList.add('reviewing');
  review.hidden = false;
  review.innerHTML = `
    <div class="rcard review-card ${pull.tier >= 3 ? 'foil' : ''}"
         ${glowFor(pull.tier) ? `style="--gl:${glowFor(pull.tier)}"` : ''}>
      <div class="rcard-face rcard-front">
        ${cardImage(session.set.id, pull.card, { hires: true, alt: pull.card.n })}
      </div>
    </div>`;
  showHandMeta(pull);
  washScene(pull);

  const hint = document.getElementById('rip-hint');
  if (hint) hint.textContent = `Card ${session.review + 1} of ${session.seen.length} you've opened`;
  updateChevrons();
}

function paintStack() {
  const stack = document.getElementById('stack');
  if (!stack) return;

  const pack = session.result.packs[session.packIndex];
  const remaining = pack.slice(session.revealed);
  stack.innerHTML = '';

  if (!remaining.length) {
    // Pack empty: retire the stack and let the spread of what you pulled take
    // over the scene, rather than leaving a hole where the stack used to be.
    stack.classList.add('empty');
    session.mount.querySelector('.rip-scene')?.classList.add('done');
    showPackDone();
    return;
  }

  // Draw a few cards of depth behind the live one so the stack has thickness.
  const depth = Math.min(remaining.length - 1, MAX_STACK_SHADOWS);
  for (let i = depth; i >= 1; i -= 1) {
    const shim = document.createElement('div');
    shim.className = 'rcard shim';
    shim.style.setProperty('--d', String(i));
    stack.appendChild(shim);
  }

  const pull = remaining[0];
  session.livePull = pull;
  stack.appendChild(buildCard(pull, true));
  attachCard(stack.querySelector('.rcard.live'), pull);
}

/**
 * Rarity pips, borrowed from TCG Pocket's reveal: diamonds climbing to stars and
 * finally a crown. One glance tells you what you got before you read anything,
 * which is why they put it under every card rather than only the good ones.
 */
function rarityPips(tier) {
  if (tier >= 9) return { mark: '♛', count: 1, kind: 'crown' };
  if (tier >= 8) return { mark: '★', count: 3, kind: 'star' };
  if (tier >= 7) return { mark: '★', count: 2, kind: 'star' };
  if (tier >= 5) return { mark: '★', count: 1, kind: 'star' };
  if (tier >= 4) return { mark: '◆', count: 4, kind: 'gem' };
  if (tier >= 3) return { mark: '◆', count: 3, kind: 'gem' };
  if (tier >= 2) return { mark: '◆', count: 2, kind: 'gem' };
  return { mark: '◆', count: 1, kind: 'gem' };
}

function pipsHtml(tier) {
  const { mark, count, kind } = rarityPips(tier);
  const marks = Array.from({ length: count },
    (_, i) => `<i style="--d:${i * 70}ms">${mark}</i>`).join('');
  return `<div class="pips ${kind}">${marks}</div>`;
}

function buildCard(pull, faceDown) {
  const el = document.createElement('div');
  el.className = `rcard live ${faceDown ? 'down' : ''}`;
  const tier = pull.tier;
  const glow = glowFor(tier);
  if (glow) el.style.setProperty('--gl', glow);

  el.innerHTML = `
    <div class="rcard-3d">
      <div class="rcard-face rcard-front loading-shim ${tier >= 3 ? 'foil' : ''}">
        ${cardImage(session.set.id, pull.card, { hires: true, eager: true, alt: pull.card.n })}
      </div>
      <div class="rcard-face rcard-back">${cardBack()}</div>
    </div>`;
  return el;
}

/**
 * The real card back. pokemontcg.io serves it at a canonical URL from the same
 * CDN as the card fronts (it doubles as their missing-art placeholder), so this
 * is the genuine artwork rather than an approximation.
 *
 * The CSS back stays underneath as a fallback: if the image ever fails, the
 * drawn version shows through instead of a blank card.
 */
const CARD_BACK_URL = 'https://images.pokemontcg.io/card-back.png';

function cardBack() {
  return `
    <div class="cb-frame">
      <div class="cb-field">
        <div class="cb-burst"></div>
        <div class="cb-emblem"><span class="cb-ball"></span></div>
        <div class="cb-word">Pokémon</div>
      </div>
    </div>
    <img class="cb-real" src="${attr(CARD_BACK_URL)}" alt="" onerror="this.remove()">`;
}

/**
 * Per-era palettes so a 1999 Base pack does not look like a 2026 Mega Evolution
 * pack. Wrappers and boxes both read from these.
 */
const ERA_SKINS = {
  Base: ['#1c4fa1', '#4f8fe0', '#0f2f6b', '#ffd76a'],
  Gym: ['#8a4a1e', '#d08a44', '#4d2610', '#f0c98a'],
  Neo: ['#1d6b5a', '#49b394', '#0d3a30', '#ffe08a'],
  'E-Card': ['#3a4a8c', '#7d8ed6', '#1e2650', '#ffd76a'],
  EX: ['#7a1f5c', '#c85aa0', '#43102f', '#ffd0ec'],
  'Diamond & Pearl': ['#2a5f8f', '#67a8d6', '#16354f', '#dff0ff'],
  Platinum: ['#4a5a6b', '#93a6b8', '#252f3a', '#e8f0f7'],
  'HeartGold & SoulSilver': ['#8a6a1e', '#d4ae52', '#4a3810', '#fff0c0'],
  'Black & White': ['#22262c', '#5c6470', '#0e1013', '#e6ecf5'],
  XY: ['#1e5c86', '#5aa8cf', '#0f3049', '#ffe9a8'],
  'Sun & Moon': ['#b8531e', '#f0954a', '#6b2c0c', '#ffe0b0'],
  'Sword & Shield': ['#2b3f8f', '#6b7fd6', '#161f4d', '#ffd76a'],
  'Scarlet & Violet': ['#7a2038', '#c05070', '#42101e', '#ffd0dc'],
  'Mega Evolution': ['#3d2170', '#7f52c9', '#1f0f3d', '#ffd76a'],
};

/**
 * Wrapper colours. A palette sampled from the set's own logo wins when we have
 * one (see scripts/set_art.py) — that makes each set's wrapper match its real
 * branding. The era table is the fallback for sets we couldn't sample.
 */
function skinFor(set) {
  const series = typeof set === 'string' ? set : set?.series;
  const p = typeof set === 'object' ? set?.palette : null;
  if (p) return `--p1:${p.mid};--p2:${p.light};--p3:${p.dark};--pa:${p.accent}`;

  const skin = ERA_SKINS[series] || ERA_SKINS['Scarlet & Violet'];
  return `--p1:${skin[0]};--p2:${skin[1]};--p3:${skin[2]};--pa:${skin[3]}`;
}

/**
 * Wrapper artwork. Real packs carry a big illustration of a prominent Pokemon
 * from the expansion, so we use the set's hero card: full-bleed rarities
 * (Illustration Rare and friends) are edge-to-edge art and can be shown whole,
 * while framed cards get cropped to their illustration window instead of
 * showing a tiny card with borders and rules text.
 */
/**
 * Warm the whole pack's artwork as soon as the wrapper is open.
 *
 * Each reveal shows a ~600x825 hires PNG. Fetching that at the moment of the
 * flip is exactly when it is most visible as a stall, and the user is going to
 * see all ten anyway — so fetch them together while they're still tearing. The
 * browser cache means the flips themselves become instant.
 */
function preloadPack(pack) {
  if (!session || !pack) return;
  for (const pull of pack) {
    const url = imageUrl(session.set.id, pull.card, { hires: true });
    if (!url) continue;
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
  }
}

function heroArt(set) {
  if (!set.heroCard) return '';
  const url = imageUrl(set.id, { i: set.heroCard }, { hires: true });
  if (!url) return '';
  return `<img class="pack-hero ${set.heroFullBleed ? 'bleed' : 'framed'}"
               src="${attr(url)}" alt="" aria-hidden="true">`;
}

function paintFan() {
  const fan = document.getElementById('fan');
  if (!fan) return;
  fan.innerHTML = session.seen.map((pull, i) => {
    const glow = glowFor(pull.tier);
    return `
      <div class="fan-card ${pull.tier >= 3 ? 'foil' : ''} ${glow ? 'glow' : ''}"
           style="--i:${i}${glow ? `;--gl:${glow}` : ''}"
           title="${attr(`${pull.card.n} — ${pull.card.r}${session.result.pricesAvailable ? ` · ${money(pull.price)}` : ''}`)}">
        ${cardImage(session.set.id, pull.card, { lazy: true, alt: pull.card.n })}
      </div>`;
  }).join('');
  fan.scrollLeft = fan.scrollWidth;
}

// ── interactions ───────────────────────────────────────────────────

function wireCommon() {
  const mute = document.getElementById('rip-mute');
  if (mute) {
    mute.addEventListener('click', () => {
      const nowMuted = toggleMute();
      mute.textContent = nowMuted ? '🔇' : '🔊';
      mute.setAttribute('aria-label', nowMuted ? 'Unmute sound' : 'Mute sound');
    });
  }
  const bail = document.getElementById('rip-bail');
  if (bail) bail.addEventListener('click', () => session.onSkip());
}

/** Tear: drag horizontally across the pack, or just tap it. */
function wireTear() {
  const pack = document.getElementById('pack');
  const strip = document.getElementById('pack-strip');
  if (!pack) return;

  let startX = null;
  let torn = false;

  const tear = () => {
    if (torn) return;
    torn = true;
    // Tapping skips the drag, so snap the curl open before the fly-off.
    document.getElementById('pack-curl')?.style.setProperty('--tear', '1');
    playTear();
    pack.classList.add('torn');
    // Let the wrapper animation play before the cards appear.
    setTimeout(() => {
      if (!session) return;
      session.phase = 'table';
      render();
    }, 620);
  };

  const move = (event) => {
    if (startX === null || torn) return;
    const dx = event.clientX - startX;
    const progress = Math.max(0, Math.min(1, dx / 140));
    strip.style.setProperty('--tear', String(progress));
    document.getElementById('pack-curl')?.style.setProperty('--tear', String(progress));
    const guide = document.getElementById('tear-guide');
    if (guide) {
      guide.style.setProperty('--tear', String(progress));
      guide.classList.add('active');
    }
    if (progress >= 1) tear();
  };

  const up = () => {
    if (startX !== null && !torn) {
      strip.style.setProperty('--tear', '0');
      document.getElementById('pack-curl')?.style.setProperty('--tear', '0');
      const guide = document.getElementById('tear-guide');
      if (guide) {
        guide.style.setProperty('--tear', '0');
        guide.classList.remove('active');
      }
    }
    startX = null;
  };

  pack.addEventListener('pointerdown', (event) => {
    startX = event.clientX;
    pack.setPointerCapture?.(event.pointerId);
  });
  pack.addEventListener('pointermove', move);
  pack.addEventListener('pointerup', up);
  pack.addEventListener('pointercancel', up);

  // Tapping (no drag) should also work — dragging is flavour, not a gate.
  pack.addEventListener('click', tear);
  pack.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      tear();
    }
  });
}

/**
 * Drag the top card off. Travel distance drives both its position and how far
 * it has flipped, so the card turns over in your hand as you pull it.
 */
/**
 * Two-beat reveal, the way a real pack works and the way TCG Pocket does it.
 *
 * Beat 1: the card is face-down. Tap (or drag) and it flips fast, then STAYS
 * centred and readable with its name, rarity, illustrator and price beneath it.
 * Beat 2: tap again and it slides onto the pile, exposing the next card.
 *
 * The previous version flipped and flung in a single gesture, so the card was
 * gone before it could be read — the whole point of opening a pack.
 */
function attachCard(card, pull) {
  if (!card) return;

  let flipped = false;
  let dismissed = false;
  let dragging = false;
  let startX = 0;
  let dx = 0;

  const inner = card.querySelector('.rcard-3d');
  const scene = () => session.mount.querySelector('.rip-scene');

  const setFlip = (progress) => {
    inner.style.transform = `rotateY(${180 - progress * 180}deg)`;
  };

  /** Land face-up and hold: this is the beat the user needs to actually look. */
  const reveal = () => {
    if (flipped) return;
    flipped = true;

    card.classList.remove('down');
    card.classList.add('up');
    card.style.transition = 'transform .26s cubic-bezier(.2,.8,.3,1)';
    card.style.transform = 'none';
    inner.style.transition = 'transform .26s cubic-bezier(.25,.9,.3,1)';
    setFlip(1);

    playSlide();
    if (pull.tier >= 3) {
      setTimeout(() => playHit(Math.min(1, (pull.tier - 2) / 7)), 80);
      const outcome = payoff(scene(), pull, {
        setId: session.set.id,
        priced: session.result.pricesAvailable,
      });
      if (outcome.walkout) session.awaitingWalkout = true;
    } else {
      clearTell(scene());
      setTimeout(playLand, 120);
    }

    session.runningValue += pull.price;
    bumpValue(pull.price);
    washScene(pull);
    landingBurst(pull.tier);
    showHandMeta(pull);
    attachTilt(card);
    const hint = document.getElementById('rip-hint');
    if (hint) hint.textContent = tapWord() + ' again for the next card';
  };

  /** Second beat: send it to the pile and expose the next card. */
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;

    card.style.transition = 'transform .3s cubic-bezier(.2,.7,.3,1), opacity .3s ease';
    card.style.transform = 'translate(360px, -30px) rotate(16deg)';
    card.style.opacity = '0';

    session.revealed += 1;
    session.seen.push(pull);
    clearHandMeta();

    const advance = () => {
      if (!session) return;
      paintStack();
      paintFan();
      const left = session.result.packs[session.packIndex].length - session.revealed;
      const hint = document.getElementById('rip-hint');
      if (hint && left) hint.textContent = 'Tap the card to flip it';
      updateChevrons();
    };

    if (session.awaitingWalkout) {
      onWalkoutClose(() => {
        if (!session) return;
        session.awaitingWalkout = false;
        advance();
      });
    } else {
      setTimeout(advance, 260);
    }
  };

  // Dragging the face-down card turns it over progressively — the tactile path.
  card.addEventListener('pointerdown', (event) => {
    if (flipped || dismissed) return;
    dragging = true;
    startX = event.clientX;
    card.setPointerCapture?.(event.pointerId);
    card.style.transition = 'none';
    inner.style.transition = 'none';
    beginTell(scene(), pull.tier);
  });

  card.addEventListener('pointermove', (event) => {
    if (!dragging || flipped) return;
    dx = event.clientX - startX;
    const progress = Math.min(1, Math.abs(dx) / FLIP_DISTANCE);
    card.style.transform = `translateX(${dx * 0.35}px) rotate(${dx * 0.02}deg)`;
    setFlip(progress);
  });

  const release = () => {
    if (!dragging || flipped) return;
    dragging = false;
    if (Math.abs(dx) >= FLIP_DISTANCE * 0.6) {
      reveal();
    } else {
      // Not far enough: fall back face-down and drop the tell.
      card.style.transition = 'transform .22s ease';
      inner.style.transition = 'transform .22s ease';
      card.style.transform = 'none';
      setFlip(0);
      clearTell(scene());
    }
    dx = 0;
  };

  card.addEventListener('pointerup', release);
  card.addEventListener('pointercancel', release);

  // Tap is the primary path: quick flip, then a second tap to move on.
  card.addEventListener('click', () => {
    if (Math.abs(dx) > 4) return;
    if (!flipped) {
      const grade = gradeFor(pull.tier);
      beginTell(scene(), pull.tier);
      // Big pulls hold on the tell a beat before turning over.
      setTimeout(reveal, grade.shake >= 1.1 ? 520 : 0);
    } else {
      dismiss();
    }
  });
}

/**
 * Update the running total.
 *
 * Counts up rather than snapping — watching the number climb is the point — and
 * the break-even bar fills toward what the pack cost, flipping green the moment
 * you clear it. A floating +$ chip marks each card's contribution.
 */
let countFrom = 0;
let countRaf = 0;

function bumpValue(delta = 0) {
  const value = document.getElementById('rip-value');
  if (!value) return;

  const target = session.runningValue;
  const start = countFrom;

  cancelAnimationFrame(countRaf);
  const settle = () => {
    value.textContent = money(target);
    countFrom = target;
  };

  // requestAnimationFrame does not tick in a hidden or heavily throttled tab, so
  // the tween is strictly an enhancement — the correct figure is written
  // directly whenever the animation cannot be trusted to land it.
  const canAnimate = !document.hidden
    && !(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

  if (!canAnimate) {
    settle();
  } else {
    const t0 = performance.now();
    const DUR = 420;
    const step = (now) => {
      const k = Math.min(1, (now - t0) / DUR);
      const eased = 1 - (1 - k) ** 3; // ease-out into the final figure
      if (k < 1) {
        value.textContent = money(start + (target - start) * eased);
        countRaf = requestAnimationFrame(step);
      } else {
        settle();
      }
    };
    countRaf = requestAnimationFrame(step);
  }

  const { ahead, pct } = moneyState();
  document.getElementById('rip-money')?.classList.toggle('ahead', ahead);
  const fill = document.getElementById('rip-bar-fill');
  if (fill) fill.style.width = `${pct}%`;

  value.classList.remove('bump');
  void value.offsetWidth;
  value.classList.add('bump');

  if (delta > 0) floatDelta(delta);
}

/** The +$ chip that rises off the running total. */
function floatDelta(amount) {
  const host = document.getElementById('rip-money');
  if (!host) return;
  const chip = document.createElement('span');
  chip.className = 'rip-delta';
  if (amount >= 5) chip.classList.add('big');
  chip.textContent = `+${money(amount)}`;
  host.appendChild(chip);
  setTimeout(() => chip.remove(), 1100);
}

/**
 * Free 3D tilt on the face-up card. The transform lives on the outer .rcard so
 * it composes with the inner flip rather than fighting it, and it resets on
 * leave so the card is square when it slides to the pile.
 */
function attachTilt(card) {
  const stage = card.closest('.stack-zone');
  if (!stage) return;

  const onMove = (event) => {
    if (!card.classList.contains('up')) return;
    const r = stage.getBoundingClientRect();
    const px = (event.clientX - r.left) / r.width - 0.5;
    const py = (event.clientY - r.top) / r.height - 0.5;
    card.style.transition = 'none';
    card.style.transform = `perspective(900px) rotateY(${px * 22}deg) rotateX(${py * -16}deg)`;
    card.style.setProperty('--shine', `${50 + px * 100}%`);
  };

  const reset = () => {
    card.style.transition = 'transform .35s cubic-bezier(.2,.8,.3,1)';
    card.style.transform = 'none';
  };

  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerleave', reset);
  // Handlers die with the scene, which rip.js clears between packs.
}

/** Phones tap, pointer devices click. */
function tapWord() {
  return window.matchMedia?.('(hover: none)').matches ? 'Tap' : 'Click';
}

/**
 * A flash at the moment the card lands face-up, scaled to how good it is: a
 * whisper for bulk, a full white-gold bloom for a grail.
 */
function landingBurst(tier) {
  if (tier < 3) return;
  const stage = document.querySelector('.stack-zone');
  if (!stage) return;
  const burst = document.createElement('div');
  burst.className = 'land-burst';
  burst.style.setProperty('--gl', glowFor(tier) || 'var(--accent)');
  burst.style.setProperty('--power', String(Math.min(1, (tier - 2) / 7)));
  stage.appendChild(burst);
  setTimeout(() => burst.remove(), 900);
}

/**
 * Tint the whole scene to the card in hand. TCG Pocket shifts its background
 * with every card, which is what stops a run of commons feeling like a spreadsheet
 * — the screen keeps changing even when the cards are worthless.
 */
function washScene(pull) {
  const scene = session.mount.querySelector('.rip-scene');
  if (!scene) return;
  const glow = glowFor(pull.tier) || 'rgba(120,140,190,.55)';
  scene.style.setProperty('--wash', glow);
  scene.classList.add('washed');
  scene.classList.toggle('wash-hot', pull.tier >= 5);
}

/** The details of the card currently face-up in hand. */
function showHandMeta(pull) {
  const meta = document.getElementById('hand-meta');
  if (!meta) return;
  const priced = session.result.pricesAvailable;
  meta.innerHTML = `
    ${pipsHtml(pull.tier)}
    <div class="hand-name">${esc(pull.card.n)}</div>
    <div class="hand-sub">
      ${esc(pull.card.r || '')}${pull.isReverse ? ' · reverse holo' : ''}
      ${pull.card.a ? ` · illus. ${esc(pull.card.a)}` : ''}
    </div>
    ${priced ? `<div class="hand-price">${money(pull.price)}</div>` : ''}`;
  meta.classList.add('shown');
}

function clearHandMeta() {
  const meta = document.getElementById('hand-meta');
  if (!meta) return;
  meta.classList.remove('shown');
  meta.innerHTML = '';
}

/** Pack finished: either pull the next one or go to the summary. */
function showPackDone() {
  const isLast = session.packIndex >= session.result.packs.length - 1;
  const hint = document.getElementById('rip-hint');
  if (!hint) return;

  if (isLast) {
    const label = session.result.pricesAvailable ? 'See the full breakdown →' : 'See the summary →';
    hint.innerHTML = `<button class="btn" id="rip-see" type="button">${label}</button>`;
    document.getElementById('rip-see')?.addEventListener('click', () => session.onFinish());
    return;
  }

  hint.innerHTML = `<button class="btn" id="rip-next" type="button">Next pack →</button>`;
  document.getElementById('rip-next')?.addEventListener('click', () => {
    session.packIndex += 1;
    session.revealed = 0;
    session.seen = [];
    session.review = null;
    session.phase = 'sealed';
    playPackPull();
    render();
    preloadPack(session.result.packs[session.packIndex]);
  });
}
