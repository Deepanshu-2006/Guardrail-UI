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

let sharedLanternLit = false;
let sharedPlantStage = 1;

function syncLanternAmbience(): void {
  if (typeof document === 'undefined') return;
  const appEl = document.querySelector('.gd-dashboard-app');
  if (appEl) {
    appEl.classList.toggle('gd-lantern-ambience-on', sharedLanternLit);
  }
}

/**
 * Larger wrought-iron & brass lantern placed on the left of the Overview heading.
 * Clicking toggles warm candlelight ambience, swings the hanging lantern head
 * with pendulum physics, and awakens subtle golden fireflies across Overview.
 */
export function createHeaderLanternProp(): HTMLElement {
  const lanternBtn = document.createElement('button');
  lanternBtn.type = 'button';
  lanternBtn.className = `gd-prop-btn gd-prop-lantern gd-prop-header-lantern${sharedLanternLit ? ' is-lit' : ''}`;
  lanternBtn.setAttribute('aria-label', 'Toggle lantern light');
  lanternBtn.setAttribute('aria-pressed', sharedLanternLit ? 'true' : 'false');
  lanternBtn.title = sharedLanternLit ? 'Click to extinguish lantern' : 'Click to light lantern';
  lanternBtn.tabIndex = -1;
  lanternBtn.innerHTML = `
    <span class="gd-lantern-glow" aria-hidden="true"></span>
    <span class="gd-lantern-cone" aria-hidden="true"></span>
    <span class="gd-lantern-embers" aria-hidden="true">
      <span class="gd-ember gd-ember-1"></span>
      <span class="gd-ember gd-ember-2"></span>
      <span class="gd-ember gd-ember-3"></span>
      <span class="gd-ember gd-ember-4"></span>
    </span>
    <svg class="gd-prop-svg" width="88" height="142" viewBox="0 0 88 142" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="gd-lantern-lit-grad" cx="50%" cy="52%" r="60%">
          <stop offset="0%" stop-color="#FFF5C0"/>
          <stop offset="55%" stop-color="#F7CA5E"/>
          <stop offset="100%" stop-color="#D9902B"/>
        </radialGradient>
      </defs>
      <!-- Fixed wooden lamp post & wrought-iron arm -->
      <rect x="10" y="10" width="9.5" height="126" rx="1.5" fill="#765B3F" stroke="#362617" stroke-width="1.6"/>
      <rect x="5" y="129" width="20" height="7.5" rx="1.5" fill="#5B442D" stroke="#362617" stroke-width="1.5"/>
      <rect x="13" y="10" width="46" height="6.5" rx="1.5" fill="#8E7253" stroke="#362617" stroke-width="1.5"/>
      <circle cx="15" cy="13.2" r="1.4" fill="#E5BA5C"/>
      <!-- Iron diagonal brace -->
      <path d="M19.5 37 L37 16.5" stroke="#2F2B26" stroke-width="2.8" stroke-linecap="round"/>

      <!-- Realistic Barn Swallow perched on lantern arm; flies with bounding wingbeats when lit -->
      <g class="gd-lantern-bird${sharedLanternLit ? ' is-flying' : ''}" style="transform-origin: 34px 5px;">
        <!-- Far wing (visible in flight) -->
        <g class="gd-bird-wing-far" style="transform-origin: 33px 1px;">
          <path d="M33 1 C29 -10, 21 -18, 13 -15 C18 -9, 24 -4, 30 2 Z" fill="#2E2925" stroke="#1C1815" stroke-width="0.9" stroke-linejoin="round"/>
        </g>

        <!-- Tail (forked swallow tail; tucks down when perched, streams behind in flight) -->
        <g class="gd-bird-tail" style="transform-origin: 25px 3px;">
          <path d="M25 2 L12 6 L18 3.2 L13 0.5 L25 0 Z" fill="#25211D" stroke="#181512" stroke-width="0.8" stroke-linejoin="round"/>
        </g>

        <!-- Delicate legs/claws (visible when perched, tucked in flight) -->
        <g class="gd-bird-legs">
          <path d="M32 5 L31.5 10 M30.5 10 L33 10" stroke="#2D2219" stroke-width="1.2" stroke-linecap="round"/>
          <path d="M36 5 L35.5 10 M34.5 10 L37 10" stroke="#2D2219" stroke-width="1.2" stroke-linecap="round"/>
        </g>

        <!-- Streamlined body & warm rufous breast -->
        <path d="M24 2.5 C26 -3, 33 -5.5, 39 -4.5 C42 -4, 44 -1.5, 42.5 2 C40 5.5, 31 6.5, 24 2.5 Z" fill="#3B3530" stroke="#1E1A17" stroke-width="1" stroke-linejoin="round"/>
        <path d="M33 0.5 C36.5 -2, 41.5 -1.5, 42 1.8 C39.5 4.8, 33.5 5.2, 30 3.2 Z" fill="#C97E4B"/>

        <!-- Head, eye & pointed beak -->
        <g class="gd-bird-head" style="transform-origin: 41px -3px;">
          <path d="M38 -4.5 C38.5 -9, 43.5 -10.5, 46.5 -7.5 C48 -5.8, 47 -2.5, 43 -2 Z" fill="#2F2A26" stroke="#1E1A17" stroke-width="0.95"/>
          <path d="M40.5 -4.2 C42 -5.5, 44.8 -5, 45.2 -3.2 C43.5 -2.2, 41.5 -2.5, 40.5 -4.2 Z" fill="#C97E4B"/>
          <path d="M46.6 -6.8 L51.5 -5.6 L46.4 -4.6 Z" fill="#463E36" stroke="#1E1A17" stroke-width="0.7" stroke-linejoin="round"/>
          <circle cx="44" cy="-6.4" r="1.15" fill="#141210"/>
          <circle cx="44.35" cy="-6.75" r="0.38" fill="#FAF4E6"/>
        </g>

        <!-- Folded wing (perched) -->
        <path class="gd-bird-wing-folded" d="M26 1.5 C30 -2.5, 36 -2.5, 38.5 0.5 C34 2.8, 28 3.2, 22.5 3 Z" fill="#4C433B" stroke="#1E1A17" stroke-width="0.9" stroke-linejoin="round"/>

        <!-- Near sweeping wing (visible in flight) -->
        <g class="gd-bird-wing-near" style="transform-origin: 34px 0px;">
          <path d="M35 0.5 C31 -12, 21 -21, 10 -17 C16 -9.5, 24 -3, 30 2.5 Z" fill="#4C433B" stroke="#1E1A17" stroke-width="0.95" stroke-linejoin="round"/>
          <path d="M15 -14.5 L27 -3.5 M18 -11 L29 -1.5" stroke="#2D2722" stroke-width="0.7" opacity="0.55" stroke-linecap="round"/>
        </g>
      </g>

      <!-- Hanging lantern head (swings independently around pivot 52,16.5) -->
      <g class="gd-lantern-head" style="transform-origin: 52px 16.5px;">
        <line x1="52" y1="16.5" x2="52" y2="29" stroke="#2F2B26" stroke-width="2.5"/>
        <!-- Lantern cap -->
        <path d="M33 36 L71 36 L61.5 27 L42.5 27 Z" fill="#2F2B26"/>
        <rect x="47.5" y="24" width="9" height="3.5" rx="1" fill="#4A443C"/>
        <!-- Lantern glass body -->
        <rect class="gd-lantern-glass" x="36" y="36" width="32" height="40" rx="3" fill="#858176" stroke="#2F2B26" stroke-width="2"/>
        <!-- Mullion bars -->
        <line x1="52" y1="36" x2="52" y2="76" stroke="#2F2B26" stroke-width="1.4" opacity="0.45"/>
        <line x1="36" y1="56" x2="68" y2="56" stroke="#2F2B26" stroke-width="1.4" opacity="0.34"/>
        <rect class="gd-lantern-flame" x="46.5" y="47" width="11" height="18" rx="4" fill="#FFF9DE"/>
        <!-- Lantern base, finial & brass pull-ring -->
        <rect x="33" y="76" width="38" height="6.5" rx="1.5" fill="#2F2B26"/>
        <path d="M46 82.5 L58 82.5 L52 89 Z" fill="#2F2B26"/>
        <g class="gd-lantern-pull">
          <line x1="52" y1="89" x2="52" y2="96" stroke="#C99A49" stroke-width="1.6"/>
          <circle cx="52" cy="98.5" r="2.6" fill="none" stroke="#D9A44E" stroke-width="1.6"/>
        </g>
      </g>
    </svg>
  `;

  const headEl = lanternBtn.querySelector('.gd-lantern-head') as SVGGElement | null;
  let headAngle = 0;
  let headVel = 0;
  let headRaf: number | null = null;

  const stepPendulum = () => {
    if (typeof document !== 'undefined' && !document.contains(lanternBtn)) {
      headRaf = null;
      return;
    }
    // Damped spring pendulum physics
    const accel = -0.14 * headAngle;
    headVel = (headVel + accel) * 0.9;
    headAngle += headVel;
    if (headEl) {
      headEl.style.transform = `rotate(${headAngle.toFixed(2)}deg)`;
    }
    if (Math.abs(headAngle) > 0.05 || Math.abs(headVel) > 0.05) {
      headRaf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(stepPendulum) : null;
    } else {
      if (headEl) headEl.style.transform = 'rotate(0deg)';
      headRaf = null;
    }
  };

  const impulsePendulum = (kick: number) => {
    headVel += kick;
    if (headRaf === null && typeof requestAnimationFrame === 'function') {
      headRaf = requestAnimationFrame(stepPendulum);
    }
  };

  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => syncLanternAmbience());
  }

  attachLanternBirdFlight(lanternBtn);

  lanternBtn.addEventListener('mouseenter', () => {
    impulsePendulum(1.1);
  });

  lanternBtn.addEventListener('click', () => {
    sharedLanternLit = !sharedLanternLit;
    lanternBtn.classList.toggle('is-lit', sharedLanternLit);
    lanternBtn.setAttribute('aria-pressed', sharedLanternLit ? 'true' : 'false');
    lanternBtn.title = sharedLanternLit ? 'Click to extinguish lantern' : 'Click to light lantern';
    syncLanternAmbience();
    impulsePendulum(sharedLanternLit ? 3.2 : -2.4);

    lanternBtn.classList.remove('is-toggled');
    void lanternBtn.offsetWidth;
    lanternBtn.classList.add('is-toggled');
  });
  return lanternBtn;
}

/**
 * Physics-driven bounding flight controller for the lantern bird:
 * - Natural takeoff burst -> smooth wandering figure-8 soaring above the heading
 * - Alternating rapid wingbeat bursts and tucked-wing glides
 * - Smooth return-to-perch deceleration & flare when lantern is extinguished
 */
function attachLanternBirdFlight(lanternBtn: HTMLElement): void {
  const birdEl = lanternBtn.querySelector('.gd-lantern-bird') as SVGGElement | null;
  const nearWing = lanternBtn.querySelector('.gd-bird-wing-near') as SVGGElement | null;
  const farWing = lanternBtn.querySelector('.gd-bird-wing-far') as SVGGElement | null;
  const tailEl = lanternBtn.querySelector('.gd-bird-tail') as SVGGElement | null;
  if (!birdEl || typeof requestAnimationFrame !== 'function') return;

  let x = 0;
  let y = 0;
  let vx = 0;
  let vy = 0;
  let facing = 1;
  let flightClock = 0;
  let wingPhase = 0;
  let lastTs = 0;
  let rafId: number | null = null;
  let swoopTarget: { x: number; y: number; until: number } | null = null;

  const setWingPose = (flapAngle: number, scaleY: number, tailAngle: number) => {
    if (nearWing) {
      nearWing.style.transform = `rotate(${flapAngle.toFixed(1)}deg) scaleY(${scaleY.toFixed(2)})`;
    }
    if (farWing) {
      farWing.style.transform = `rotate(${(flapAngle * 0.85 - 6).toFixed(1)}deg) scaleY(${(scaleY * 0.92).toFixed(2)})`;
    }
    if (tailEl) {
      tailEl.style.transform = `rotate(${tailAngle.toFixed(1)}deg)`;
    }
  };

  const step = (ts: number) => {
    if (typeof document !== 'undefined' && !document.contains(lanternBtn)) {
      rafId = null;
      return;
    }

    const dt = lastTs ? Math.min(0.04, (ts - lastTs) / 1000) : 0.016;
    lastTs = ts;

    const lit = lanternBtn.classList.contains('is-lit');
    const distHome = Math.hypot(x, y);

    if (lit) {
      birdEl.classList.add('is-flying');
      flightClock += dt;

      // Swoop toward clicked Overview letter if active, otherwise soar across the sky
      let tx = 135 + Math.sin(flightClock * 0.78) * 118 + Math.sin(flightClock * 0.34) * 44;
      let ty = -44 + Math.sin(flightClock * 1.32) * 24 + Math.cos(flightClock * 0.62) * 14;
      if (swoopTarget && ts < swoopTarget.until) {
        tx = swoopTarget.x;
        ty = swoopTarget.y;
      } else {
        swoopTarget = null;
      }

      const stiffness = swoopTarget ? 4.4 : 2.1;
      const ax = (tx - x) * stiffness - vx * 1.45;
      const ay = (ty - y) * (stiffness + 0.5) - vy * 1.65;
      vx += ax * dt;
      vy += ay * dt;
      x += vx * dt;
      y += vy * dt;

      if (Math.abs(vx) > 6) {
        facing = vx >= 0 ? 1 : -1;
      }

      // Bounding flight: 1.35s active flapping, 0.75s graceful glide
      const cyclePos = flightClock % 2.1;
      const isGliding = cyclePos > 1.35 && vy > -18;
      if (isGliding) {
        setWingPose(-14, 0.72, 4);
      } else {
        wingPhase += dt * 23;
        const stroke = Math.sin(wingPhase);
        // Asymmetric power downstroke / folded recovery upstroke
        const flapDeg = stroke * 48 - 10;
        const flapScale = 0.68 + stroke * 0.48;
        setWingPose(flapDeg, flapScale, -stroke * 5);
      }

      const pitch = Math.max(-22, Math.min(22, (vy * 0.35) * facing));
      birdEl.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scaleX(${facing}) rotate(${pitch.toFixed(1)}deg)`;
      rafId = requestAnimationFrame(step);
      return;
    }

    // Returning to perch smoothly
    if (distHome > 1.2 || Math.abs(vx) > 2 || Math.abs(vy) > 2) {
      flightClock += dt;
      const ax = -x * 3.8 - vx * 2.7;
      const ay = -y * 4.2 - vy * 2.9;
      vx += ax * dt;
      vy += ay * dt;
      x += vx * dt;
      y += vy * dt;

      if (Math.abs(vx) > 4) {
        facing = vx >= 0 ? 1 : -1;
      } else if (distHome < 18) {
        facing = 1;
      }

      // Flare wings just before landing
      wingPhase += dt * 25;
      const stroke = Math.sin(wingPhase);
      setWingPose(stroke * 38 - 16, 0.72 + stroke * 0.4, 8);
      const pitch = Math.max(-18, Math.min(18, (vy * 0.25) * facing));
      birdEl.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scaleX(${facing}) rotate(${pitch.toFixed(1)}deg)`;
      rafId = requestAnimationFrame(step);
      return;
    }

    // Landed on perch
    x = 0;
    y = 0;
    vx = 0;
    vy = 0;
    facing = 1;
    flightClock = 0;
    birdEl.classList.remove('is-flying');
    birdEl.style.transform = 'translate(0px, 0px) scaleX(1) rotate(0deg)';
    setWingPose(0, 1, 0);
    rafId = null;
    lastTs = 0;
  };

  const ensureRunning = () => {
    if (rafId === null) {
      lastTs = 0;
      rafId = requestAnimationFrame(step);
    }
  };

  if (sharedLanternLit) {
    ensureRunning();
  }

  lanternBtn.addEventListener('click', () => {
    if (lanternBtn.classList.contains('is-lit')) {
      // Natural upward push-off impulse on takeoff
      vy = -52;
      vx = 38;
    }
    ensureRunning();
  });

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    const onSwoop = (ev: Event) => {
      if (!lanternBtn.classList.contains('is-lit') || !document.contains(lanternBtn)) return;
      const detail = (ev as CustomEvent<{ clientX: number; clientY: number }>).detail;
      if (!detail) return;
      const rect = lanternBtn.getBoundingClientRect();
      // Convert viewport coordinates to SVG-local offset relative to perch (34, 5)
      swoopTarget = {
        x: detail.clientX - rect.left - 34,
        y: detail.clientY - rect.top - 14,
        until: performance.now() + 900,
      };
      ensureRunning();
    };
    window.addEventListener('gd-lantern-bird-swoop', onSwoop);
  }
}

/**
 * Ambient drifting pixel fireflies overlay shown softly across the workspace
 * when the header lantern is lit (.gd-lantern-ambience-on).
 */
export function createLanternFirefliesOverlay(): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'gd-lantern-fireflies';
  overlay.setAttribute('aria-hidden', 'true');
  for (let i = 1; i <= 10; i++) {
    const fly = document.createElement('span');
    fly.className = `gd-firefly gd-firefly-${i}`;
    overlay.appendChild(fly);
  }
  return overlay;
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

let sharedHourglassFlowing = false;

/**
 * Shared spring-physics & 3D letter-flip interaction for animated page headings
 * when their companion prop (Overview Lantern or Pending Hourglass) is active.
 */
export function attachInteractiveHeadingSprings(
  titleEl: HTMLElement,
  isActiveFn: () => boolean,
  onLetterClick?: (charRect: DOMRect) => void,
): void {
  const chars = Array.from(titleEl.querySelectorAll('.gd-char')) as HTMLElement[];
  if (!chars.length || typeof requestAnimationFrame !== 'function') return;

  interface CharSpring {
    x: number;
    y: number;
    rot: number;
    flip: number;
    vx: number;
    vy: number;
    vrot: number;
    vflip: number;
    glow: number;
  }

  const states: CharSpring[] = chars.map(() => ({
    x: 0,
    y: 0,
    rot: 0,
    flip: 0,
    vx: 0,
    vy: 0,
    vrot: 0,
    vflip: 0,
    glow: 0,
  }));

  let pointerX: number | null = null;
  let pointerY: number | null = null;
  let lastPointerX: number | null = null;
  let rafId: number | null = null;
  let lastTs = 0;
  let clock = 0;

  const spawnLetterSparks = (ch: HTMLElement) => {
    if (typeof document === 'undefined') return;
    const rect = ch.getBoundingClientRect();
    for (let i = 0; i < 6; i++) {
      const spark = document.createElement('span');
      spark.className = 'gd-heading-spark';
      const angle = (-Math.PI / 2) + (Math.random() - 0.5) * 1.9;
      const speed = 24 + Math.random() * 34;
      spark.style.left = `${rect.left + rect.width * 0.5}px`;
      spark.style.top = `${rect.top + rect.height * 0.45}px`;
      spark.style.setProperty('--sx', `${(Math.cos(angle) * speed).toFixed(1)}px`);
      spark.style.setProperty('--sy', `${(Math.sin(angle) * speed - 12).toFixed(1)}px`);
      document.body.appendChild(spark);
      setTimeout(() => spark.remove(), 750);
    }
  };

  const step = (ts: number) => {
    if (typeof document !== 'undefined' && !document.contains(titleEl)) {
      rafId = null;
      return;
    }

    const dt = lastTs ? Math.min(0.035, (ts - lastTs) / 1000) : 0.016;
    lastTs = ts;
    clock += dt;

    const active = isActiveFn();
    let anyMoving = active;

    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      const s = states[i];

      let targetX = 0;
      let targetY = 0;
      let targetRot = 0;
      let targetGlow = 0;

      if (active) {
        targetY = Math.sin(clock * 2.1 + i * 0.75) * 2.6 - 1.5;
        targetRot = Math.cos(clock * 1.5 + i * 0.9) * 1.8;

        if (pointerX !== null && pointerY !== null) {
          const rect = ch.getBoundingClientRect();
          const cx = rect.left + rect.width * 0.5;
          const cy = rect.top + rect.height * 0.5;
          const dx = cx - pointerX;
          const dy = cy - pointerY;
          const dist = Math.hypot(dx, dy);
          if (dist < 85) {
            const force = 1 - dist / 85;
            targetX += (dx / Math.max(12, dist)) * force * 11;
            targetY += (dy / Math.max(12, dist)) * force * 9 - force * 5;
            targetRot += (dx >= 0 ? 1 : -1) * force * 12;
            targetGlow = force;
          }
        }
      }

      s.vx += ((targetX - s.x) * 140 - s.vx * 11) * dt;
      s.vy += ((targetY - s.y) * 140 - s.vy * 11) * dt;
      s.vrot += ((targetRot - s.rot) * 130 - s.vrot * 10) * dt;
      s.vflip += ((0 - s.flip) * 95 - s.vflip * 9) * dt;

      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.rot += s.vrot * dt;
      s.flip += s.vflip * dt;
      s.glow += (targetGlow - s.glow) * Math.min(1, dt * 12);

      if (
        Math.abs(s.x) > 0.05 || Math.abs(s.y) > 0.05 ||
        Math.abs(s.rot) > 0.05 || Math.abs(s.flip) > 0.2 ||
        Math.abs(s.vx) > 0.1 || Math.abs(s.vy) > 0.1
      ) {
        anyMoving = true;
      }

      ch.style.transform = `translate3d(${s.x.toFixed(2)}px, ${s.y.toFixed(2)}px, 0) rotate(${s.rot.toFixed(2)}deg) rotateY(${s.flip.toFixed(1)}deg)`;
      ch.style.setProperty('--char-glow', s.glow.toFixed(2));
    }

    if (anyMoving) {
      rafId = requestAnimationFrame(step);
    } else {
      for (const ch of chars) {
        ch.style.transform = '';
        ch.style.removeProperty('--char-glow');
      }
      rafId = null;
      lastTs = 0;
    }
  };

  const ensureRunning = () => {
    if (rafId === null) {
      lastTs = 0;
      rafId = requestAnimationFrame(step);
    }
  };

  if (isActiveFn()) {
    ensureRunning();
  }

  titleEl.addEventListener('mousemove', (e: MouseEvent) => {
    if (!isActiveFn()) return;
    pointerX = e.clientX;
    pointerY = e.clientY;
    const vxPointer = lastPointerX !== null ? e.clientX - lastPointerX : 0;
    lastPointerX = e.clientX;

    if (Math.abs(vxPointer) > 2) {
      for (let i = 0; i < chars.length; i++) {
        const rect = chars[i].getBoundingClientRect();
        const dist = Math.hypot(rect.left + rect.width * 0.5 - e.clientX, rect.top + rect.height * 0.5 - e.clientY);
        if (dist < 64) {
          const k = 1 - dist / 64;
          states[i].vx += vxPointer * 1.4 * k;
          states[i].vy -= Math.abs(vxPointer) * 0.6 * k;
          states[i].vrot += vxPointer * 0.9 * k;
        }
      }
    }
    ensureRunning();
  });

  titleEl.addEventListener('mouseleave', () => {
    pointerX = null;
    pointerY = null;
    lastPointerX = null;
  });

  titleEl.addEventListener('click', (e: MouseEvent) => {
    if (!isActiveFn()) return;
    let clickedIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < chars.length; i++) {
      const rect = chars[i].getBoundingClientRect();
      const d = Math.abs(rect.left + rect.width * 0.5 - e.clientX);
      if (d < bestDist) {
        bestDist = d;
        clickedIdx = i;
      }
    }

    for (let i = 0; i < chars.length; i++) {
      const hop = Math.abs(i - clickedIdx);
      const decay = Math.max(0.25, 1 - hop * 0.16);
      states[i].vy -= 140 * decay;
      states[i].vrot += (i < clickedIdx ? -1 : 1) * 160 * decay;
      if (i === clickedIdx) {
        states[i].flip += 360;
        spawnLetterSparks(chars[i]);
      }
    }

    if (onLetterClick) {
      onLetterClick(chars[clickedIdx].getBoundingClientRect());
    }
    ensureRunning();
  });

  if (typeof window !== 'undefined' && typeof MutationObserver === 'function') {
    const appEl = document.querySelector('.gd-dashboard-app');
    const pendingEl = titleEl.closest('.gd-view-section');
    const targets = [appEl, pendingEl].filter(Boolean) as Element[];
    if (targets.length) {
      const obs = new MutationObserver(() => {
        if (!document.contains(titleEl)) {
          obs.disconnect();
          return;
        }
        if (isActiveFn()) {
          for (let i = 0; i < states.length; i++) {
            states[i].vy -= 55 - i * 3;
          }
          ensureRunning();
        }
      });
      for (const t of targets) {
        obs.observe(t, { attributes: true, attributeFilter: ['class'] });
      }
    }
  }
}

/**
 * Articulated Brass & Oak Sand Hourglass placed beside the Pending Approvals heading.
 * Clicking flips it 180° with spring overshoot, starts flowing golden sand,
 * and awakens the Pending Approvals heading characters.
 */
export function createPendingHourglassProp(): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `gd-prop-btn gd-prop-pending-hourglass${sharedHourglassFlowing ? ' is-flowing' : ''}`;
  btn.setAttribute('aria-label', 'Flip decision hourglass');
  btn.setAttribute('aria-pressed', sharedHourglassFlowing ? 'true' : 'false');
  btn.title = sharedHourglassFlowing ? 'Click to pause hourglass' : 'Click to flip hourglass';
  btn.tabIndex = -1;

  btn.innerHTML = `
    <span class="gd-hourglass-aura" aria-hidden="true"></span>
    <svg class="gd-prop-svg" width="64" height="96" viewBox="0 0 64 96" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g class="gd-hourglass-frame" style="transform-origin: 32px 48px;">
        <!-- Turned Oak Top & Bottom Caps -->
        <rect x="11" y="10" width="42" height="7.5" rx="2" fill="#765B3F" stroke="#362617" stroke-width="1.5"/>
        <rect x="14" y="17.5" width="36" height="3.5" rx="1" fill="#A78A68" stroke="#362617" stroke-width="1.1"/>
        <rect x="11" y="78.5" width="42" height="7.5" rx="2" fill="#765B3F" stroke="#362617" stroke-width="1.5"/>
        <rect x="14" y="75" width="36" height="3.5" rx="1" fill="#A78A68" stroke="#362617" stroke-width="1.1"/>

        <!-- Brass Pillars & Finials -->
        <line x1="16.5" y1="21" x2="16.5" y2="75" stroke="#C99A49" stroke-width="2.6"/>
        <line x1="47.5" y1="21" x2="47.5" y2="75" stroke="#C99A49" stroke-width="2.6"/>
        <circle cx="16.5" cy="21" r="2" fill="#E5BA5C" stroke="#5A3F18" stroke-width="0.9"/>
        <circle cx="47.5" cy="21" r="2" fill="#E5BA5C" stroke="#5A3F18" stroke-width="0.9"/>
        <circle cx="16.5" cy="75" r="2" fill="#E5BA5C" stroke="#5A3F18" stroke-width="0.9"/>
        <circle cx="47.5" cy="75" r="2" fill="#E5BA5C" stroke="#5A3F18" stroke-width="0.9"/>

        <!-- Twin Glass Bulbs -->
        <path d="M21 21 C21 37, 29 43.5, 30.5 48 C29 52.5, 21 59, 21 75 L43 75 C43 59, 35 52.5, 33.5 48 C35 43.5, 43 37, 43 21 Z" fill="rgba(248, 244, 232, 0.45)" stroke="#3B3228" stroke-width="1.4"/>

        <!-- Upper & Lower Golden Sand Mounds -->
        <path class="gd-hourglass-sand-top" d="M23.5 31 Q32 34.5 40.5 31 C39.5 39, 34.5 44, 32 47 C29.5 44, 24.5 39, 23.5 31 Z" fill="#E6B856"/>
        <path class="gd-hourglass-sand-bottom" d="M22.5 74 C24 67.5, 28.5 63.5, 32 63.5 C35.5 63.5, 40 67.5, 41.5 74 Z" fill="#D99B38"/>

        <!-- Falling Sand Stream (active when flowing) -->
        <line class="gd-hourglass-stream" x1="32" y1="48" x2="32" y2="65" stroke="#F6CA5E" stroke-width="1.6" stroke-dasharray="2.5 2.5"/>

        <!-- Glass Specular Highlight -->
        <path d="M24 24 C24 34, 28 39, 30 43" stroke="#FFFFFF" stroke-width="1.4" stroke-linecap="round" opacity="0.65"/>
        <path d="M24 71 C24 63, 27 57, 29.5 53" stroke="#FFFFFF" stroke-width="1.2" stroke-linecap="round" opacity="0.5"/>
      </g>
    </svg>
  `;

  const frameEl = btn.querySelector('.gd-hourglass-frame') as SVGGElement | null;
  let targetAngle = sharedHourglassFlowing ? 180 : 0;
  let angle = targetAngle;
  let vel = 0;
  let rafId: number | null = null;

  const syncSectionClass = () => {
    const viewEl = btn.closest('#view-pending');
    if (viewEl) {
      viewEl.classList.toggle('gd-pending-hourglass-on', sharedHourglassFlowing);
    }
  };

  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(syncSectionClass);
  }

  const stepSpin = () => {
    if (typeof document !== 'undefined' && !document.contains(btn)) {
      rafId = null;
      return;
    }
    const accel = (targetAngle - angle) * 0.14;
    vel = (vel + accel) * 0.82;
    angle += vel;
    if (frameEl) {
      frameEl.style.transform = `rotate(${angle.toFixed(2)}deg)`;
    }
    if (Math.abs(targetAngle - angle) > 0.25 || Math.abs(vel) > 0.25) {
      rafId = requestAnimationFrame(stepSpin);
    } else {
      angle = targetAngle;
      vel = 0;
      if (frameEl) frameEl.style.transform = `rotate(${targetAngle}deg)`;
      rafId = null;
    }
  };

  btn.addEventListener('click', () => {
    sharedHourglassFlowing = !sharedHourglassFlowing;
    targetAngle += 180;
    btn.classList.toggle('is-flowing', sharedHourglassFlowing);
    btn.setAttribute('aria-pressed', sharedHourglassFlowing ? 'true' : 'false');
    btn.title = sharedHourglassFlowing ? 'Click to pause hourglass' : 'Click to flip hourglass';
    syncSectionClass();
    if (rafId === null && typeof requestAnimationFrame === 'function') {
      rafId = requestAnimationFrame(stepSpin);
    }
  });

  return btn;
}

/**
 * Watchful Barn Owl perched on top of the Pending Approvals detail or empty-state frame.
 * - Head smoothly tracks the user's pointer across Pending Approvals.
 * - Leans attentively when hovering Approve / Reject.
 * - Click spreads its wings and performs a brief physics-driven swoop arc.
 */
export function createPendingOwlProp(): HTMLElement {
  const owlBtn = document.createElement('button');
  owlBtn.type = 'button';
  owlBtn.className = 'gd-prop-btn gd-prop-pending-owl';
  owlBtn.setAttribute('aria-label', 'Interact with watchful barn owl');
  owlBtn.title = 'Click the watchful owl';
  owlBtn.tabIndex = -1;

  const notes = ['Eyes on it', 'Take your time', 'Verify destination', 'Staying sharp'];
  let noteIdx = 0;
  let noteTimer: ReturnType<typeof setTimeout> | null = null;

  owlBtn.innerHTML = `
    <span class="gd-owl-note" aria-hidden="true"></span>
    <svg class="gd-prop-svg" width="74" height="72" viewBox="0 0 74 72" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g class="gd-owl-body" style="transform-origin: 37px 62px;">
        <!-- Spread Wings (visible during click swoop) -->
        <g class="gd-owl-wing-left" style="transform-origin: 28px 36px;">
          <path d="M29 36 C16 28, 5 30, 2 39 C10 43, 19 45, 28 44 Z" fill="#8C6B4E" stroke="#2D2219" stroke-width="1.1" stroke-linejoin="round"/>
        </g>
        <g class="gd-owl-wing-right" style="transform-origin: 46px 36px;">
          <path d="M45 36 C58 28, 69 30, 72 39 C64 43, 55 45, 46 44 Z" fill="#8C6B4E" stroke="#2D2219" stroke-width="1.1" stroke-linejoin="round"/>
        </g>

        <!-- Tail feathers -->
        <path d="M31 55 L28 65 L37 63 L46 65 L43 55 Z" fill="#6F533B" stroke="#2D2219" stroke-width="1" stroke-linejoin="round"/>

        <!-- Torso & speckled cream breast -->
        <path d="M25 32 C23 44, 26 57, 37 58 C48 57, 51 44, 49 32 C46 27, 28 27, 25 32 Z" fill="#9E7958" stroke="#2D2219" stroke-width="1.15"/>
        <path d="M29.5 34 C28 43, 30 53, 37 54.5 C44 53, 46 43, 44.5 34 Z" fill="#F2EAD9"/>
        <circle cx="34" cy="41" r="0.9" fill="#7D5E44" opacity="0.65"/>
        <circle cx="40" cy="43" r="0.9" fill="#7D5E44" opacity="0.65"/>
        <circle cx="36.5" cy="48" r="0.9" fill="#7D5E44" opacity="0.65"/>

        <!-- Folded wings (perched) -->
        <path class="gd-owl-wing-folded" d="M25 33 C22 42, 24 52, 29 55 C30 48, 30 39, 28 33 Z" fill="#7D5D42" stroke="#2D2219" stroke-width="1"/>
        <path class="gd-owl-wing-folded" d="M49 33 C52 42, 50 52, 45 55 C44 48, 44 39, 46 33 Z" fill="#7D5D42" stroke="#2D2219" stroke-width="1"/>

        <!-- Talons gripping frame -->
        <g class="gd-owl-talons">
          <path d="M32 57 L31 64 M29.5 64 L33 64" stroke="#C99A49" stroke-width="1.6" stroke-linecap="round"/>
          <path d="M42 57 L43 64 M41 64 L44.5 64" stroke="#C99A49" stroke-width="1.6" stroke-linecap="round"/>
        </g>

        <!-- Articulated Barn Owl Head (tracks cursor) -->
        <g class="gd-owl-head" style="transform-origin: 37px 26px;">
          <path d="M23 22 C23 11, 51 11, 51 22 C51 31, 44 35, 37 35 C30 35, 23 31, 23 22 Z" fill="#A68160" stroke="#2D2219" stroke-width="1.15"/>
          <!-- Heart-shaped facial disc -->
          <path d="M26 21 C26 14.5, 34.5 14.5, 37 18.5 C39.5 14.5, 48 14.5, 48 21 C48 28, 41 32, 37 32.5 C33 32, 26 28, 26 21 Z" fill="#F7F1E5" stroke="#8C6849" stroke-width="0.9"/>
          <!-- Expressive dark eyes + catchlights -->
          <circle cx="32" cy="22" r="2.3" fill="#1B1612"/>
          <circle cx="42" cy="22" r="2.3" fill="#1B1612"/>
          <circle cx="32.7" cy="21.2" r="0.7" fill="#FFFFFF"/>
          <circle cx="42.7" cy="21.2" r="0.7" fill="#FFFFFF"/>
          <!-- Animated blink eyelids -->
          <rect class="gd-owl-eyelid" x="29.4" y="19.5" width="5.2" height="5" rx="2" fill="#E8DEC8"/>
          <rect class="gd-owl-eyelid" x="39.4" y="19.5" width="5.2" height="5" rx="2" fill="#E8DEC8"/>
          <!-- Small hooked beak -->
          <path d="M35.5 24 L38.5 24 L37 28 Z" fill="#D4A458" stroke="#5A3F18" stroke-width="0.7" stroke-linejoin="round"/>
        </g>
      </g>
    </svg>
  `;

  const headEl = owlBtn.querySelector('.gd-owl-head') as SVGGElement | null;
  const bodyEl = owlBtn.querySelector('.gd-owl-body') as SVGGElement | null;
  const noteBubble = owlBtn.querySelector('.gd-owl-note') as HTMLElement | null;

  let headRot = 0;
  let targetHeadRot = 0;
  let headX = 0;
  let targetHeadX = 0;
  let swoopY = 0;
  let swoopVelY = 0;
  let swoopClock = -1;
  let rafId: number | null = null;

  const stepOwl = () => {
    if (typeof document !== 'undefined' && !document.contains(owlBtn)) {
      rafId = null;
      return;
    }

    headRot += (targetHeadRot - headRot) * 0.16;
    headX += (targetHeadX - headX) * 0.16;

    if (headEl) {
      headEl.style.transform = `translateX(${headX.toFixed(2)}px) rotate(${headRot.toFixed(2)}deg)`;
    }

    if (swoopClock >= 0) {
      swoopClock += 0.016;
      const accelY = (0 - swoopY) * 0.12;
      swoopVelY = (swoopVelY + accelY) * 0.86;
      swoopY += swoopVelY;
      if (bodyEl) {
        bodyEl.style.transform = `translateY(${swoopY.toFixed(2)}px)`;
      }
      if (swoopClock > 0.75 && Math.abs(swoopY) < 0.3 && Math.abs(swoopVelY) < 0.3) {
        swoopClock = -1;
        swoopY = 0;
        swoopVelY = 0;
        owlBtn.classList.remove('is-swooping');
        if (bodyEl) bodyEl.style.transform = '';
      }
    }

    const moving =
      Math.abs(targetHeadRot - headRot) > 0.1 ||
      Math.abs(targetHeadX - headX) > 0.05 ||
      swoopClock >= 0;

    if (moving && typeof requestAnimationFrame === 'function') {
      rafId = requestAnimationFrame(stepOwl);
    } else {
      rafId = null;
    }
  };

  const ensureRunning = () => {
    if (rafId === null && typeof requestAnimationFrame === 'function') {
      rafId = requestAnimationFrame(stepOwl);
    }
  };

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    const onMove = (e: MouseEvent) => {
      if (!document.contains(owlBtn)) {
        window.removeEventListener('mousemove', onMove);
        return;
      }
      const rect = owlBtn.getBoundingClientRect();
      const ox = rect.left + rect.width * 0.5;
      const oy = rect.top + rect.height * 0.35;
      const dx = e.clientX - ox;
      const dy = e.clientY - oy;
      targetHeadRot = Math.max(-16, Math.min(16, dx * 0.035));
      targetHeadX = Math.max(-2.5, Math.min(2.5, dx * 0.008));
      if (dy > 140) targetHeadRot *= 0.7;
      ensureRunning();
    };
    window.addEventListener('mousemove', onMove, { passive: true });
  }

  owlBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    swoopClock = 0;
    swoopVelY = -5.4;
    owlBtn.classList.add('is-swooping');
    ensureRunning();

    if (noteBubble) {
      noteBubble.textContent = notes[noteIdx % notes.length];
      noteIdx += 1;
      noteBubble.classList.add('is-visible');
      if (noteTimer) clearTimeout(noteTimer);
      noteTimer = setTimeout(() => {
        noteBubble.classList.remove('is-visible');
      }, 1500);
    }
  });

  return owlBtn;
}
