/**
 * Guardrail Dashboard - Interactive Pixel & Tactile Props
 *
 * Adds subtle, persistent, interactive pixel-art props anchored along the
 * desktop workspace corners & village horizon:
 * 1. Hanging Brass Wind Chime (top-left): staggered spring sway + sparkle notes.
 * 2. Wrought-Iron Brass Lantern (bottom-left): click to light/extinguish warm glow & embers.
 * 3. Potted Botanical Sprout (bottom-left): click to water & grow through 3 stages.
 * 4. Breeze Pinwheel (bottom-right): physics-driven angular momentum spin on click/hover.
 * 5. Perched Pixel Songbird (bottom-right): hops, flutters & chirps friendly status notes.
 */

export function createDashboardPropsLayer(): HTMLElement {
  const layer = document.createElement('div');
  layer.className = 'gd-props-layer';

  // 1. Top-Left Hanging Wind Chime
  const chimeBtn = document.createElement('button');
  chimeBtn.type = 'button';
  chimeBtn.className = 'gd-prop-btn gd-prop-chime';
  chimeBtn.setAttribute('aria-label', 'Ring hanging wind chime');
  chimeBtn.title = 'Click to chime';
  chimeBtn.tabIndex = -1;
  chimeBtn.innerHTML = `
    <svg class="gd-prop-svg" width="38" height="44" viewBox="0 0 38 44" fill="none" xmlns="http://www.w3.org/2000/svg">
      <!-- Top wooden crossbar -->
      <rect x="6" y="2" width="26" height="4" rx="1" fill="#8E7253" stroke="#362617" stroke-width="1.2"/>
      <circle cx="10" cy="4" r="1" fill="#E5BA5C"/>
      <circle cx="28" cy="4" r="1" fill="#E5BA5C"/>
      <!-- 3 hanging brass chimes -->
      <g class="gd-chime-rod gd-chime-rod-1">
        <line x1="12" y1="6" x2="12" y2="12" stroke="#4A3A28" stroke-width="1"/>
        <rect x="10" y="12" width="4" height="18" rx="1" fill="#D9A44E" stroke="#5A3F18" stroke-width="1"/>
      </g>
      <g class="gd-chime-rod gd-chime-rod-2">
        <line x1="19" y1="6" x2="19" y2="10" stroke="#4A3A28" stroke-width="1"/>
        <rect x="17" y="10" width="4" height="24" rx="1" fill="#E8C16E" stroke="#5A3F18" stroke-width="1"/>
      </g>
      <g class="gd-chime-rod gd-chime-rod-3">
        <line x1="26" y1="6" x2="26" y2="13" stroke="#4A3A28" stroke-width="1"/>
        <rect x="24" y="13" width="4" height="16" rx="1" fill="#C99342" stroke="#5A3F18" stroke-width="1"/>
      </g>
    </svg>
    <span class="gd-prop-sparkle" aria-hidden="true">♪</span>
  `;
  chimeBtn.addEventListener('click', () => {
    chimeBtn.classList.remove('is-ringing');
    void chimeBtn.offsetWidth;
    chimeBtn.classList.add('is-ringing');
  });
  layer.appendChild(chimeBtn);

  // 2. Bottom-Left Hanging Brass Lantern
  const lanternBtn = document.createElement('button');
  lanternBtn.type = 'button';
  lanternBtn.className = 'gd-prop-btn gd-prop-lantern is-lit';
  lanternBtn.setAttribute('aria-label', 'Toggle lantern light');
  lanternBtn.title = 'Click to toggle lantern';
  lanternBtn.tabIndex = -1;
  lanternBtn.innerHTML = `
    <span class="gd-lantern-glow" aria-hidden="true"></span>
    <svg class="gd-prop-svg" width="34" height="48" viewBox="0 0 34 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <!-- Wooden post & hook -->
      <rect x="4" y="8" width="4" height="38" fill="#765B3F" stroke="#362617" stroke-width="1"/>
      <rect x="6" y="8" width="14" height="3" fill="#8E7253" stroke="#362617" stroke-width="1"/>
      <line x1="18" y1="11" x2="18" y2="15" stroke="#2F2B26" stroke-width="1.4"/>
      <!-- Lantern cap -->
      <path d="M12 16 L24 16 L21 13 L15 13 Z" fill="#2F2B26"/>
      <!-- Lantern glass body -->
      <rect class="gd-lantern-glass" x="13" y="16" width="10" height="13" rx="1" fill="#F5D076" stroke="#2F2B26" stroke-width="1.3"/>
      <rect class="gd-lantern-flame" x="16.5" y="19.5" width="3" height="6" rx="1" fill="#FFF7D6"/>
      <!-- Lantern base -->
      <rect x="12" y="29" width="12" height="3" rx="0.8" fill="#2F2B26"/>
    </svg>
  `;
  lanternBtn.addEventListener('click', () => {
    lanternBtn.classList.toggle('is-lit');
    lanternBtn.classList.remove('is-nudged');
    void lanternBtn.offsetWidth;
    lanternBtn.classList.add('is-nudged');
  });
  layer.appendChild(lanternBtn);

  // 3. Bottom-Left Potted Botanical Sprout (3 growth stages)
  const plantBtn = document.createElement('button');
  plantBtn.type = 'button';
  plantBtn.className = 'gd-prop-btn gd-prop-plant stage-1';
  plantBtn.setAttribute('aria-label', 'Water potted sprout');
  plantBtn.title = 'Click to water & grow';
  plantBtn.tabIndex = -1;
  let plantStage = 1;
  plantBtn.innerHTML = `
    <svg class="gd-prop-svg" width="32" height="42" viewBox="0 0 32 42" fill="none" xmlns="http://www.w3.org/2000/svg">
      <!-- Terracotta pot -->
      <rect x="7" y="26" width="18" height="4" rx="1" fill="#C4744F" stroke="#5A2F1B" stroke-width="1.2"/>
      <path d="M9 30 L23 30 L21 40 L11 40 Z" fill="#B2623F" stroke="#5A2F1B" stroke-width="1.2"/>
      <!-- Stage 1: Small sprout -->
      <g class="gd-plant-stage gd-plant-s1">
        <rect x="15" y="19" width="2" height="7" fill="#54683E"/>
        <rect x="11" y="17" width="4" height="3" rx="1" fill="#779654"/>
        <rect x="17" y="18" width="4" height="3" rx="1" fill="#638044"/>
      </g>
      <!-- Stage 2: Leafy fern -->
      <g class="gd-plant-stage gd-plant-s2">
        <rect x="15" y="14" width="2" height="12" fill="#465A33"/>
        <rect x="9" y="17" width="6" height="3" rx="1" fill="#6D8F4B"/>
        <rect x="17" y="16" width="6" height="3" rx="1" fill="#7CA058"/>
        <rect x="11" y="12" width="4" height="3" rx="1" fill="#88AD63"/>
        <rect x="17" y="11" width="4" height="3" rx="1" fill="#7CA058"/>
      </g>
      <!-- Stage 3: Blooming golden flower -->
      <g class="gd-plant-stage gd-plant-s3">
        <rect x="15" y="11" width="2" height="15" fill="#465A33"/>
        <rect x="9" y="18" width="6" height="3" rx="1" fill="#6D8F4B"/>
        <rect x="17" y="17" width="6" height="3" rx="1" fill="#7CA058"/>
        <rect x="13" y="6" width="6" height="6" rx="1.5" fill="#F2C955" stroke="#8F6714" stroke-width="1"/>
        <rect x="15" y="8" width="2" height="2" fill="#8F4C14"/>
      </g>
    </svg>
    <span class="gd-plant-droplet" aria-hidden="true">✦</span>
  `;
  plantBtn.addEventListener('click', () => {
    plantBtn.classList.remove(`stage-${plantStage}`);
    plantStage = (plantStage % 3) + 1;
    plantBtn.classList.add(`stage-${plantStage}`);
    plantBtn.classList.remove('is-watered');
    void plantBtn.offsetWidth;
    plantBtn.classList.add('is-watered');
  });
  layer.appendChild(plantBtn);

  // 4. Bottom-Right Breeze Pinwheel (smooth angular velocity physics)
  const pinwheelBtn = document.createElement('button');
  pinwheelBtn.type = 'button';
  pinwheelBtn.className = 'gd-prop-btn gd-prop-pinwheel';
  pinwheelBtn.setAttribute('aria-label', 'Spin breeze pinwheel');
  pinwheelBtn.title = 'Click to spin pinwheel';
  pinwheelBtn.tabIndex = -1;
  pinwheelBtn.innerHTML = `
    <svg class="gd-prop-svg" width="36" height="50" viewBox="0 0 36 50" fill="none" xmlns="http://www.w3.org/2000/svg">
      <!-- Wooden stake -->
      <rect x="16.5" y="18" width="3" height="30" fill="#8E7253" stroke="#362617" stroke-width="1"/>
      <!-- Spinning blades group -->
      <g class="gd-pinwheel-blades" style="transform-origin: 18px 18px;">
        <path d="M18 18 L18 5 L25 11 Z" fill="#D9A44E" stroke="#362617" stroke-width="1"/>
        <path d="M18 18 L31 18 L25 25 Z" fill="#6D8F4B" stroke="#273121" stroke-width="1"/>
        <path d="M18 18 L18 31 L11 25 Z" fill="#FAF4E6" stroke="#362617" stroke-width="1"/>
        <path d="M18 18 L5 18 L11 11 Z" fill="#C4744F" stroke="#362617" stroke-width="1"/>
        <circle cx="18" cy="18" r="2.2" fill="#2F2B26" stroke="#FAF4E6" stroke-width="0.8"/>
      </g>
    </svg>
  `;

  let pinAngle = 0;
  let pinVelocity = 0.45; // gentle ambient breeze deg/frame
  let pinRafId: number | null = null;
  const bladesEl = pinwheelBtn.querySelector('.gd-pinwheel-blades') as SVGGElement | null;

  const stepPinwheel = () => {
    if (typeof document !== 'undefined' && !document.contains(pinwheelBtn)) {
      pinRafId = null;
      return;
    }
    pinAngle = (pinAngle + pinVelocity) % 360;
    // Exponential decay back toward gentle 0.45 deg/frame breeze
    pinVelocity = 0.45 + (pinVelocity - 0.45) * 0.975;
    if (bladesEl) {
      bladesEl.style.transform = `rotate(${pinAngle.toFixed(2)}deg)`;
    }
    pinRafId = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(stepPinwheel) : null;
  };

  if (typeof window !== 'undefined' && typeof requestAnimationFrame === 'function') {
    const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!prefersReduced) {
      pinRafId = requestAnimationFrame(stepPinwheel);
    }
  }

  pinwheelBtn.addEventListener('click', () => {
    pinVelocity = Math.min(pinVelocity + 12, 24);
    if (pinRafId === null && typeof requestAnimationFrame === 'function') {
      pinRafId = requestAnimationFrame(stepPinwheel);
    }
  });
  pinwheelBtn.addEventListener('mouseenter', () => {
    pinVelocity = Math.max(pinVelocity, 4.5);
  });
  layer.appendChild(pinwheelBtn);

  // 5. Bottom-Right Perched Pixel Songbird
  const birdBtn = document.createElement('button');
  birdBtn.type = 'button';
  birdBtn.className = 'gd-prop-btn gd-prop-bird';
  birdBtn.setAttribute('aria-label', 'Say hello to perched bird');
  birdBtn.title = 'Click the bird';
  birdBtn.tabIndex = -1;
  const chirps = ['Chirp!', 'All clear!', 'Watching...', 'Cozy day!'];
  let chirpIdx = 0;
  let chirpTimer: ReturnType<typeof setTimeout> | null = null;

  birdBtn.innerHTML = `
    <span class="gd-bird-chirp" aria-hidden="true"></span>
    <svg class="gd-prop-svg" width="38" height="44" viewBox="0 0 38 44" fill="none" xmlns="http://www.w3.org/2000/svg">
      <!-- Wooden fence post -->
      <rect x="14" y="25" width="8" height="18" fill="#8E7253" stroke="#362617" stroke-width="1.2"/>
      <rect x="12" y="24" width="12" height="3" fill="#A78A68" stroke="#362617" stroke-width="1"/>
      <!-- Pixel Robin -->
      <g class="gd-bird-body">
        <rect x="13" y="13" width="11" height="9" rx="2" fill="#5E493A"/>
        <rect x="14" y="16" width="6" height="5" rx="1" fill="#D47448"/>
        <rect x="21" y="11" width="6" height="6" rx="1.5" fill="#5E493A"/>
        <rect x="24" y="13" width="1.8" height="1.8" fill="#FAF4E6"/>
        <rect x="27" y="14" width="3" height="2" fill="#E5BA5C"/>
        <rect x="9" y="17" width="4" height="3" fill="#463529"/>
        <line x1="17" y1="22" x2="17" y2="24" stroke="#362617" stroke-width="1.4"/>
        <line x1="20" y1="22" x2="20" y2="24" stroke="#362617" stroke-width="1.4"/>
      </g>
    </svg>
  `;
  const chirpBubble = birdBtn.querySelector('.gd-bird-chirp') as HTMLElement | null;
  birdBtn.addEventListener('click', () => {
    birdBtn.classList.remove('is-hopping');
    void birdBtn.offsetWidth;
    birdBtn.classList.add('is-hopping');
    if (chirpBubble) {
      chirpBubble.textContent = chirps[chirpIdx % chirps.length];
      chirpIdx += 1;
      chirpBubble.classList.add('is-visible');
      if (chirpTimer) clearTimeout(chirpTimer);
      chirpTimer = setTimeout(() => {
        chirpBubble.classList.remove('is-visible');
      }, 1400);
    }
  });
  layer.appendChild(birdBtn);

  return layer;
}
