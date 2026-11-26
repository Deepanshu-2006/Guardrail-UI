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
