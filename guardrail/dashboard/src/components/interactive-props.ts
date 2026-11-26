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

let sharedHourglassAngle = 0;
let sharedBulbASand = 0; // 0..1 fraction of sand in Bulb A (y=21..52); Bulb B holds (1 - sharedBulbASand)

/**
 * Shared spring-physics & 3D letter-flip interaction for animated page headings
 * when their companion prop (Overview Lantern or Pending Hourglass) is active.
 */
export function attachInteractiveHeadingSprings(
  titleEl: HTMLElement,
  isActiveFn: () => boolean,
  onLetterClick?: (charRect: DOMRect) => void,
  mode: 'thermal' | 'wind-banner' = 'thermal',
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
        if (mode === 'wind-banner') {
          const t = i / Math.max(1, chars.length - 1);
          const loose = Math.pow(t, 1.15);
          const gustStrength = 0.85 + Math.sin(clock * 2.4) * 0.35 + Math.sin(clock * 5.8) * 0.18;
          const wave = Math.sin(clock * 8.2 - i * 0.44);
          const waveDeriv = Math.cos(clock * 8.2 - i * 0.44);

          // Left end ('P') stays pinned; right end ('s') whips & streams loosely in the wind like a ribbon
          targetX = loose * (14 + gustStrength * 14) + wave * loose * 4.5;
          targetY = -loose * (8 + gustStrength * 10) + wave * loose * (11 + gustStrength * 6);
          targetRot = loose * 6 + waveDeriv * loose * (13 + gustStrength * 8);
        } else {
          targetY = Math.sin(clock * 2.1 + i * 0.75) * 2.6 - 1.5;
          targetRot = Math.cos(clock * 1.5 + i * 0.9) * 1.8;
        }

        if (pointerX !== null && pointerY !== null) {
          const rect = ch.getBoundingClientRect();
          const cx = rect.left + rect.width * 0.5;
          const cy = rect.top + rect.height * 0.5;
          const dx = cx - pointerX;
          const dy = cy - pointerY;
          const dist = Math.hypot(dx, dy);
          if (dist < 85) {
            const pinScale = mode === 'wind-banner' ? (0.15 + 0.85 * Math.pow(i / Math.max(1, chars.length - 1), 1.1)) : 1;
            const force = (1 - dist / 85) * pinScale;
            targetX += (dx / Math.max(12, dist)) * force * 11;
            targetY += (dy / Math.max(12, dist)) * force * 9 - force * 5;
            targetRot += (dx >= 0 ? 1 : -1) * force * 12;
            targetGlow = force;
          }
        }
      }

      const kSpring = active ? 140 : 220;
      const kDamp = active ? 11 : 16;
      s.vx += ((targetX - s.x) * kSpring - s.vx * kDamp) * dt;
      s.vy += ((targetY - s.y) * kSpring - s.vy * kDamp) * dt;
      s.vrot += ((targetRot - s.rot) * (active ? 130 : 210) - s.vrot * (active ? 10 : 15)) * dt;
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

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function' && mode === 'wind-banner') {
    const onFlipOrSync = (ev: Event) => {
      if (!document.contains(titleEl)) return;
      if (ev.type === 'gd-hourglass-flip') {
        for (let i = 0; i < states.length; i++) {
          const loose = Math.pow(i / Math.max(1, states.length - 1), 1.2);
          states[i].vx += 95 * loose;
          states[i].vy -= 75 * loose;
          states[i].vrot += 90 * loose;
        }
      }
      if (isActiveFn() || ev.type === 'gd-hourglass-flip') {
        ensureRunning();
      }
    };
    window.addEventListener('gd-hourglass-flip', onFlipOrSync);
    window.addEventListener('gd-pending-storm-sync', onFlipOrSync);
  }

  if (typeof window !== 'undefined' && typeof MutationObserver === 'function') {
    requestAnimationFrame(() => {
      if (!document.contains(titleEl)) return;
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
              states[i].vy -= 55 - i * 2;
            }
            ensureRunning();
          }
        });
        for (const t of targets) {
          obs.observe(t, { attributes: true, attributeFilter: ['class'] });
        }
        if (isActiveFn()) ensureRunning();
      }
    });
  }
}

/**
 * Realistic Gimbal-Mounted Brass & Walnut Sand Hourglass beside Pending Approvals.
 * - Stationary oak & brass cradle stand with trunnion pins; ONLY the inner glass
 *   and brass frame pivots 180° inside the cradle with weighted inertia.
 * - Real gravity-aware sand simulation:
 *   - Top bulb drains as an angle-of-repose V-funnel crater.
 *   - Fine tapered golden stream + 22 micro-grains accelerate under gravity and
 *     disperse at the lower cone apex.
 *   - Lower bulb builds a realistic conical mound; mid-pour flips swap remaining
 *     volumes naturally.
 */
export function createPendingHourglassProp(): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `gd-prop-btn gd-prop-pending-hourglass`;
  btn.setAttribute('aria-label', 'Flip decision hourglass');
  btn.setAttribute('aria-pressed', 'false');
  btn.title = 'Click to flip hourglass';
  btn.tabIndex = -1;

  const grainMarkup = Array.from({ length: 28 }, (_, i) => {
    const colors = ['#FFF6C8', '#F6C95E', '#D99934', '#FFE999'];
    const r = (0.45 + (i % 3) * 0.16).toFixed(2);
    return `<circle class="gd-hg-grain" cx="38" cy="52" r="${r}" fill="${colors[i % colors.length]}" opacity="0"/>`;
  }).join('');

  const avalancheMarkup = Array.from({ length: 10 }, (_, i) => {
    const colors = ['#FFF2B8', '#E5B148', '#FFE388'];
    return `<circle class="gd-hg-avalanche" cx="38" cy="80" r="0.55" fill="${colors[i % colors.length]}" opacity="0"/>`;
  }).join('');

  btn.innerHTML = `
    <span class="gd-hourglass-aura" aria-hidden="true"></span>
    <span class="gd-hourglass-motes" aria-hidden="true">
      <span class="gd-hg-mote gd-hg-mote-1"></span>
      <span class="gd-hg-mote gd-hg-mote-2"></span>
      <span class="gd-hg-mote gd-hg-mote-3"></span>
      <span class="gd-hg-mote gd-hg-mote-4"></span>
      <span class="gd-hg-mote gd-hg-mote-5"></span>
    </span>
    <svg class="gd-prop-svg" width="76" height="108" viewBox="0 0 76 108" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="gd-hg-wood" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#4A331F"/>
          <stop offset="28%" stop-color="#876645"/>
          <stop offset="65%" stop-color="#6B4E33"/>
          <stop offset="100%" stop-color="#3E2A18"/>
        </linearGradient>
        <linearGradient id="gd-hg-brass" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#7D581D"/>
          <stop offset="35%" stop-color="#F2D47E"/>
          <stop offset="68%" stop-color="#C7943B"/>
          <stop offset="100%" stop-color="#6F4C16"/>
        </linearGradient>
        <linearGradient id="gd-hg-glass" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="rgba(255,255,255,0.46)"/>
          <stop offset="25%" stop-color="rgba(248,244,234,0.12)"/>
          <stop offset="78%" stop-color="rgba(212,224,216,0.22)"/>
          <stop offset="100%" stop-color="rgba(255,255,255,0.52)"/>
        </linearGradient>
        <linearGradient id="gd-hg-sand" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#FCE28B"/>
          <stop offset="48%" stop-color="#E5B148"/>
          <stop offset="100%" stop-color="#B97B22"/>
        </linearGradient>
        <pattern id="gd-hg-sand-texture" width="5" height="5" patternUnits="userSpaceOnUse">
          <circle cx="1.2" cy="1.3" r="0.55" fill="#FFF3BD" opacity="0.48"/>
          <circle cx="3.8" cy="2.1" r="0.5" fill="#9E6214" opacity="0.34"/>
          <circle cx="2.4" cy="4.1" r="0.5" fill="#FFE07D" opacity="0.4"/>
          <circle cx="4.3" cy="4.4" r="0.4" fill="#8C5410" opacity="0.28"/>
        </pattern>
        <linearGradient id="gd-hg-stream-grad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#FFF5C4" stop-opacity="0.98"/>
          <stop offset="55%" stop-color="#F2C052" stop-opacity="0.9"/>
          <stop offset="100%" stop-color="#D99830" stop-opacity="0.65"/>
        </linearGradient>
        <clipPath id="gd-hg-bulb-top">
          <path d="M25 21 C25 38, 34 45.5, 36.6 52 L39.4 52 C42 45.5, 51 38, 51 21 Z"/>
        </clipPath>
        <clipPath id="gd-hg-bulb-bottom">
          <path d="M36.6 52 C34 58.5, 25 66, 25 83 L51 83 C51 66, 42 58.5, 39.4 52 Z"/>
        </clipPath>
      </defs>

      <!-- Stationary Desk Cradle Stand (stays planted while inner hourglass pivots) -->
      <ellipse cx="38" cy="100" rx="24" ry="3.2" fill="rgba(28, 20, 12, 0.22)"/>
      <rect x="14" y="92" width="48" height="7" rx="2.5" fill="url(#gd-hg-wood)" stroke="#2A1C10" stroke-width="1.3"/>
      <rect x="19" y="89.5" width="38" height="2.8" rx="1" fill="url(#gd-hg-brass)" stroke="#4F3714" stroke-width="0.8"/>
      <!-- Cradle Uprights & Trunnion Pivot Pins -->
      <path d="M18 90 C14 78, 13 62, 16 52" fill="none" stroke="url(#gd-hg-brass)" stroke-width="2.6" stroke-linecap="round"/>
      <path d="M58 90 C62 78, 63 62, 60 52" fill="none" stroke="url(#gd-hg-brass)" stroke-width="2.6" stroke-linecap="round"/>
      <circle cx="16.2" cy="52" r="2.6" fill="#E8C266" stroke="#4F3714" stroke-width="0.9"/>
      <circle cx="59.8" cy="52" r="2.6" fill="#E8C266" stroke="#4F3714" stroke-width="0.9"/>

      <!-- Pivoting Inner Brass & Glass Assembly (rotates around trunnion center 38,52) -->
      <g class="gd-hourglass-frame" style="transform-origin: 38px 52px;">
        <!-- Turned Walnut Top & Bottom End Plates -->
        <rect x="17" y="10" width="42" height="6.5" rx="2" fill="url(#gd-hg-wood)" stroke="#2E1F12" stroke-width="1.25"/>
        <rect x="19.5" y="16.5" width="37" height="3.2" rx="1" fill="url(#gd-hg-brass)" stroke="#4F3714" stroke-width="0.9"/>
        <rect x="17" y="87.5" width="42" height="6.5" rx="2" fill="url(#gd-hg-wood)" stroke="#2E1F12" stroke-width="1.25"/>
        <rect x="19.5" y="84.3" width="37" height="3.2" rx="1" fill="url(#gd-hg-brass)" stroke="#4F3714" stroke-width="0.9"/>

        <!-- Inner Brass Rods + Central Trunnion Band -->
        <rect x="20.5" y="19.7" width="2.4" height="64.6" rx="1" fill="url(#gd-hg-brass)" stroke="#5A3F18" stroke-width="0.6"/>
        <rect x="53.1" y="19.7" width="2.4" height="64.6" rx="1" fill="url(#gd-hg-brass)" stroke="#5A3F18" stroke-width="0.6"/>
        <line x1="16.5" y1="52" x2="21" y2="52" stroke="#C7943B" stroke-width="2"/>
        <line x1="55" y1="52" x2="59.5" y2="52" stroke="#C7943B" stroke-width="2"/>

        <!-- Twin Glass Bulbs -->
        <path d="M25 21 C25 38, 34 45.5, 36.6 52 C34 58.5, 25 66, 25 83 L51 83 C51 66, 42 58.5, 39.4 52 C42 45.5, 51 38, 51 21 Z" fill="url(#gd-hg-glass)" stroke="#383028" stroke-width="1.25"/>

        <!-- Gravity-Leveled Granular Sand in Top & Bottom Bulbs -->
        <g clip-path="url(#gd-hg-bulb-top)">
          <path class="gd-hg-sand-top" d="M23 52 L53 52 L53 52 L23 52 Z" fill="url(#gd-hg-sand)"/>
          <path class="gd-hg-sand-top-tex" d="" fill="url(#gd-hg-sand-texture)"/>
          <path class="gd-hg-sand-top-rim" d="" fill="rgba(255, 245, 198, 0.5)"/>
        </g>
        <g clip-path="url(#gd-hg-bulb-bottom)">
          <path class="gd-hg-sand-bottom" d="M23 83 L53 83 L53 83 L23 83 Z" fill="url(#gd-hg-sand)"/>
          <path class="gd-hg-sand-bottom-tex" d="" fill="url(#gd-hg-sand-texture)"/>
          <path class="gd-hg-sand-bottom-rim" d="" fill="rgba(255, 245, 198, 0.44)"/>
        </g>

        <!-- Fine Tapered Sand Stream + 28 Accelerating Grains + Cone Avalanche -->
        <g class="gd-hg-stream-group" opacity="0">
          <path class="gd-hg-stream-line" d="M37.4 52 L38.6 52 L38.2 82 L37.8 82 Z" fill="url(#gd-hg-stream-grad)"/>
          <circle class="gd-hg-impact-glow" cx="38" cy="70" r="2.2" fill="#FFF3B8" opacity="0.65"/>
          ${grainMarkup}
          ${avalancheMarkup}
        </g>

        <!-- Brass Waist Collar -->
        <rect x="33.5" y="50.3" width="9" height="3.4" rx="1.4" fill="url(#gd-hg-brass)" stroke="#4F3714" stroke-width="0.7"/>

        <!-- Crisp Curved Glass Reflections -->
        <path d="M27.5 24 C27.5 35, 32 41, 34.4 46" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" opacity="0.68"/>
        <path d="M27.5 80 C27.5 70, 31.5 63, 34 58" stroke="#FFFFFF" stroke-width="1.2" stroke-linecap="round" opacity="0.5"/>
        <path d="M48 26 C48 34, 45 39, 43 43" stroke="#FFFFFF" stroke-width="0.85" stroke-linecap="round" opacity="0.32"/>
      </g>
    </svg>
  `;

  const frameEl = btn.querySelector('.gd-hourglass-frame') as SVGGElement | null;
  const topSandEl = btn.querySelector('.gd-hg-sand-top') as SVGPathElement | null;
  const topTexEl = btn.querySelector('.gd-hg-sand-top-tex') as SVGPathElement | null;
  const topRimEl = btn.querySelector('.gd-hg-sand-top-rim') as SVGPathElement | null;
  const bottomSandEl = btn.querySelector('.gd-hg-sand-bottom') as SVGPathElement | null;
  const bottomTexEl = btn.querySelector('.gd-hg-sand-bottom-tex') as SVGPathElement | null;
  const bottomRimEl = btn.querySelector('.gd-hg-sand-bottom-rim') as SVGPathElement | null;
  const streamGroupEl = btn.querySelector('.gd-hg-stream-group') as SVGGElement | null;
  const streamLineEl = btn.querySelector('.gd-hg-stream-line') as SVGPathElement | null;
  const impactGlowEl = btn.querySelector('.gd-hg-impact-glow') as SVGCircleElement | null;
  const grainEls = Array.from(btn.querySelectorAll('.gd-hg-grain')) as SVGCircleElement[];
  const avalancheEls = Array.from(btn.querySelectorAll('.gd-hg-avalanche')) as SVGCircleElement[];

  let targetAngle = sharedHourglassAngle;
  let angle = sharedHourglassAngle;
  let angVel = 0;
  let bulbASand = sharedBulbASand; // 0..1 in Bulb A (top in SVG), (1 - bulbASand) in Bulb B (bottom in SVG)
  let grainClock = 0;
  let lastTs = 0;
  let rafId: number | null = null;

  const syncSectionClass = (flowing: boolean) => {
    btn.classList.toggle('is-flowing', flowing);
    btn.setAttribute('aria-pressed', flowing ? 'true' : 'false');
    const viewEl = btn.closest('#view-pending');
    if (viewEl) {
      viewEl.classList.toggle('gd-pending-hourglass-on', flowing);
    }
    if (typeof document !== 'undefined') {
      const appEl = document.querySelector('.gd-dashboard-app');
      if (appEl) {
        const isPendingMounted = Boolean(viewEl && document.contains(viewEl));
        appEl.classList.toggle('gd-pending-sandstorm-on', flowing && isPendingMounted);
      }
    }
    if (flowing && typeof window !== 'undefined' && typeof CustomEvent === 'function') {
      window.dispatchEvent(new CustomEvent('gd-pending-storm-sync'));
    }
  };

  const renderSandGeometry = (flippedOdd: boolean, pouring: boolean, tiltDeg: number) => {
    const bulbBSand = 1 - bulbASand;
    // Gravity-surface slosh during rotation
    const slosh = Math.max(-7, Math.min(7, Math.sin((tiltDeg * Math.PI) / 180) * 11));

    // Bulb A (SVG y=21..52): physically DOWN when flippedOdd, physically UP when !flippedOdd
    if (topSandEl && topTexEl && topRimEl) {
      if (flippedOdd) {
        const h = Math.max(0, bulbASand * 25.5);
        const yEdge = 21 + h;
        const apex = Math.min(51.5, yEdge + 6.5 * Math.sin(bulbASand * Math.PI));
        const d = `M22 21 L54 21 L54 ${(yEdge + slosh).toFixed(1)} Q38 ${apex.toFixed(1)} 22 ${(yEdge - slosh).toFixed(1)} Z`;
        topSandEl.setAttribute('d', d);
        topTexEl.setAttribute('d', d);
        topRimEl.setAttribute(
          'd',
          bulbASand > 0.03
            ? `M22 ${(yEdge - slosh).toFixed(1)} Q38 ${apex.toFixed(1)} 54 ${(yEdge + slosh).toFixed(1)} L54 ${(yEdge + slosh - 1.6).toFixed(1)} Q38 ${(apex - 1.6).toFixed(1)} 22 ${(yEdge - slosh - 1.6).toFixed(1)} Z`
            : '',
        );
      } else {
        const h = Math.max(0, bulbASand * 26.5);
        const yEdge = 52 - h;
        const funnel = Math.min(52, yEdge + (pouring ? 6.8 : 1.0));
        const d = `M22 ${(yEdge - slosh).toFixed(1)} L38 ${funnel.toFixed(1)} L54 ${(yEdge + slosh).toFixed(1)} L54 52 L22 52 Z`;
        topSandEl.setAttribute('d', d);
        topTexEl.setAttribute('d', d);
        topRimEl.setAttribute(
          'd',
          bulbASand > 0.03
            ? `M22 ${(yEdge - slosh).toFixed(1)} L38 ${funnel.toFixed(1)} L54 ${(yEdge + slosh).toFixed(1)} L54 ${(yEdge + slosh + 1.5).toFixed(1)} L38 ${(funnel + 1.5).toFixed(1)} L22 ${(yEdge - slosh + 1.5).toFixed(1)} Z`
            : '',
        );
      }
    }

    // Bulb B (SVG y=52..83): physically UP when flippedOdd, physically DOWN when !flippedOdd
    if (bottomSandEl && bottomTexEl && bottomRimEl) {
      if (flippedOdd) {
        const h = Math.max(0, bulbBSand * 26.5);
        const yEdge = 52 + h;
        const funnel = Math.max(52, yEdge - (pouring ? 6.8 : 1.0));
        const d = `M22 52 L54 52 L54 ${(yEdge + slosh).toFixed(1)} L38 ${funnel.toFixed(1)} L22 ${(yEdge - slosh).toFixed(1)} Z`;
        bottomSandEl.setAttribute('d', d);
        bottomTexEl.setAttribute('d', d);
        bottomRimEl.setAttribute(
          'd',
          bulbBSand > 0.03
            ? `M22 ${(yEdge - slosh).toFixed(1)} L38 ${funnel.toFixed(1)} L54 ${(yEdge + slosh).toFixed(1)} L54 ${(yEdge + slosh - 1.5).toFixed(1)} L38 ${(funnel - 1.5).toFixed(1)} L22 ${(yEdge - slosh - 1.5).toFixed(1)} Z`
            : '',
        );
      } else {
        const h = Math.max(0, bulbBSand * 25.5);
        const yEdge = 83 - h;
        const apex = Math.max(52.5, yEdge - 6.5 * Math.sin(bulbBSand * Math.PI));
        const d = `M22 ${(yEdge - slosh).toFixed(1)} Q38 ${apex.toFixed(1)} 54 ${(yEdge + slosh).toFixed(1)} L54 83 L22 83 Z`;
        bottomSandEl.setAttribute('d', d);
        bottomTexEl.setAttribute('d', d);
        bottomRimEl.setAttribute(
          'd',
          bulbBSand > 0.03
            ? `M22 ${(yEdge - slosh).toFixed(1)} Q38 ${apex.toFixed(1)} 54 ${(yEdge + slosh).toFixed(1)} L54 ${(yEdge + slosh + 1.6).toFixed(1)} Q38 ${(apex + 1.6).toFixed(1)} 22 ${(yEdge - slosh + 1.6).toFixed(1)} Z`
            : '',
        );
      }
    }

    if (streamGroupEl && streamLineEl) {
      streamGroupEl.setAttribute('opacity', pouring ? '1' : '0');
      if (pouring) {
        const pileApexY = flippedOdd
          ? Math.min(51.5, 21 + Math.max(0, bulbASand * 25.5) + 6.5 * Math.sin(bulbASand * Math.PI))
          : Math.max(52.5, 83 - Math.max(0, bulbBSand * 25.5) - 6.5 * Math.sin(bulbBSand * Math.PI));
        const dir = flippedOdd ? -1 : 1;
        const yStart = 52;
        const yEnd = pileApexY;
        const flutter = Math.sin(grainClock * 26) * 0.28;
        streamLineEl.setAttribute(
          'd',
          `M37.1 ${yStart} L38.9 ${yStart} L${(38.45 + flutter).toFixed(2)} ${yEnd.toFixed(1)} L${(37.55 + flutter).toFixed(2)} ${yEnd.toFixed(1)} Z`,
        );

        if (impactGlowEl) {
          impactGlowEl.setAttribute('cy', yEnd.toFixed(1));
          impactGlowEl.setAttribute('r', (1.9 + Math.sin(grainClock * 19) * 0.45).toFixed(2));
        }

        const totalSpan = Math.abs(yEnd - yStart);
        grainEls.forEach((g, idx) => {
          const p = (grainClock * 1.55 + idx / grainEls.length) % 1;
          const fallDist = totalSpan * (0.2 * p + 0.8 * p * p);
          const gy = yStart + dir * fallDist;
          const splash = p > 0.8 ? ((idx % 2 === 0 ? 1 : -1) * (p - 0.8) * 18) : 0;
          const gx = 38 + Math.sin(p * 18 + idx * 2.1) * 0.85 + splash;
          const alpha = p > 0.9 ? (1 - p) * 10 : 0.9;
          g.setAttribute('cx', gx.toFixed(2));
          g.setAttribute('cy', gy.toFixed(2));
          g.setAttribute('opacity', Math.max(0, alpha).toFixed(2));
        });

        // Avalanche grains sliding down both sides of the lower cone after impact
        avalancheEls.forEach((av, idx) => {
          const p = (grainClock * 1.2 + idx / avalancheEls.length) % 1;
          const side = idx % 2 === 0 ? 1 : -1;
          const slideX = 38 + side * (1.2 + p * 10.5);
          const slideY = yEnd - dir * (p * 5.2) + Math.sin(p * 14 + idx) * 0.35;
          const alpha = (1 - p) * 0.85;
          av.setAttribute('cx', slideX.toFixed(2));
          av.setAttribute('cy', slideY.toFixed(2));
          av.setAttribute('opacity', Math.max(0, alpha).toFixed(2));
        });
      }
    }
  };

  const step = (ts: number) => {
    if (typeof document !== 'undefined' && !document.contains(btn)) {
      rafId = null;
      return;
    }

    const dt = lastTs ? Math.min(0.035, (ts - lastTs) / 1000) : 0.016;
    lastTs = ts;

    // Crisp, weighted brass trunnion pivot physics (settles cleanly without wild overshoot)
    const angAccel = (targetAngle - angle) * 0.22;
    angVel = (angVel + angAccel) * 0.75;
    angle += angVel;
    if (frameEl) {
      frameEl.style.transform = `rotate(${angle.toFixed(2)}deg)`;
    }

    const angleDiff = targetAngle - angle;
    const absDiff = Math.abs(angleDiff);
    const flippedOdd = (Math.round(targetAngle / 180) % 2) !== 0;
    const upperSand = flippedOdd ? 1 - bulbASand : bulbASand;

    // Start pouring immediately as the glass passes horizontal (< 105 deg from target)
    const pouring = upperSand > 0.002 && absDiff < 105;
    if (pouring) {
      const drain = dt / 22; // 22-second realistic pour
      bulbASand = flippedOdd
        ? Math.min(1, bulbASand + drain)
        : Math.max(0, bulbASand - drain);
      sharedBulbASand = bulbASand;
      grainClock += dt;
    }

    renderSandGeometry(flippedOdd, pouring, angleDiff);
    syncSectionClass(pouring);

    const stillSpinning = absDiff > 0.2 || Math.abs(angVel) > 0.2;
    if (stillSpinning || pouring) {
      rafId = requestAnimationFrame(step);
    } else {
      angle = targetAngle;
      angVel = 0;
      if (frameEl) frameEl.style.transform = `rotate(${targetAngle}deg)`;
      renderSandGeometry(flippedOdd, false, 0);
      syncSectionClass(false);
      rafId = null;
      lastTs = 0;
    }
  };

  const ensureRunning = () => {
    if (rafId === null && typeof requestAnimationFrame === 'function') {
      lastTs = 0;
      rafId = requestAnimationFrame(step);
    }
  };

  const initOdd = (Math.round(targetAngle / 180) % 2) !== 0;
  const initUpper = initOdd ? 1 - bulbASand : bulbASand;
  if (frameEl) frameEl.style.transform = `rotate(${targetAngle}deg)`;
  renderSandGeometry(initOdd, initUpper > 0.01, 0);
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => syncSectionClass(initUpper > 0.01));
    if (initUpper > 0.01) ensureRunning();
  }

  btn.addEventListener('mouseenter', () => {
    if (Math.abs(targetAngle - angle) < 2) {
      angVel += 1.25;
      ensureRunning();
    }
  });

  btn.addEventListener('click', () => {
    // Flip 180° — sand stays in its current bulb, which is now physically on top!
    targetAngle += 180;
    sharedHourglassAngle = targetAngle;
    const nextOdd = (Math.round(targetAngle / 180) % 2) !== 0;
    const nextUpper = nextOdd ? 1 - bulbASand : bulbASand;
    if (nextUpper > 0.002) {
      // Activate storm & heading immediately on click so there is zero delay
      syncSectionClass(true);
      if (typeof window !== 'undefined' && typeof CustomEvent === 'function') {
        window.dispatchEvent(new CustomEvent('gd-hourglass-flip'));
      }
    }
    ensureRunning();
  });

  return btn;
}

/**
 * Full-workspace Golden Sandstorm canvas overlay triggered when the Pending
 * Approvals hourglass flips and pours (.gd-pending-sandstorm-on).
 */
export function createPendingSandstormOverlay(): HTMLElement {
  const canvas = document.createElement('canvas');
  canvas.className = 'gd-pending-sandstorm';
  canvas.setAttribute('aria-hidden', 'true');

  if (typeof window === 'undefined' || typeof requestAnimationFrame !== 'function') {
    return canvas;
  }
  const ctx = canvas.getContext?.('2d');
  if (!ctx) return canvas;

  interface SandParticle {
    x: number;
    y: number;
    vx: number;
    vy: number;
    size: number;
    len: number;
    alpha: number;
    color: string;
    phase: number;
    layer: 0 | 1 | 2; // 0: distant dust, 1: crisp mid grains, 2: fast foreground streaks
  }

  interface WindRibbon {
    x: number;
    y: number;
    vx: number;
    width: number;
    amp: number;
    freq: number;
    phase: number;
    alpha: number;
  }

  // High-contrast bronze, ochre, amber, and sunlit gold so grains read crisply on cream/parchment
  const palette = ['#9C651C', '#B87A24', '#D69834', '#E8B84E', '#7A4E14', '#C98A2E'];
  let width = 800;
  let height = 600;
  let gust = 0.48;
  let stormAlpha = 0;
  let clock = 0;
  let lastTs = 0;
  let rafId: number | null = null;
  let boardAngle = 0;
  let boardVel = 0;

  const resize = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    width = Math.max(320, window.innerWidth - 240);
    height = Math.max(320, window.innerHeight);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener('resize', resize, { passive: true });

  const particles: SandParticle[] = Array.from({ length: 135 }, (_, i) => {
    const layer = (i % 6 === 0 ? 2 : i % 3 === 0 ? 0 : 1) as 0 | 1 | 2;
    return {
      x: Math.random() * width,
      y: Math.random() * height,
      vx: layer === 2 ? 360 + Math.random() * 240 : layer === 1 ? 210 + Math.random() * 190 : 120 + Math.random() * 110,
      vy: 10 + Math.random() * 44,
      size: layer === 2 ? 1.5 + Math.random() * 1.4 : layer === 1 ? 1.1 + Math.random() * 1.1 : 0.8 + Math.random() * 0.7,
      len: layer === 2 ? 16 + Math.random() * 22 : layer === 1 ? 5 + Math.random() * 10 : 2 + Math.random() * 4,
      alpha: layer === 2 ? 0.42 + Math.random() * 0.32 : layer === 1 ? 0.35 + Math.random() * 0.4 : 0.2 + Math.random() * 0.22,
      color: palette[i % palette.length],
      phase: Math.random() * Math.PI * 2,
      layer,
    };
  });

  const ribbons: WindRibbon[] = Array.from({ length: 7 }, (_, i) => ({
    x: (i / 7) * width,
    y: (0.12 + (i % 5) * 0.18) * height,
    vx: 165 + i * 24,
    width: 150 + (i % 3) * 70,
    amp: 12 + (i % 3) * 8,
    freq: 0.022 + (i % 2) * 0.01,
    phase: i * 1.1,
    alpha: 0.09 + (i % 3) * 0.035,
  }));

  const isStormActive = () =>
    Boolean(document.querySelector('.gd-dashboard-app.gd-pending-sandstorm-on'));

  const step = (ts: number) => {
    if (!document.contains(canvas)) {
      rafId = null;
      return;
    }

    const dt = lastTs ? Math.min(0.04, (ts - lastTs) / 1000) : 0.016;
    lastTs = ts;
    clock += dt;

    const active = isStormActive();
    const targetAlpha = active ? 1 : 0;
    stormAlpha += (targetAlpha - stormAlpha) * Math.min(1, dt * (active ? 4.8 : 3.0));
    // Periodic natural wind surges while active
    const waveGust = active ? 0.46 + Math.max(0, Math.sin(clock * 1.35)) * 0.26 : 0.35;
    gust += (waveGust - gust) * Math.min(1, dt * 1.8);

    ctx.clearRect(0, 0, width, height);

    if (stormAlpha > 0.01) {
      const speedMul = 0.7 + gust * 1.3;

      // 1. Swirling translucent desert wind ribbons
      for (const r of ribbons) {
        r.x += r.vx * speedMul * dt;
        if (r.x - r.width > width + 40) {
          r.x = -r.width - 40;
          r.y = (0.1 + Math.random() * 0.8) * height;
        }
        ctx.save();
        ctx.strokeStyle = 'rgba(196, 134, 42, 1)';
        ctx.globalAlpha = r.alpha * stormAlpha;
        ctx.lineWidth = 2.4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        const steps = 10;
        for (let s = 0; s <= steps; s++) {
          const rx = r.x - (s / steps) * r.width;
          const ry = r.y + Math.sin(rx * r.freq + clock * 4 + r.phase) * r.amp;
          if (s === 0) ctx.moveTo(rx, ry);
          else ctx.lineTo(rx, ry);
        }
        ctx.stroke();
        ctx.restore();
      }

      // 2. Layered wind-swept sand grains + gusts
      for (const p of particles) {
        const swirl = Math.sin(clock * 3.8 + p.phase + p.x * 0.008) * (24 + p.layer * 14);
        const lift = Math.cos(clock * 2.3 + p.phase) * 14;
        p.x += (p.vx + lift) * speedMul * dt;
        p.y += (p.vy + swirl) * speedMul * dt;

        if (p.x > width + 36) {
          p.x = -30;
          p.y = Math.random() * height;
        }
        if (p.y > height + 24) {
          p.y = -14;
        } else if (p.y < -24) {
          p.y = height + 14;
        }

        const a = p.alpha * stormAlpha;
        ctx.globalAlpha = a;

        if (p.layer === 0) {
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.strokeStyle = p.color;
          ctx.lineWidth = p.size;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.len * speedMul, p.y - ((p.vy + swirl * 0.35) / p.vx) * p.len * speedMul);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }

    // Physical pendulum swing + turbulent jiggle + 3D wind-pressure tilt on the hanging greeting board
    const boardEl = document.querySelector('#view-pending .gd-overview-greeting-card .gd-wood-board') as HTMLElement | null;
    if (boardEl) {
      const gustWave = active
        ? Math.max(0.25, 0.55 + Math.sin(clock * 2.4) * 0.35 + Math.sin(clock * 6.1) * 0.22)
        : 0;
      const windTorque = active
        ? (3.2 + gust * 5.4 + Math.sin(clock * 3.1) * 2.4 + Math.sin(clock * 7.3) * 1.2)
        : 0;
      const boardAccel = windTorque * 4.4 - boardAngle * 15 - boardVel * 2.1;
      boardVel += boardAccel * dt;
      boardAngle += boardVel * dt;

      const jiggleX = active ? Math.sin(clock * 18.5) * gustWave * 1.35 : 0;
      const jiggleY = active ? Math.cos(clock * 22.0) * gustWave * 0.85 : 0;
      const jiggleRot = active ? Math.sin(clock * 15.2) * gustWave * 0.75 : 0;
      const tiltX = active ? 2.5 + Math.sin(clock * 4.8) * gustWave * 3.2 : 0;
      const tiltY = active ? -2.0 - Math.cos(clock * 3.9) * gustWave * 2.8 : 0;

      if (active || Math.abs(boardAngle) > 0.03 || Math.abs(boardVel) > 0.05) {
        boardEl.style.transformOrigin = '50% -26px';
        boardEl.style.transform =
          `perspective(760px) translate3d(${(boardAngle * 1.35 + jiggleX).toFixed(2)}px, ${jiggleY.toFixed(2)}px, 0) ` +
          `rotate(${(boardAngle + jiggleRot).toFixed(2)}deg) rotateX(${tiltX.toFixed(2)}deg) rotateY(${tiltY.toFixed(2)}deg)`;
      } else {
        boardAngle = 0;
        boardVel = 0;
        boardEl.style.transform = '';
      }
    }

    if (active || stormAlpha > 0.015 || Math.abs(boardAngle) > 0.04 || Math.abs(boardVel) > 0.06) {
      rafId = requestAnimationFrame(step);
    } else {
      ctx.clearRect(0, 0, width, height);
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

  window.addEventListener('gd-hourglass-flip', () => {
    gust = 1.25;
    ensureRunning();
  });

  if (typeof MutationObserver === 'function') {
    requestAnimationFrame(() => {
      const appEl = document.querySelector('.gd-dashboard-app');
      if (!appEl) return;
      const obs = new MutationObserver(() => {
        if (!document.contains(canvas)) {
          obs.disconnect();
          return;
        }
        if (isStormActive()) ensureRunning();
      });
      obs.observe(appEl, { attributes: true, attributeFilter: ['class'] });
      if (isStormActive()) ensureRunning();
    });
  }

  return canvas;
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
  const stormNotes = ['Dusty out here!', 'Holding the perch!', 'Eyes shielded!', 'Riding the gusts!'];
  let noteIdx = 0;
  let stormNoteIdx = 0;
  let noteTimer: ReturnType<typeof setTimeout> | null = null;

  owlBtn.innerHTML = `
    <span class="gd-owl-note" aria-hidden="true"></span>
    <span class="gd-owl-dust" aria-hidden="true">
      <span class="gd-owl-mote gd-owl-mote-1"></span>
      <span class="gd-owl-mote gd-owl-mote-2"></span>
      <span class="gd-owl-mote gd-owl-mote-3"></span>
      <span class="gd-owl-mote gd-owl-mote-4"></span>
      <span class="gd-owl-mote gd-owl-mote-5"></span>
    </span>
    <svg class="gd-prop-svg" width="92" height="88" viewBox="0 0 74 72" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="gd-owl-plumage" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#B98E66"/>
          <stop offset="55%" stop-color="#9A724F"/>
          <stop offset="100%" stop-color="#765539"/>
        </linearGradient>
        <linearGradient id="gd-owl-wing-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#A8805B"/>
          <stop offset="65%" stop-color="#7F5E42"/>
          <stop offset="100%" stop-color="#5B422D"/>
        </linearGradient>
        <radialGradient id="gd-owl-disc" cx="50%" cy="45%" r="55%">
          <stop offset="0%" stop-color="#FFFBF2"/>
          <stop offset="75%" stop-color="#F5ECDC"/>
          <stop offset="100%" stop-color="#E4D4BA"/>
        </radialGradient>
      </defs>
      <g class="gd-owl-body" style="transform-origin: 37px 63px;">
        <!-- Layered Spread Wings (visible during click swoop & gust balancing) -->
        <g class="gd-owl-wing-left" style="transform-origin: 28px 36px;">
          <path d="M29 35 C15 24, 3 27, 0 38 C7 42.5, 16 45, 28 44 Z" fill="url(#gd-owl-wing-grad)" stroke="#2A1F16" stroke-width="1.05" stroke-linejoin="round"/>
          <path d="M6 34 L22 38 M4 38 L20 41 M9 41 L24 42" stroke="#4D3725" stroke-width="0.75" opacity="0.6" stroke-linecap="round"/>
        </g>
        <g class="gd-owl-wing-right" style="transform-origin: 46px 36px;">
          <path d="M45 35 C59 24, 71 27, 74 38 C67 42.5, 58 45, 46 44 Z" fill="url(#gd-owl-wing-grad)" stroke="#2A1F16" stroke-width="1.05" stroke-linejoin="round"/>
          <path d="M68 34 L52 38 M70 38 L54 41 M65 41 L50 42" stroke="#4D3725" stroke-width="0.75" opacity="0.6" stroke-linecap="round"/>
        </g>

        <!-- Barred tail feathers -->
        <path d="M30 55 L26.5 66.5 L33 64.5 L37 66 L41 64.5 L47.5 66.5 L44 55 Z" fill="#6B4F37" stroke="#2A1F16" stroke-width="0.95" stroke-linejoin="round"/>
        <line x1="29.5" y1="61" x2="44.5" y2="61" stroke="#4A3422" stroke-width="0.8" opacity="0.55"/>

        <!-- Rounded torso & warm speckled ivory breast -->
        <path d="M24 31 C22 44, 25.5 58, 37 59 C48.5 58, 52 44, 50 31 C47 26, 27 26, 24 31 Z" fill="url(#gd-owl-plumage)" stroke="#2A1F16" stroke-width="1.1"/>
        <path d="M29 33 C27.2 43, 29.5 54, 37 55.5 C44.5 54, 46.8 43, 45 33 Z" fill="url(#gd-owl-disc)"/>
        <circle cx="33.5" cy="40" r="0.85" fill="#7D5E44" opacity="0.6"/>
        <circle cx="40.5" cy="41.5" r="0.85" fill="#7D5E44" opacity="0.6"/>
        <circle cx="36.5" cy="46.5" r="0.85" fill="#7D5E44" opacity="0.65"/>
        <circle cx="32.8" cy="49" r="0.7" fill="#7D5E44" opacity="0.5"/>
        <circle cx="41.2" cy="49.5" r="0.7" fill="#7D5E44" opacity="0.5"/>

        <!-- Folded wings (perched) -->
        <path class="gd-owl-wing-folded" d="M24.2 32 C20.8 42, 23 53, 28.8 56 C30 48, 30 39, 27.8 32 Z" fill="url(#gd-owl-wing-grad)" stroke="#2A1F16" stroke-width="0.95"/>
        <path class="gd-owl-wing-folded" d="M49.8 32 C53.2 42, 51 53, 45.2 56 C44 48, 44 39, 46.2 32 Z" fill="url(#gd-owl-wing-grad)" stroke="#2A1F16" stroke-width="0.95"/>

        <!-- Talons firmly gripping frame rail -->
        <g class="gd-owl-talons">
          <path d="M32 57.5 L31 64.5 M29 64.5 L33.5 64.5" stroke="#D19F4C" stroke-width="1.7" stroke-linecap="round"/>
          <path d="M42 57.5 L43 64.5 M40.5 64.5 L45 64.5" stroke="#D19F4C" stroke-width="1.7" stroke-linecap="round"/>
        </g>

        <!-- Articulated Barn Owl Head with amber irises & feathered facial disc -->
        <g class="gd-owl-head" style="transform-origin: 37px 26px;">
          <path d="M22 21.5 C22 10, 52 10, 52 21.5 C52 31, 44.5 35.5, 37 35.5 C29.5 35.5, 22 31, 22 21.5 Z" fill="url(#gd-owl-plumage)" stroke="#2A1F16" stroke-width="1.1"/>
          <!-- Heart-shaped facial disc -->
          <path d="M25.2 20.8 C25.2 13.8, 34.2 13.8, 37 18.2 C39.8 13.8, 48.8 13.8, 48.8 20.8 C48.8 28, 41.5 32.5, 37 33 C32.5 32.5, 25.2 28, 25.2 20.8 Z" fill="url(#gd-owl-disc)" stroke="#9A653F" stroke-width="0.95"/>
          <!-- Expressive amber irises + deep pupils + catchlights -->
          <circle cx="31.8" cy="21.8" r="2.75" fill="#D89A3C" stroke="#4F3518" stroke-width="0.5"/>
          <circle cx="42.2" cy="21.8" r="2.75" fill="#D89A3C" stroke="#4F3518" stroke-width="0.5"/>
          <circle cx="31.8" cy="21.8" r="1.55" fill="#14110E"/>
          <circle cx="42.2" cy="21.8" r="1.55" fill="#14110E"/>
          <circle cx="32.5" cy="20.9" r="0.7" fill="#FFFFFF"/>
          <circle cx="42.9" cy="20.9" r="0.7" fill="#FFFFFF"/>
          <!-- Animated blink eyelids -->
          <rect class="gd-owl-eyelid" x="28.8" y="18.8" width="6" height="6" rx="2.5" fill="#E8DAC0"/>
          <rect class="gd-owl-eyelid" x="39.2" y="18.8" width="6" height="6" rx="2.5" fill="#E8DAC0"/>
          <!-- Curved amber-horn beak -->
          <path d="M35.2 23.8 Q37 23.2 38.8 23.8 L37 28.6 Z" fill="#DDA952" stroke="#5A3F18" stroke-width="0.7" stroke-linejoin="round"/>
        </g>

        <!-- Protective Windward Wing-Shield (raised across left side during sandstorm) -->
        <g class="gd-owl-wing-shield" style="transform-origin: 25px 38px;">
          <path d="M24.5 47 C19 34, 20.5 19.5, 31.5 17.5 C34 25, 33.5 36.5, 30 47 Z" fill="url(#gd-owl-wing-grad)" stroke="#2A1F16" stroke-width="1.05" stroke-linejoin="round"/>
          <path d="M23.5 25.5 L30.5 32 M22.5 32 L29.5 38.5 M23.5 38.5 L29 44" stroke="#4D3725" stroke-width="0.8" opacity="0.65" stroke-linecap="round"/>
        </g>
      </g>
    </svg>
  `;

  const showNote = (text: string, durationMs = 2400) => {
    if (!noteBubble) return;
    noteBubble.textContent = text;
    noteBubble.classList.add('is-visible');
    if (noteTimer) clearTimeout(noteTimer);
    noteTimer = setTimeout(() => {
      noteBubble.classList.remove('is-visible');
    }, durationMs);
  };

  const headEl = owlBtn.querySelector('.gd-owl-head') as SVGGElement | null;
  const bodyEl = owlBtn.querySelector('.gd-owl-body') as SVGGElement | null;
  const shieldEl = owlBtn.querySelector('.gd-owl-wing-shield') as SVGGElement | null;
  const noteBubble = owlBtn.querySelector('.gd-owl-note') as HTMLElement | null;

  let headRot = 0;
  let targetHeadRot = 0;
  let headX = 0;
  let targetHeadX = 0;
  let swoopY = 0;
  let swoopVelY = 0;
  let swoopClock = -1;
  let stormClock = 0;
  let nextAutoNoteAt = 0.85;
  let shakeClock = -1;
  let wasStorming = false;
  let rafId: number | null = null;

  const isStorming = () =>
    typeof document !== 'undefined' &&
    Boolean(document.querySelector('.gd-dashboard-app.gd-pending-sandstorm-on'));

  const stepOwl = () => {
    if (typeof document !== 'undefined' && !document.contains(owlBtn)) {
      rafId = null;
      return;
    }

    const storming = isStorming();
    if (wasStorming && !storming) {
      // Trigger a natural post-storm feather shake when the sand clears
      shakeClock = 0;
      nextAutoNoteAt = 0.85;
    }
    wasStorming = storming;

    if (storming) {
      stormClock += 0.016;
      if (stormClock >= nextAutoNoteAt) {
        showNote(stormNotes[stormNoteIdx % stormNotes.length], 2500);
        stormNoteIdx += 1;
        nextAutoNoteAt = stormClock + 5.6;
      }
    } else {
      stormClock = 0;
      nextAutoNoteAt = 0.85;
    }

    if (shakeClock >= 0) {
      shakeClock += 0.016;
      if (shakeClock > 0.55) shakeClock = -1;
    }

    headRot += (targetHeadRot - headRot) * 0.16;
    headX += (targetHeadX - headX) * 0.16;

    const shakeAngle = shakeClock >= 0 ? Math.sin(shakeClock * 42) * 11 * (1 - shakeClock / 0.55) : 0;

    if (headEl) {
      const windHeadTilt = storming ? -9.5 + Math.sin(stormClock * 8.4) * 2.8 + Math.cos(stormClock * 16.0) * 0.9 : 0;
      const windDuckY = storming ? 2.2 + Math.abs(Math.sin(stormClock * 3.1)) * 1.3 : 0;
      headEl.style.transform = `translate(${(headX + (storming ? 1.5 : 0)).toFixed(2)}px, ${windDuckY.toFixed(2)}px) rotate(${(headRot + windHeadTilt + shakeAngle).toFixed(2)}deg)`;
    }

    if (shieldEl) {
      if (storming) {
        const shieldBob = Math.sin(stormClock * 7.2) * 4;
        shieldEl.style.transform = `rotate(${(-4 + shieldBob).toFixed(1)}deg)`;
      } else {
        shieldEl.style.transform = '';
      }
    }

    if (swoopClock >= 0) {
      swoopClock += 0.016;
      const accelY = (0 - swoopY) * 0.12;
      swoopVelY = (swoopVelY + accelY) * 0.86;
      swoopY += swoopVelY;
      if (bodyEl) {
        bodyEl.style.transform = `translateY(${swoopY.toFixed(2)}px) rotate(${(shakeAngle * 0.45).toFixed(2)}deg)`;
      }
      if (swoopClock > 0.75 && Math.abs(swoopY) < 0.3 && Math.abs(swoopVelY) < 0.3) {
        swoopClock = -1;
        swoopY = 0;
        swoopVelY = 0;
        owlBtn.classList.remove('is-swooping');
        if (bodyEl) bodyEl.style.transform = '';
      }
    } else if (bodyEl) {
      if (storming) {
        const gustPeak = Math.sin(stormClock * 2.4) * 0.5 + 0.5;
        const flutter = Math.sin(stormClock * 14.5) * (0.8 + gustPeak * 1.4);
        const lean = -7.5 - gustPeak * 4.5 + flutter + shakeAngle * 0.35;
        const crouchY = 3.2 + gustPeak * 1.4;
        const shiftX = 2.0 + gustPeak * 1.6 + Math.sin(stormClock * 9.2) * 0.7;
        bodyEl.style.transform = `translate(${shiftX.toFixed(2)}px, ${crouchY.toFixed(2)}px) rotate(${lean.toFixed(2)}deg)`;
        owlBtn.classList.toggle('is-wind-bracing', gustPeak > 0.65);
        owlBtn.classList.toggle('is-shielding', gustPeak <= 0.65);
      } else {
        owlBtn.classList.remove('is-wind-bracing', 'is-shielding');
        bodyEl.style.transform = shakeClock >= 0 ? `rotate(${(shakeAngle * 0.45).toFixed(2)}deg)` : '';
      }
    }

    const moving =
      storming ||
      shakeClock >= 0 ||
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
    window.addEventListener('gd-hourglass-flip', () => {
      if (!document.contains(owlBtn)) return;
      owlBtn.classList.add('is-wind-bracing');
      setTimeout(() => owlBtn.classList.remove('is-wind-bracing'), 950);
      ensureRunning();
    });
  }

  if (typeof MutationObserver === 'function' && typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => {
      const appEl = document.querySelector('.gd-dashboard-app');
      if (!appEl) return;
      const obs = new MutationObserver(() => {
        if (!document.contains(owlBtn)) {
          obs.disconnect();
          return;
        }
        if (isStorming()) ensureRunning();
      });
      obs.observe(appEl, { attributes: true, attributeFilter: ['class'] });
      if (isStorming()) ensureRunning();
    });
  }

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
    const storming = isStorming();
    if (storming) {
      shakeClock = 0;
    } else {
      swoopClock = 0;
      swoopVelY = -5.4;
      owlBtn.classList.add('is-swooping');
    }
    ensureRunning();

    if (storming) {
      const pool = stormNotes;
      showNote(pool[stormNoteIdx % pool.length], 2000);
      stormNoteIdx += 1;
    } else {
      showNote(notes[noteIdx % notes.length], 1600);
      noteIdx += 1;
    }
  });

  return owlBtn;
}
