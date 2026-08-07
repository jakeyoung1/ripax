/**
 * Reveal drama, escalating with rarity.
 *
 * The mechanic borrowed from card-pack games like NBA 2K's MyTeam is
 * *signal before information*: the screen floods with a colour and starts
 * shaking while the card is still face-down. You know something big is coming
 * before you know what it is, and that gap is the whole thrill. So the "tell"
 * fires the moment the user commits to pulling, not after the card has landed.
 *
 * Grades map from the engine's rarity tier (0-9):
 *   base        0-2   no ceremony, keep the pace up
 *   holo        3     blue pulse, faint shake
 *   ultra       4     violet, real shake
 *   illustration5     pink, shake + light beams
 *   secret      6     orange, heavy shake + flash
 *   grail       7     gold, flash + confetti
 *   walkout     8-9   full-screen cinematic takeover
 */

import { playFanfare, startRumble, stopRumble } from './audio.js';
import { attr, cardImage, esc, money } from './views.js';

export const GRADES = [
  { at: 8, name: 'walkout', label: 'GRAIL', colour: '#ffe680', shake: 3.2, walkout: true },
  { at: 7, name: 'grail', label: 'SECRET', colour: '#ffd447', shake: 2.6, confetti: true },
  { at: 6, name: 'secret', label: 'ULTRA', colour: '#ff9d4d', shake: 2.1, flash: true },
  { at: 5, name: 'illustration', label: 'RARE ART', colour: '#ff8fd8', shake: 1.6, beams: true },
  { at: 4, name: 'ultra', label: 'BIG HIT', colour: '#9d7bff', shake: 1.1 },
  { at: 3, name: 'holo', label: 'HOLO', colour: '#63b3ff', shake: 0.6 },
  { at: 0, name: 'base', label: '', colour: '', shake: 0 },
];

export function gradeFor(tier) {
  return GRADES.find((g) => tier >= g.at) || GRADES[GRADES.length - 1];
}

const reducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

let activeTell = null;

/**
 * Start the pre-reveal tell. Called when the drag begins, so the colour and
 * rumble land while the card is still face-down.
 */
export function beginTell(scene, tier) {
  const grade = gradeFor(tier);
  if (!scene || !grade.shake) return grade;

  clearTell(scene);
  activeTell = scene;

  scene.classList.add('telling', `tell-${grade.name}`);
  scene.style.setProperty('--tell', grade.colour);
  // Reduced-motion users still get the colour, just not the camera shake.
  scene.style.setProperty('--shake', reducedMotion() ? '0' : String(grade.shake));

  if (grade.beams || grade.walkout) scene.classList.add('tell-beams');
  startRumble(Math.min(1, tier / 9));
  return grade;
}

export function clearTell(scene) {
  if (!scene) return;
  scene.classList.remove('telling', 'tell-beams');
  for (const grade of GRADES) scene.classList.remove(`tell-${grade.name}`);
  scene.style.removeProperty('--tell');
  scene.style.removeProperty('--shake');
  stopRumble();
  activeTell = null;
}

/** Called when the card has been taken: pay off whatever the tell promised. */
export function payoff(scene, pull, { setId, priced }) {
  const grade = gradeFor(pull.tier);
  clearTell(scene);
  if (!grade.shake) return { walkout: false };

  if (grade.flash || grade.confetti || grade.walkout) screenFlash(scene, grade);
  if (grade.confetti && !reducedMotion()) confetti(scene, grade.colour, 34);

  if (grade.walkout) {
    walkout(pull, { setId, priced, grade });
    return { walkout: true };
  }

  banner(scene, pull, grade);
  return { walkout: false };
}

// ── effects ────────────────────────────────────────────────────────

function screenFlash(scene, grade) {
  const flash = document.createElement('div');
  flash.className = 'fx-flash';
  flash.style.setProperty('--tell', grade.colour);
  scene.appendChild(flash);
  setTimeout(() => flash.remove(), 620);
}

/** Rarity name sweeping across, sized to the grade. */
function banner(scene, pull, grade) {
  const el = document.createElement('div');
  el.className = `fx-banner g-${grade.name}`;
  el.style.setProperty('--tell', grade.colour);
  el.innerHTML = `
    <span class="fx-grade">${esc(grade.label)}</span>
    <span class="fx-rarity">${esc(pull.card.r || '')}</span>`;
  scene.appendChild(el);
  setTimeout(() => el.remove(), 1600);
}

function confetti(scene, colour, count) {
  const wrap = document.createElement('div');
  wrap.className = 'fx-confetti';
  const palette = [colour, '#ffffff', '#ffcb3d', '#63b3ff', '#ff5ea8'];

  for (let i = 0; i < count; i += 1) {
    const bit = document.createElement('i');
    bit.style.setProperty('--x', `${Math.random() * 100}%`);
    bit.style.setProperty('--dx', `${(Math.random() - 0.5) * 220}px`);
    bit.style.setProperty('--rot', `${Math.random() * 720 - 360}deg`);
    bit.style.setProperty('--delay', `${Math.random() * 260}ms`);
    bit.style.setProperty('--dur', `${1100 + Math.random() * 900}ms`);
    bit.style.background = palette[i % palette.length];
    wrap.appendChild(bit);
  }
  scene.appendChild(wrap);
  setTimeout(() => wrap.remove(), 2400);
}

/**
 * The walkout: a full-screen takeover for the rarest pulls. Rays turn behind the
 * card, the card rises into frame, and nothing else happens until it's dismissed.
 */
function walkout(pull, { setId, priced, grade }) {
  const host = document.getElementById('fx-host');
  if (!host) return;

  playFanfare();

  host.innerHTML = `
    <div class="walkout" style="--tell:${attr(grade.colour)}">
      <div class="walkout-rays"></div>
      <div class="walkout-glow"></div>
      <div class="walkout-inner">
        <div class="walkout-grade">${esc(grade.label)}</div>
        <div class="walkout-riser">
          <div class="walkout-card" id="walkout-card">
            ${cardImage(setId, pull.card, { hires: true, alt: pull.card.n })}
          </div>
        </div>
        <div class="walkout-meta">
          <div class="walkout-name">${esc(pull.card.n)}</div>
          <div class="walkout-rarity">${esc(pull.card.r || '')}</div>
          ${priced && pull.price ? `<div class="walkout-price">${money(pull.price)}</div>` : ''}
        </div>
        <button class="btn walkout-go" id="walkout-go" type="button">Keep ripping →</button>
      </div>
    </div>`;

  if (!reducedMotion()) confetti(host.querySelector('.walkout'), grade.colour, 44);

  // Tilt the card toward the pointer — makes the foil feel like it catches light.
  const card = document.getElementById('walkout-card');
  const onMove = (event) => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const rx = ((event.clientY ?? h / 2) / h - 0.5) * -16;
    const ry = ((event.clientX ?? w / 2) / w - 0.5) * 20;
    card.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg)`;
  };
  host.addEventListener('pointermove', onMove);

  const close = () => {
    host.removeEventListener('pointermove', onMove);
    host.innerHTML = '';
    if (typeof walkout.onClose === 'function') walkout.onClose();
  };

  document.getElementById('walkout-go')?.addEventListener('click', close);
  host.querySelector('.walkout')?.addEventListener('click', (event) => {
    if (event.target.closest('.walkout-inner')) return;
    close();
  });
}

/** rip.js sets this so it can resume once the walkout is dismissed. */
export function onWalkoutClose(fn) {
  walkout.onClose = fn;
}
