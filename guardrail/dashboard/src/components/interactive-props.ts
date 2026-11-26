/**
 * Guardrail Dashboard - Interactive Pixel & Tactile Props
 *
 * Places well-proportioned, interactive pixel-art props in natural places
 * across the desktop dashboard:
 * - Header Lantern (side of page headings): click to toggle warm amber light.
 * - Perched Songbird (top rail of 03 / Enforcement frame on Overview): hops & chirps.
 * - Potted Botanical Sprout (top ledge of Recent Activity board on Overview): waters & blooms.
 * - Sidebar Garden Corner (open lower sidebar rail): Breeze Pinwheel + Hanging Wind Chime.
 */

let sharedLanternLit = true;
let sharedPlantStage = 1;

/**
 * Larger wrought-iron & brass lantern placed beside page headings.
 */
export function createHeaderLanternProp(): HTMLElement {
  const lanternBtn = document.createElement('button');
  lanternBtn.type = 'button';
  lanternBtn.className = `gd-prop-btn gd-prop-lantern gd-prop-header-lantern${sharedLanternLit ? ' is-lit' : ''}`;
  lanternBtn.setAttribute('aria-label', 'Toggle lantern light');
  lanternBtn.title = 'Click to toggle lantern';
  lanternBtn.tabIndex = -1;
  lanternBtn.innerHTML = `
    <span class="gd-lantern-glow" aria-hidden="true"></span>
    <svg class="gd-prop-svg" width="56" height="92" viewBox="0 0 56 92" fill="none" xmlns="http://www.w3.org/2000/svg">
      <!-- Tall wooden lamp post & wrought-iron arm -->
      <rect x="7" y="8" width="6" height="82" rx="1" fill="#765B3F" stroke="#362617" stroke-width="1.4"/>
      <rect x="4" y="84" width="12" height="5" rx="1" fill="#5B442D" stroke="#362617" stroke-width="1.2"/>
      <rect x="9" y="8" width="28" height="4.5" rx="1" fill="#8E7253" stroke="#362617" stroke-width="1.3"/>
      <!-- Iron diagonal brace -->
      <path d="M13 24 L24 12.5" stroke="#2F2B26" stroke-width="2" stroke-linecap="round"/>
      <!-- Hanging chain -->
      <line x1="33" y1="12.5" x2="33" y2="21" stroke="#2F2B26" stroke-width="2"/>
      <!-- Lantern cap -->
      <path d="M21 26 L45 26 L39 20 L27 20 Z" fill="#2F2B26"/>
      <rect x="30" y="18" width="6" height="2.5" rx="1" fill="#4A443C"/>
      <!-- Lantern glass body -->
      <rect class="gd-lantern-glass" x="23" y="26" width="20" height="26" rx="2" fill="#F5D076" stroke="#2F2B26" stroke-width="1.6"/>
      <!-- Mullion bars -->
      <line x1="33" y1="26" x2="33" y2="52" stroke="#2F2B26" stroke-width="1.2" opacity="0.45"/>
      <rect class="gd-lantern-flame" x="29.5" y="33" width="7" height="12" rx="2.5" fill="#FFF8DC"/>
      <!-- Lantern base & finial -->
      <rect x="21" y="52" width="24" height="4.5" rx="1" fill="#2F2B26"/>
      <path d="M29 56.5 L37 56.5 L33 61 Z" fill="#2F2B26"/>
    </svg>
  `;
  lanternBtn.addEventListener('click', () => {
    sharedLanternLit = !sharedLanternLit;
    lanternBtn.classList.toggle('is-lit', sharedLanternLit);
    lanternBtn.classList.remove('is-nudged');
    void lanternBtn.offsetWidth;
    lanternBtn.classList.add('is-nudged');
  });
  return lanternBtn;
}

/**
 * Perched Pixel Songbird sitting on top of the 03 / Enforcement wooden frame.
 */
export function createPerchedBirdProp(): HTMLElement {
  const birdBtn = document.createElement('button');
  birdBtn.type = 'button';
  birdBtn.className = 'gd-prop-btn gd-prop-bird gd-prop-card-perched';
  birdBtn.setAttribute('aria-label', 'Say hello to perched bird');
  birdBtn.title = 'Click the bird';
  birdBtn.tabIndex = -1;
  const chirps = ['Chirp!', 'All clear!', 'Watching...', 'Cozy day!'];
  let chirpIdx = 0;
  let chirpTimer: ReturnType<typeof setTimeout> | null = null;

  birdBtn.innerHTML = `
    <span class="gd-bird-chirp" aria-hidden="true"></span>
    <svg class="gd-prop-svg" width="52" height="46" viewBox="0 0 52 46" fill="none" xmlns="http://www.w3.org/2000/svg">
      <!-- Pixel Robin perched directly on frame top -->
      <g class="gd-bird-body">
        <rect x="16" y="17" width="16" height="13" rx="3" fill="#5E493A" stroke="#2E2219" stroke-width="1.2"/>
        <rect x="18" y="21" width="9" height="8" rx="2" fill="#D47448"/>
        <rect x="28" y="12" width="9" height="9" rx="2.5" fill="#5E493A" stroke="#2E2219" stroke-width="1.2"/>
        <rect x="32.5" y="15" width="2.4" height="2.4" fill="#FAF4E6"/>
        <rect x="37" y="16.5" width="5" height="3" rx="0.8" fill="#E5BA5C" stroke="#5A3F18" stroke-width="0.8"/>
        <rect x="9" y="23" width="7" height="4" rx="1" fill="#463529" stroke="#2E2219" stroke-width="1"/>
        <line x1="22" y1="30" x2="22" y2="39" stroke="#362617" stroke-width="2" stroke-linecap="round"/>
        <line x1="27" y1="30" x2="27" y2="39" stroke="#362617" stroke-width="2" stroke-linecap="round"/>
      </g>
    </svg>
  `;
  const chirpBubble = birdBtn.querySelector('.gd-bird-chirp') as HTMLElement | null;
  birdBtn.addEventListener('click', (e) => {
    e.stopPropagation();
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
  return birdBtn;
}

/**
 * Potted Botanical Sprout resting on top of the Recent Activity wooden frame.
 */
export function createPottedPlantProp(): HTMLElement {
  const plantBtn = document.createElement('button');
  plantBtn.type = 'button';
  plantBtn.className = `gd-prop-btn gd-prop-plant gd-prop-board-plant stage-${sharedPlantStage}`;
  plantBtn.setAttribute('aria-label', 'Water potted sprout');
  plantBtn.title = 'Click to water & grow';
  plantBtn.tabIndex = -1;
  plantBtn.innerHTML = `
    <svg class="gd-prop-svg" width="46" height="58" viewBox="0 0 46 58" fill="none" xmlns="http://www.w3.org/2000/svg">
      <!-- Terracotta pot -->
      <rect x="10" y="36" width="26" height="5.5" rx="1.2" fill="#C4744F" stroke="#5A2F1B" stroke-width="1.3"/>
      <path d="M13 41.5 L33 41.5 L30 55 L16 55 Z" fill="#B2623F" stroke="#5A2F1B" stroke-width="1.3"/>
      <!-- Stage 1: Small sprout -->
      <g class="gd-plant-stage gd-plant-s1">
        <rect x="21.5" y="25" width="3" height="11" fill="#54683E"/>
        <rect x="15" y="22" width="6.5" height="4.5" rx="1.5" fill="#779654"/>
        <rect x="24.5" y="24" width="6.5" height="4.5" rx="1.5" fill="#638044"/>
      </g>
      <!-- Stage 2: Leafy fern -->
      <g class="gd-plant-stage gd-plant-s2">
        <rect x="21.5" y="17" width="3" height="19" fill="#465A33"/>
        <rect x="12" y="23" width="9.5" height="4.5" rx="1.5" fill="#6D8F4B"/>
        <rect x="24.5" y="21" width="9.5" height="4.5" rx="1.5" fill="#7CA058"/>
        <rect x="15" y="15" width="6.5" height="4.5" rx="1.5" fill="#88AD63"/>
        <rect x="24.5" y="13" width="6.5" height="4.5" rx="1.5" fill="#7CA058"/>
      </g>
      <!-- Stage 3: Blooming golden flower -->
      <g class="gd-plant-stage gd-plant-s3">
        <rect x="21.5" y="13" width="3" height="23" fill="#465A33"/>
        <rect x="12" y="24" width="9.5" height="4.5" rx="1.5" fill="#6D8F4B"/>
        <rect x="24.5" y="22" width="9.5" height="4.5" rx="1.5" fill="#7CA058"/>
        <rect x="18" y="6" width="10" height="10" rx="2.5" fill="#F2C955" stroke="#8F6714" stroke-width="1.2"/>
        <rect x="21" y="9" width="4" height="4" rx="1" fill="#8F4C14"/>
      </g>
    </svg>
    <span class="gd-plant-droplet" aria-hidden="true">✦</span>
  `;
  plantBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    plantBtn.classList.remove(`stage-${sharedPlantStage}`);
    sharedPlantStage = (sharedPlantStage % 3) + 1;
    plantBtn.classList.add(`stage-${sharedPlantStage}`);
    plantBtn.classList.remove('is-watered');
    void plantBtn.offsetWidth;
    plantBtn.classList.add('is-watered');
  });
  return plantBtn;
}

/**
 * Cozy sidebar shelf holding the Breeze Pinwheel and Hanging Brass Wind Chime
 * in the open space above the account footer across all pages.
 */
export function createSidebarGardenCorner(): HTMLElement {
  const shelf = document.createElement('div');
  shelf.className = 'gd-sidebar-props-shelf';

  // Wind Chime
  const chimeBtn = document.createElement('button');
  chimeBtn.type = 'button';
  chimeBtn.className = 'gd-prop-btn gd-prop-chime';
  chimeBtn.setAttribute('aria-label', 'Ring hanging wind chime');
  chimeBtn.title = 'Click to chime';
  chimeBtn.tabIndex = -1;
  chimeBtn.innerHTML = `
    <svg class="gd-prop-svg" width="46" height="56" viewBox="0 0 46 56" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="7" y="3" width="32" height="5" rx="1.2" fill="#A78A68" stroke="#362617" stroke-width="1.2"/>
      <circle cx="12" cy="5.5" r="1.2" fill="#E5BA5C"/>
      <circle cx="34" cy="5.5" r="1.2" fill="#E5BA5C"/>
      <g class="gd-chime-rod gd-chime-rod-1">
        <line x1="14" y1="8" x2="14" y2="15" stroke="#D5C7AE" stroke-width="1.2"/>
        <rect x="11.5" y="15" width="5" height="23" rx="1.2" fill="#D9A44E" stroke="#5A3F18" stroke-width="1"/>
      </g>
      <g class="gd-chime-rod gd-chime-rod-2">
        <line x1="23" y1="8" x2="23" y2="13" stroke="#D5C7AE" stroke-width="1.2"/>
        <rect x="20.5" y="13" width="5" height="31" rx="1.2" fill="#E8C16E" stroke="#5A3F18" stroke-width="1"/>
      </g>
      <g class="gd-chime-rod gd-chime-rod-3">
        <line x1="32" y1="8" x2="32" y2="16" stroke="#D5C7AE" stroke-width="1.2"/>
        <rect x="29.5" y="16" width="5" height="21" rx="1.2" fill="#C99342" stroke="#5A3F18" stroke-width="1"/>
      </g>
    </svg>
    <span class="gd-prop-sparkle" aria-hidden="true">♪</span>
  `;
  chimeBtn.addEventListener('click', () => {
    chimeBtn.classList.remove('is-ringing');
    void chimeBtn.offsetWidth;
    chimeBtn.classList.add('is-ringing');
  });

  // Breeze Pinwheel
  const pinwheelBtn = document.createElement('button');
  pinwheelBtn.type = 'button';
  pinwheelBtn.className = 'gd-prop-btn gd-prop-pinwheel';
  pinwheelBtn.setAttribute('aria-label', 'Spin breeze pinwheel');
  pinwheelBtn.title = 'Click to spin pinwheel';
  pinwheelBtn.tabIndex = -1;
  pinwheelBtn.innerHTML = `
    <svg class="gd-prop-svg" width="50" height="66" viewBox="0 0 50 66" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="23" y="25" width="4" height="38" rx="1" fill="#A78A68" stroke="#362617" stroke-width="1.2"/>
      <g class="gd-pinwheel-blades" style="transform-origin: 25px 25px;">
        <path d="M25 25 L25 7 L34 15 Z" fill="#D9A44E" stroke="#362617" stroke-width="1.2"/>
        <path d="M25 25 L43 25 L34 34 Z" fill="#6D8F4B" stroke="#1E2819" stroke-width="1.2"/>
        <path d="M25 25 L25 43 L16 34 Z" fill="#FAF4E6" stroke="#362617" stroke-width="1.2"/>
        <path d="M25 25 L7 25 L16 15 Z" fill="#C4744F" stroke="#362617" stroke-width="1.2"/>
        <circle cx="25" cy="25" r="3" fill="#2F2B26" stroke="#FAF4E6" stroke-width="1"/>
      </g>
    </svg>
  `;

  let pinAngle = 0;
  let pinVelocity = 0.45;
  let pinRafId: number | null = null;
  const bladesEl = pinwheelBtn.querySelector('.gd-pinwheel-blades') as SVGGElement | null;

  const stepPinwheel = () => {
    if (typeof document !== 'undefined' && !document.contains(pinwheelBtn)) {
      pinRafId = null;
      return;
    }
    pinAngle = (pinAngle + pinVelocity) % 360;
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

  shelf.appendChild(chimeBtn);
  shelf.appendChild(pinwheelBtn);
  return shelf;
}
