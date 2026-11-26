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

const sharedBirdState = {
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  heading: -0.35,
  speed: 170,
  facing: 1 as 1 | -1,
  pitch: 0,
  waypointIdx: 0,
  frameSpotIdx: 0,
};

function syncLanternAmbience(): void {
  if (typeof document === 'undefined') return;
  const appEl = document.querySelector('.gd-dashboard-app');
  if (appEl) {
    appEl.classList.toggle('gd-lantern-ambience-on', sharedLanternLit);
  }
  if (typeof window !== 'undefined' && typeof CustomEvent === 'function') {
    window.dispatchEvent(new CustomEvent('gd-lantern-ambience-sync', { detail: { lit: sharedLanternLit } }));
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
    <span class="gd-lantern-moths" aria-hidden="true">
      <span class="gd-lantern-moth gd-moth-1"></span>
      <span class="gd-lantern-moth gd-moth-2"></span>
      <span class="gd-lantern-moth gd-moth-3"></span>
    </span>
    <span class="gd-lantern-flight-chirp" aria-hidden="true">Chirp! ♪</span>
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

        <!-- Delicate legs/claws + contact shadow (visible when perched, tucked in flight) -->
        <g class="gd-bird-legs">
          <ellipse cx="34" cy="10.4" rx="5.5" ry="1.3" fill="rgba(22, 16, 10, 0.24)"/>
          <path d="M32 5 L31.5 10 M30.2 10 L33 10" stroke="#2D2219" stroke-width="1.25" stroke-linecap="round"/>
          <path d="M36 5 L35.5 10 M34.4 10 L37.2 10" stroke="#2D2219" stroke-width="1.25" stroke-linecap="round"/>
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

let sharedBirdAudioCtx: AudioContext | null = null;

/**
 * Synthesizes a soft, pleasant double/triple songbird warble via Web Audio API.
 * Gracefully no-ops in headless/test environments or if AudioContext is blocked.
 */
function playBirdChirp(variant = 0): void {
  try {
    if (typeof window === 'undefined') return;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    if (!sharedBirdAudioCtx) {
      sharedBirdAudioCtx = new AudioCtx();
    }
    if (sharedBirdAudioCtx.state === 'suspended') {
      void sharedBirdAudioCtx.resume();
    }
    const now = sharedBirdAudioCtx.currentTime;
    const master = sharedBirdAudioCtx.createGain();
    master.gain.setValueAtTime(0.042, now);
    master.connect(sharedBirdAudioCtx.destination);

    const patterns = [
      [
        { s: 0, d: 0.065, f0: 3100, f1: 4350 },
        { s: 0.085, d: 0.085, f0: 3850, f1: 2850 },
      ],
      [
        { s: 0, d: 0.055, f0: 4300, f1: 3200 },
        { s: 0.075, d: 0.09, f0: 3300, f1: 4750 },
      ],
      [
        { s: 0, d: 0.05, f0: 3550, f1: 4150 },
        { s: 0.065, d: 0.05, f0: 4100, f1: 4700 },
        { s: 0.125, d: 0.08, f0: 4550, f1: 3250 },
      ],
    ];
    const seq = patterns[Math.abs(variant) % patterns.length];

    for (const note of seq) {
      const osc = sharedBirdAudioCtx.createOscillator();
      const gain = sharedBirdAudioCtx.createGain();
      osc.type = 'sine';
      const t0 = now + note.s;
      const t1 = t0 + note.d;

      osc.frequency.setValueAtTime(note.f0, t0);
      osc.frequency.exponentialRampToValueAtTime(Math.max(240, note.f1), t1);

      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(0.038, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t1);

      osc.connect(gain);
      gain.connect(master);
      osc.start(t0);
      osc.stop(t1 + 0.012);
    }
  } catch {
    // Ignore audio errors if blocked or unsupported
  }
}

function ensureUnlockedBirdAudioCtx(): AudioContext | null {
  try {
    if (typeof window === 'undefined') return null;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!sharedBirdAudioCtx) sharedBirdAudioCtx = new AudioCtx();
    if (sharedBirdAudioCtx.state === 'suspended') {
      void sharedBirdAudioCtx.resume().catch(() => {});
    }
    return sharedBirdAudioCtx;
  } catch {
    return null;
  }
}

/**
 * Synthesizes a crystalline Edo-glass Japanese Fūrin (wind chime) tone via Web Audio API.
 * Uses delicate high-Q glass partials with a dual-mode shimmer beat and crisp ceramic tap.
 */
function playJapaneseFurinChime(intensity = 1, pitchOffset = 0, baseFreqOverride?: number): void {
  try {
    const ctx = ensureUnlockedBirdAudioCtx();
    if (!ctx) return;

    const triggerPartials = () => {
      if (ctx.state !== 'running') return;
      const vol = Math.max(0.28, Math.min(1.2, intensity));
      const now = ctx.currentTime;
      const baseFreq = (baseFreqOverride ?? 1760) + pitchOffset;
      const partials = [
        { freq: baseFreq, peak: 0.042 * vol, decay: 1.85 },
        { freq: baseFreq * 1.0032, peak: 0.032 * vol, decay: 1.6 },
        { freq: baseFreq * 2.01, peak: 0.015 * vol, decay: 0.78 },
        { freq: baseFreq * 2.86, peak: 0.007 * vol, decay: 0.28 },
        { freq: baseFreq * 3.92, peak: 0.0035 * vol, decay: 0.09 },
      ];
      for (const p of partials) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(p.freq, now);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(p.peak, now + 0.003);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + p.decay);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + p.decay + 0.02);
      }
    };

    if (ctx.state === 'running') {
      triggerPartials();
    } else if (ctx.state === 'suspended') {
      void ctx.resume().then(triggerPartials).catch(() => {});
    }
  } catch {
    // Ignore audio errors cleanly
  }
}

/**
 * Physics-driven full-page flight controller for the lantern bird:
 * - True curved-heading aerodynamic steering (no flat 2D card-flip squishing)
 * - Alternating vigorous wingbeats, soaring glides & dihedral banked turns
 * - Naturally lands on wooden UI frames across Overview, perches & chirps, then flies on
 * - Smooth flare return-to-perch when lantern is extinguished
 */
function attachLanternBirdFlight(lanternBtn: HTMLElement): void {
  const birdEl = lanternBtn.querySelector('.gd-lantern-bird') as SVGGElement | null;
  const nearWing = lanternBtn.querySelector('.gd-bird-wing-near') as SVGGElement | null;
  const farWing = lanternBtn.querySelector('.gd-bird-wing-far') as SVGGElement | null;
  const tailEl = lanternBtn.querySelector('.gd-bird-tail') as SVGGElement | null;
  const chirpEl = lanternBtn.querySelector('.gd-lantern-flight-chirp') as HTMLElement | null;
  if (!birdEl || typeof requestAnimationFrame !== 'function') return;

  const CHIRP_PHRASES = [
    '♪ Chirp!',
    'Tweet-tweet! ♪',
    '♪ Cheep-cheep!',
    'Peep! ♪',
    '♪♫',
    'Sweet-sweet! ♪',
    'All clear! ♪',
  ];

  const SKY_WAYPOINTS = [
    { rx: 0.24, ry: 0.06, speed: 180, chirp: 'Tweet-tweet! ♪' },
    { rx: 0.72, ry: 0.05, speed: 205, chirp: null },
    { rx: 0.92, ry: 0.24, speed: 195, chirp: '♪ Chirp!' },
    { rx: 0.56, ry: 0.22, speed: 200, chirp: null },
    { rx: 0.16, ry: 0.28, speed: 185, chirp: 'Peep! ♪' },
    { rx: 0.84, ry: 0.44, speed: 215, chirp: '♪ Chirp!' },
    { rx: 0.44, ry: 0.58, speed: 200, chirp: null },
    { rx: 0.22, ry: 0.74, speed: 185, chirp: '♫ Chirp!' },
  ];

  interface FrameSpotDef {
    selector: string;
    rx: number;
    yOffset: number;
    faceDir: 1 | -1;
    getPerchMessage: () => string;
  }

  const readCardMetricText = (selector: string): string => {
    if (typeof document === 'undefined') return '';
    const el = document.querySelector(selector);
    return el?.textContent?.trim() ?? '';
  };

  const FRAME_SPOTS: FrameSpotDef[] = [
    {
      selector: '#view-overview .gd-wood-board',
      rx: 0.86,
      yOffset: 3.5,
      faceDir: -1,
      getPerchMessage: () => {
        const now = new Date();
        const t = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        const hr = now.getHours();
        const greet =
          hr < 5 || hr >= 21
            ? 'Good Night'
            : hr < 12
              ? 'Good Morning'
              : hr < 17
                ? 'Good Afternoon'
                : 'Good Evening';
        return `${t} · ${greet} ♪`;
      },
    },
    {
      selector: '#view-overview .gd-metric-card-ward',
      rx: 0.72,
      yOffset: 2.5,
      faceDir: -1,
      getPerchMessage: () => {
        const raw = readCardMetricText('#view-overview .gd-metric-card-ward .gd-metric-value') || '0';
        const n = Number(raw);
        return `${raw} Ward${n === 1 ? '' : 's'} Connected ♪`;
      },
    },
    {
      selector: '#view-overview .gd-metric-card-approvals',
      rx: 0.28,
      yOffset: 2.5,
      faceDir: 1,
      getPerchMessage: () => {
        const raw = readCardMetricText('#view-overview .gd-metric-card-approvals .gd-metric-value') || '0';
        const n = Number(raw);
        if (n === 0) return '0 Need Review · All Clear ♪';
        return `${raw} Request${n === 1 ? '' : 's'} Need${n === 1 ? 's' : ''} Review! ♪`;
      },
    },
    {
      selector: '#view-overview .gd-overview-grid .gd-metric-card:nth-child(3)',
      rx: 0.24,
      yOffset: 2.5,
      faceDir: 1,
      getPerchMessage: () => {
        const raw =
          readCardMetricText('#view-overview .gd-overview-grid .gd-metric-card:nth-child(3) .gd-metric-value') ||
          'Active';
        return `Enforcement ${raw} ♪`;
      },
    },
    {
      selector: '#view-overview .gd-recent-activity-list',
      rx: 0.3,
      yOffset: 2.5,
      faceDir: 1,
      getPerchMessage: () => {
        const count =
          typeof document !== 'undefined'
            ? document.querySelectorAll('#view-overview .gd-recent-activity-item').length
            : 0;
        return count === 0
          ? 'No Recent Activity ♪'
          : `${count} Recent Decision${count === 1 ? '' : 's'} ♪`;
      },
    },
  ];

  const svgEl = lanternBtn.querySelector('.gd-prop-svg') as SVGElement | null;

  const normalizeAngle = (rad: number) => {
    let a = rad;
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  };

  let x = sharedBirdState.x;
  let y = sharedBirdState.y;
  let vx = sharedBirdState.vx;
  let vy = sharedBirdState.vy;
  let heading = sharedBirdState.heading;
  let speed = sharedBirdState.speed;
  let facing: 1 | -1 = sharedBirdState.facing;
  let pitch = sharedBirdState.pitch;
  let turnBlend = 0;
  let flightClock = 0;
  let returnClock = 0;
  let wingPhase = 0;
  let waypointIdx = sharedBirdState.waypointIdx;
  let legsBeforeLand = 1;
  let frameSpotIdx = sharedBirdState.frameSpotIdx;
  let activeFrameSpot: FrameSpotDef | null = null;
  let perchedUntil = 0;
  let hopSeed = 0;
  let jitterSeed = 0.7;
  let nextChirpAt = 0.6;
  let chirpCounter = 0;
  let chirpHideTimer: ReturnType<typeof setTimeout> | null = null;
  let lastTs = 0;
  let rafId: number | null = null;
  let swoopTarget: { x: number; y: number; until: number } | null = null;

  const syncSharedBirdState = () => {
    sharedBirdState.x = x;
    sharedBirdState.y = y;
    sharedBirdState.vx = vx;
    sharedBirdState.vy = vy;
    sharedBirdState.heading = heading;
    sharedBirdState.speed = speed;
    sharedBirdState.facing = facing;
    sharedBirdState.pitch = pitch;
    sharedBirdState.waypointIdx = waypointIdx;
    sharedBirdState.frameSpotIdx = frameSpotIdx;
  };

  const getOriginMetrics = () => {
    const refEl = svgEl || lanternBtn;
    const sRect = refEl.getBoundingClientRect();
    const scale = sRect.width > 0 ? sRect.width / 88 : 1;
    return {
      left: sRect.left,
      top: sRect.top,
      scale,
      perchScreenX: sRect.left + 34 * scale,
      perchScreenY: sRect.top + 10 * scale,
    };
  };

  const triggerChirp = (customPhrase?: string | null, durationMs = 1500) => {
    const phrase = customPhrase || CHIRP_PHRASES[chirpCounter % CHIRP_PHRASES.length];
    playBirdChirp(chirpCounter);
    chirpCounter += 1;
    if (chirpEl) {
      chirpEl.textContent = phrase;
      chirpEl.style.left = `${(x + 34).toFixed(1)}px`;
      chirpEl.style.top = `${(y + 5).toFixed(1)}px`;
      chirpEl.classList.add('is-visible');
      if (chirpHideTimer) clearTimeout(chirpHideTimer);
      chirpHideTimer = setTimeout(() => {
        chirpEl.classList.remove('is-visible');
      }, durationMs);
    }
  };

  const getPageBounds = () => {
    const container =
      lanternBtn.closest('#view-overview') ||
      lanternBtn.closest('.gd-main-content') ||
      (typeof document !== 'undefined' ? document.body : null);
    const lRect = lanternBtn.getBoundingClientRect();
    const cRect = container
      ? container.getBoundingClientRect()
      : { left: lRect.left, right: window.innerWidth, top: 0, bottom: window.innerHeight, height: window.innerHeight };

    const minX = Math.max(-lRect.left + cRect.left + 12, -24);
    const maxX = Math.max(660, Math.min(1180, (cRect.right || window.innerWidth) - lRect.left - 62));
    const minY = Math.max(-lRect.top + 18, -38);
    const viewSpanH = Math.max(460, window.innerHeight - lRect.top - 58);
    const maxY = Math.min(Math.max(460, (cRect.height || viewSpanH) - 100), viewSpanH);
    return { minX, maxX, minY, maxY };
  };

  const getFrameSpotCoords = (spot: FrameSpotDef): { x: number; y: number } | null => {
    if (typeof document === 'undefined') return null;
    const el = document.querySelector(spot.selector) as HTMLElement | null;
    if (!el) return null;
    const fRect = el.getBoundingClientRect();
    if (fRect.width < 40 || fRect.height < 20) return null;
    const origin = getOriginMetrics();
    // Compensate for the hanging wood sign's slight -0.95deg counter-clockwise rotation
    const tiltOffset =
      spot.selector.includes('gd-wood-board')
        ? (1 - spot.rx) * fRect.width * Math.sin(0.95 * (Math.PI / 180))
        : 0;
    const screenX = fRect.left + fRect.width * spot.rx;
    const screenY = fRect.top + spot.yOffset + tiltOffset;
    return {
      x: (screenX - origin.perchScreenX) / origin.scale,
      y: (screenY - origin.perchScreenY) / origin.scale,
    };
  };

  const pickNextFrameSpot = (): FrameSpotDef | null => {
    const origin = getOriginMetrics();
    const viewH = typeof window !== 'undefined' ? window.innerHeight : 800;
    for (let i = 0; i < FRAME_SPOTS.length; i++) {
      const idx = (frameSpotIdx + i) % FRAME_SPOTS.length;
      const candidate = FRAME_SPOTS[idx];
      const coords = getFrameSpotCoords(candidate);
      if (coords) {
        const screenY = coords.y * origin.scale + origin.perchScreenY;
        if (screenY > 28 && screenY < viewH - 36) {
          frameSpotIdx = (idx + 1) % FRAME_SPOTS.length;
          return candidate;
        }
      }
    }
    return null;
  };

  const setWingPose = (nearDeg: number, farDeg: number, scaleY: number, tailAngle: number) => {
    if (nearWing) {
      nearWing.style.transform = `rotate(${nearDeg.toFixed(1)}deg) scaleY(${scaleY.toFixed(2)})`;
    }
    if (farWing) {
      farWing.style.transform = `rotate(${farDeg.toFixed(1)}deg) scaleY(${(scaleY * 0.94).toFixed(2)})`;
    }
    if (tailEl) {
      tailEl.style.transform = `rotate(${tailAngle.toFixed(1)}deg)`;
    }
  };

  const syncChirpBubblePos = (extraY = 0) => {
    if (chirpEl && chirpEl.classList.contains('is-visible')) {
      chirpEl.style.left = `${(x + 34).toFixed(1)}px`;
      chirpEl.style.top = `${(y + 5 + extraY).toFixed(1)}px`;
    }
  };

  const launchFromCurrentSpot = (dirX = facing) => {
    activeFrameSpot = null;
    perchedUntil = 0;
    facing = dirX >= 0 ? 1 : -1;
    heading = facing >= 0 ? -0.68 : -(Math.PI - 0.68);
    speed = 185;
    vx = Math.cos(heading) * speed;
    vy = Math.sin(heading) * speed;
    birdEl.classList.add('is-flying');
  };

  const step = (ts: number) => {
    if (typeof document !== 'undefined' && !document.contains(lanternBtn)) {
      rafId = null;
      if (chirpHideTimer) clearTimeout(chirpHideTimer);
      return;
    }

    const dt = lastTs ? Math.min(0.04, (ts - lastTs) / 1000) : 0.016;
    lastTs = ts;

    const lit = lanternBtn.classList.contains('is-lit');
    const distHome = Math.hypot(x, y);

    if (lit) {
      // 1. Perched & resting happily on a wooden frame before flying onward
      if (perchedUntil > 0 && activeFrameSpot && !swoopTarget) {
        if (ts < perchedUntil) {
          const coords = getFrameSpotCoords(activeFrameSpot);
          if (coords) {
            x = coords.x;
            y = coords.y;
          }
          const perchAge = 3.3 - (perchedUntil - ts) / 1000;
          // Playful tiny perch hop right as it settles onto the frame
          const hopPulse =
            perchAge > 0.25 && perchAge < 0.53
              ? -Math.sin(((perchAge - 0.25) / 0.28) * Math.PI) * 5.0
              : 0;
          if (perchAge > 0.2 && hopSeed === 0) {
            hopSeed = 1;
            triggerChirp(activeFrameSpot.getPerchMessage(), 2700);
          }
          const idleBob = Math.sin(perchAge * 3.4) * 1.2;
          returnClock = 0;
          birdEl.classList.remove('is-flying');
          setWingPose(0, 0, 1, Math.sin(perchAge * 4.5) * 4);
          facing = activeFrameSpot.faceDir;
          birdEl.style.transform = `translate(${x.toFixed(2)}px, ${(y + hopPulse).toFixed(2)}px) scaleX(${facing}) rotate(${idleBob.toFixed(1)}deg)`;
          syncChirpBubblePos(hopPulse);
          syncSharedBirdState();
          rafId = requestAnimationFrame(step);
          return;
        }
        // Take off from wooden frame into the sky!
        const prevDir = activeFrameSpot.faceDir;
        if (
          activeFrameSpot.selector.includes('gd-wood-board') &&
          typeof window !== 'undefined' &&
          typeof CustomEvent === 'function'
        ) {
          window.dispatchEvent(new CustomEvent('gd-nightwatch-bell-ring'));
        }
        launchFromCurrentSpot(prevDir);
        hopSeed = 0;
        legsBeforeLand = 1;
        nextChirpAt = flightClock + 2.6 + Math.random() * 1.8;
      }

      birdEl.classList.add('is-flying');
      flightClock += dt;

      let tx: number;
      let ty: number;
      let targetSpeed: number;
      let landingToFrame = false;

      if (swoopTarget && ts < swoopTarget.until) {
        tx = swoopTarget.x;
        ty = swoopTarget.y;
        targetSpeed = 245;
        activeFrameSpot = null;
      } else {
        swoopTarget = null;
        if (activeFrameSpot) {
          const frameCoords = getFrameSpotCoords(activeFrameSpot);
          if (frameCoords) {
            tx = frameCoords.x;
            ty = frameCoords.y;
            targetSpeed = 165;
            landingToFrame = true;
          } else {
            activeFrameSpot = null;
            tx = 200;
            ty = 40;
            targetSpeed = 185;
          }
        } else {
          const bounds = getPageBounds();
          const wp = SKY_WAYPOINTS[waypointIdx];
          tx =
            bounds.minX +
            (bounds.maxX - bounds.minX) * wp.rx +
            Math.sin(jitterSeed + waypointIdx * 1.9) * 26;
          ty =
            bounds.minY +
            (bounds.maxY - bounds.minY) * wp.ry +
            Math.cos(jitterSeed * 1.3 + waypointIdx * 2.1) * 18;
          targetSpeed = wp.speed;
        }
      }

      const dx = tx - x;
      const dy = ty - y;
      const dist = Math.hypot(dx, dy);

      // Arriving onto wooden frame perch cleanly with flare!
      if (landingToFrame && dist < 10) {
        x = tx;
        y = ty;
        vx = 0;
        vy = 0;
        pitch = 0;
        turnBlend = 0;
        hopSeed = 0;
        returnClock = 0;
        perchedUntil = ts + 3300 + Math.random() * 500;
        facing = activeFrameSpot!.faceDir;
        birdEl.classList.remove('is-flying');
        setWingPose(0, 0, 1, 0);
        birdEl.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scaleX(${facing}) rotate(0deg)`;
        syncChirpBubblePos();
        syncSharedBirdState();
        rafId = requestAnimationFrame(step);
        return;
      }

      if (!swoopTarget && !activeFrameSpot && dist < 62) {
        const arrivedWp = SKY_WAYPOINTS[waypointIdx];
        waypointIdx = (waypointIdx + 1) % SKY_WAYPOINTS.length;
        if (waypointIdx === 0) jitterSeed += 1.4;
        if (arrivedWp.chirp && flightClock >= nextChirpAt - 0.8) {
          triggerChirp(arrivedWp.chirp);
          nextChirpAt = flightClock + 3.2 + Math.random() * 2.2;
        }
        legsBeforeLand -= 1;
        if (legsBeforeLand <= 0) {
          activeFrameSpot = pickNextFrameSpot();
          if (!activeFrameSpot) legsBeforeLand = 2;
        }
      }

      if (flightClock >= nextChirpAt && !landingToFrame) {
        triggerChirp();
        nextChirpAt = flightClock + 3.5 + Math.random() * 2.2;
      }

      // Continuous curved angular steering (prevents midair hovering & 2D flip squishes)
      const desiredHeading = Math.atan2(dy, dx);
      const headingDiff = normalizeAngle(desiredHeading - heading);
      const maxTurn = landingToFrame && dist < 130 ? 7.8 : swoopTarget ? 4.4 : 2.75;
      const turnRate = Math.max(-maxTurn, Math.min(maxTurn, headingDiff * (landingToFrame ? 6.2 : 3.6)));
      heading = normalizeAngle(heading + turnRate * dt);

      // Speed adjusts naturally for climbs/dives and landing deceleration
      const climbMod = 1 + Math.sin(heading) * 0.24;
      const desiredAirspeed =
        landingToFrame && dist < 110
          ? Math.max(42, dist * 1.45)
          : targetSpeed * climbMod;
      speed += (desiredAirspeed - speed) * Math.min(1, dt * 3.8);

      vx = Math.cos(heading) * speed;
      vy = Math.sin(heading) * speed;
      x += vx * dt;
      y += vy * dt;

      // Facing uses hysteresis across vertical curves (±0.22) so no thin 2D card squish occurs!
      const cosH = Math.cos(heading);
      if (facing === 1 && cosH < -0.22) {
        facing = -1;
      } else if (facing === -1 && cosH > 0.22) {
        facing = 1;
      }

      const bankStrength = Math.min(1, Math.abs(turnRate) / 2.2);
      turnBlend += (bankStrength - turnBlend) * Math.min(1, dt * 8);

      // Bounding flight vs banked wing-spread turn vs landing flare
      const isFlaringToFrame = landingToFrame && dist < 85;
      const cyclePos = flightClock % 2.25;
      const isGliding = !isFlaringToFrame && cyclePos > 1.35 && vy > -25 && bankStrength < 0.55;

      if (isFlaringToFrame) {
        wingPhase += dt * 30;
        const stroke = Math.sin(wingPhase);
        setWingPose(stroke * 40 - 18, stroke * 36 - 24, 0.72 + stroke * 0.42, 10);
      } else if (isGliding) {
        setWingPose(-11, -18, 0.76, 3);
      } else {
        wingPhase += dt * (25 + bankStrength * 3);
        const stroke = Math.sin(wingPhase);
        // During sharp banked turns, open far & near wings in dihedral spread so turn looks 3D
        const nearDeg = stroke * (46 - bankStrength * 14) - 9 - bankStrength * 10;
        const farDeg = stroke * (38 - bankStrength * 12) - 16 - bankStrength * 16;
        const flapScale = 0.66 + stroke * 0.46;
        setWingPose(nearDeg, farDeg, flapScale, -stroke * 5 + bankStrength * 7);
      }

      // Align body rotation cleanly with curved heading along current facing
      const horizSpeed = Math.max(24, Math.abs(vx));
      const targetPitch = isFlaringToFrame
        ? -18 * (1 - dist / 85)
        : Math.max(-68, Math.min(68, Math.atan2(vy, horizSpeed) * (180 / Math.PI) * 0.85));
      pitch += (targetPitch - pitch) * Math.min(1, dt * 11);

      const subtlePerspective = 1 - turnBlend * 0.14;
      returnClock = 0;
      birdEl.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scaleX(${(facing * subtlePerspective).toFixed(3)}) rotate(${pitch.toFixed(1)}deg)`;
      syncChirpBubblePos();
      syncSharedBirdState();
      rafId = requestAnimationFrame(step);
      return;
    }

    // Extinguished: clear active targets/perches and fly smoothly & reliably back to lantern perch
    swoopTarget = null;
    if (perchedUntil > 0 || activeFrameSpot) {
      launchFromCurrentSpot(x > 0 ? -1 : 1);
    }

    if (distHome > 3.0) {
      flightClock += dt;
      returnClock += dt;
      birdEl.classList.add('is-flying');

      const desiredHeading = Math.atan2(-y, -x);
      const headingDiff = normalizeAngle(desiredHeading - heading);
      const maxTurn = distHome < 75 ? 11.5 : 7.5;
      const turnRate = Math.max(-maxTurn, Math.min(maxTurn, headingDiff * 6.5));
      heading = normalizeAngle(heading + turnRate * dt);

      const align = Math.max(0.28, Math.cos(headingDiff * 0.55));
      const baseSpeed =
        distHome > 180
          ? 275
          : distHome > 95
            ? 235
            : Math.max(20, distHome * 2.5);
      const targetSpeed = baseSpeed * align;
      speed += (targetSpeed - speed) * Math.min(1, dt * 6.5);
      vx = Math.cos(heading) * speed;
      vy = Math.sin(heading) * speed;

      // Smooth terminal glide pull inside 40px so bird never orbits (0, 0)
      if (distHome < 40 || returnClock > 3.2) {
        const pull = distHome < 40 ? 1 - distHome / 40 : 0.45;
        const glideSpeed = returnClock > 3.2 ? Math.max(baseSpeed, 240) : baseSpeed;
        const hx = (-x / distHome) * glideSpeed;
        const hy = (-y / distHome) * glideSpeed;
        const blend = Math.min(1, pull * 0.7 + dt * 8);
        vx += (hx - vx) * blend;
        vy += (hy - vy) * blend;
      }

      x += vx * dt;
      y += vy * dt;

      const cosH = Math.cos(heading);
      if (distHome < 26) {
        facing = 1;
      } else if (facing === 1 && cosH < -0.22) {
        facing = -1;
      } else if (facing === -1 && cosH > 0.22) {
        facing = 1;
      }

      wingPhase += dt * (distHome < 75 ? 30 : 24);
      const stroke = Math.sin(wingPhase);
      setWingPose(stroke * 40 - 16, stroke * 34 - 20, 0.72 + stroke * 0.4, distHome < 75 ? 10 : 4);

      const horizSpeed = Math.max(24, Math.abs(vx));
      const flarePitch =
        distHome < 68
          ? -16 * (1 - distHome / 68)
          : Math.max(-55, Math.min(55, Math.atan2(vy, horizSpeed) * (180 / Math.PI) * 0.75));
      pitch = flarePitch;
      birdEl.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scaleX(${facing}) rotate(${flarePitch.toFixed(1)}deg)`;
      syncChirpBubblePos();
      syncSharedBirdState();
      rafId = requestAnimationFrame(step);
      return;
    }

    // Landed softly on lantern arm
    x = 0;
    y = 0;
    vx = 0;
    vy = 0;
    heading = -0.35;
    speed = 170;
    facing = 1;
    pitch = 0;
    turnBlend = 0;
    flightClock = 0;
    returnClock = 0;
    waypointIdx = 0;
    activeFrameSpot = null;
    perchedUntil = 0;
    swoopTarget = null;
    syncSharedBirdState();
    birdEl.classList.remove('is-flying');
    birdEl.style.transform = 'translate(0px, 0px) scaleX(1) rotate(0deg)';
    setWingPose(0, 0, 1, 0);
    if (chirpEl) chirpEl.classList.remove('is-visible');
    rafId = null;
    lastTs = 0;
  };

  const ensureRunning = () => {
    if (rafId === null) {
      lastTs = 0;
      rafId = requestAnimationFrame(step);
    }
  };

  if (Math.hypot(x, y) > 3.0) {
    birdEl.classList.add('is-flying');
    birdEl.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scaleX(${facing}) rotate(${pitch.toFixed(1)}deg)`;
    ensureRunning();
  } else if (sharedLanternLit) {
    ensureRunning();
  }

  lanternBtn.addEventListener('click', () => {
    if (lanternBtn.classList.contains('is-lit')) {
      returnClock = 0;
      if (Math.hypot(x, y) <= 4) {
        heading = -0.55;
        speed = 195;
        vx = Math.cos(heading) * speed;
        vy = Math.sin(heading) * speed;
      }
      waypointIdx = 0;
      legsBeforeLand = 1;
      activeFrameSpot = null;
      perchedUntil = 0;
      nextChirpAt = flightClock + 2.8;
      triggerChirp('Tweet-tweet! ♪');
    } else {
      returnClock = 0;
      swoopTarget = null;
    }
    ensureRunning();
  });

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    const onSwoop = (ev: Event) => {
      if (!lanternBtn.classList.contains('is-lit') || !document.contains(lanternBtn)) return;
      const detail = (ev as CustomEvent<{ clientX: number; clientY: number }>).detail;
      if (!detail) return;
      const rect = lanternBtn.getBoundingClientRect();
      if (perchedUntil > 0 || activeFrameSpot) {
        launchFromCurrentSpot(detail.clientX - rect.left - 34 > x ? 1 : -1);
      }
      swoopTarget = {
        x: detail.clientX - rect.left - 34,
        y: detail.clientY - rect.top - 14,
        until: performance.now() + 1050,
      };
      triggerChirp('♪ Chirp!');
      ensureRunning();
    };
    window.addEventListener('gd-lantern-bird-swoop', onSwoop);
  }
}

/**
 * Ambient drifting golden fireflies overlay shown across the workspace when the
 * header lantern is lit (.gd-lantern-ambience-on). Nearby fireflies gently swirl
 * toward the user's cursor beam without blocking clicks.
 */
export function createLanternFirefliesOverlay(): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'gd-lantern-fireflies';
  overlay.setAttribute('aria-hidden', 'true');

  interface FireflyNode {
    el: HTMLSpanElement;
    x: number;
    y: number;
    vx: number;
    vy: number;
    phase: number;
    freq: number;
  }

  const COUNT = 14;
  const widthInit = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const heightInit = typeof window !== 'undefined' ? window.innerHeight : 760;
  const flies: FireflyNode[] = [];
  for (let i = 1; i <= COUNT; i++) {
    const fly = document.createElement('span');
    fly.className = `gd-firefly gd-firefly-${((i - 1) % 10) + 1}`;
    const x = 140 + ((i * 97) % Math.max(400, widthInit - 180));
    const y = 70 + ((i * 73) % Math.max(320, heightInit - 140));
    fly.style.left = `${x.toFixed(1)}px`;
    fly.style.top = `${y.toFixed(1)}px`;
    overlay.appendChild(fly);
    flies.push({
      el: fly,
      x,
      y,
      vx: ((i % 2 === 0 ? 1 : -1) * (10 + (i % 4) * 5)),
      vy: ((i % 3 === 0 ? -1 : 1) * (8 + (i % 3) * 4)),
      phase: i * 1.15,
      freq: 0.7 + (i % 5) * 0.25,
    });
  }

  if (typeof window !== 'undefined' && typeof requestAnimationFrame === 'function') {
    let cursorX = -999;
    let cursorY = -999;
    let clock = 0;
    let lastTs = 0;
    let rafId: number | null = null;

    const onMove = (e: MouseEvent) => {
      cursorX = e.clientX;
      cursorY = e.clientY;
    };
    window.addEventListener('mousemove', onMove, { passive: true });

    const step = (ts: number) => {
      if (typeof document !== 'undefined' && !document.contains(overlay)) {
        window.removeEventListener('mousemove', onMove);
        rafId = null;
        return;
      }
      const dt = lastTs ? Math.min(0.04, (ts - lastTs) / 1000) : 0.016;
      lastTs = ts;
      const appLit = Boolean(document.querySelector('.gd-dashboard-app.gd-lantern-ambience-on'));
      if (appLit) {
        clock += dt;
        const w = Math.max(360, window.innerWidth);
        const h = Math.max(360, window.innerHeight);
        for (const f of flies) {
          f.vx += Math.cos(clock * f.freq + f.phase) * 18 * dt;
          f.vy += Math.sin(clock * f.freq * 1.15 + f.phase) * 16 * dt;

          // Interactive cursor firefly herding in overlay-local coordinates
          if (cursorX > 0) {
            const oRect = overlay.getBoundingClientRect();
            const localCX = cursorX - oRect.left;
            const localCY = cursorY - oRect.top;
            const dx = localCX - f.x;
            const dy = localCY - f.y;
            const d = Math.hypot(dx, dy);
            if (d > 24 && d < 240) {
              const pull = (1 - d / 240) * 76;
              // Gentle tangential swirl + warm magnetic draw
              f.vx += ((dx / d) * pull - (dy / d) * 32) * dt;
              f.vy += ((dy / d) * pull + (dx / d) * 32) * dt;
            }
          }

          f.vx *= Math.pow(0.45, dt);
          f.vy *= Math.pow(0.45, dt);
          f.x += f.vx * dt;
          f.y += f.vy * dt;

          if (f.x < 40) f.x = w - 40;
          else if (f.x > w - 30) f.x = 50;
          if (f.y < 30) f.y = h - 40;
          else if (f.y > h - 30) f.y = 40;

          f.el.style.left = `${f.x.toFixed(1)}px`;
          f.el.style.top = `${f.y.toFixed(1)}px`;
        }
      }
      rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);
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
 * Sentinel Brass Mail Dispatch Box sitting on top of the 02 / Approvals frame.
 * Red flag rises when pendingCount > 0; slot glows warm amber when lantern is lit.
 */
export function createApprovalsMailboxProp(pendingCount: number, onOpen?: () => void): HTMLElement {
  const hasMail = pendingCount > 0;
  const boxBtn = document.createElement('button');
  boxBtn.type = 'button';
  boxBtn.className = `gd-prop-btn gd-prop-mailbox${hasMail ? ' has-mail' : ''}`;
  boxBtn.setAttribute(
    'aria-label',
    hasMail ? `${pendingCount} requests waiting in approvals dispatch box` : 'Approvals dispatch box'
  );
  boxBtn.title = hasMail ? `${pendingCount} pending — click to review` : 'Approvals dispatch box (All clear)';
  boxBtn.tabIndex = -1;
  boxBtn.innerHTML = `
    <svg class="gd-prop-svg" width="46" height="38" viewBox="0 0 46 38" fill="none" xmlns="http://www.w3.org/2000/svg">
      <!-- Wooden mounting foot -->
      <rect x="11" y="31" width="24" height="5" rx="1" fill="#5D442B" stroke="#2D1E10" stroke-width="1.2"/>
      <!-- Archival Oak & Brass Postbox Body -->
      <path d="M10 15 C10 8, 36 8, 36 15 L36 31 L10 31 Z" fill="#7A5B3A" stroke="#2D1E10" stroke-width="1.3"/>
      <path d="M12 15 C12 10.2, 34 10.2, 34 15 L34 17 L12 17 Z" fill="#9A7952" opacity="0.65"/>
      <!-- Brass trim band & mail chute -->
      <rect x="9" y="18" width="28" height="2.6" rx="0.8" fill="#D9A44E" stroke="#3E280B" stroke-width="0.9"/>
      <rect x="15" y="21.5" width="16" height="3.2" rx="1" fill="#2A1C10"/>
      <!-- Warm candlelit mail slot glow when lantern is on -->
      <rect class="gd-mailbox-glow" x="16" y="22.1" width="14" height="2" rx="0.7" fill="#FFE07D"/>
      <!-- Corner brass nameplate -->
      <rect x="18" y="26.5" width="10" height="3" rx="0.7" fill="#E5BA5C" stroke="#4A320F" stroke-width="0.7"/>
      <!-- Pivoting Red Enamel Sentinel Flag -->
      <g class="gd-mailbox-flag" style="transform-origin: 35px 25px;">
        <rect x="34.2" y="9" width="2.2" height="16" rx="1" fill="#D9A44E" stroke="#3E280B" stroke-width="0.8"/>
        <path d="M36 9 L44 9 L42.5 14 L36 14 Z" fill="#C94A38" stroke="#4A1A14" stroke-width="0.85"/>
        <circle cx="35.3" cy="25" r="1.8" fill="#FCE28B" stroke="#3E280B" stroke-width="0.8"/>
      </g>
    </svg>
  `;
  boxBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    boxBtn.classList.remove('is-checked');
    void boxBtn.offsetWidth;
    boxBtn.classList.add('is-checked');
    onOpen?.();
  });
  return boxBtn;
}

/**
 * Watchman's Iron Brazier & Candle Sconce on the top-left of Recent Activity.
 * Remains cold charcoal unlit; auto-ignites with crackling flames & sparks when lantern lights.
 */
export function createActivitySconceProp(): HTMLElement {
  const sconceBtn = document.createElement('button');
  sconceBtn.type = 'button';
  sconceBtn.className = 'gd-prop-btn gd-prop-activity-sconce';
  sconceBtn.setAttribute('aria-label', 'Watchman hearth sconce');
  sconceBtn.title = 'Click to stoke embers';
  sconceBtn.tabIndex = -1;
  sconceBtn.innerHTML = `
    <span class="gd-sconce-halo" aria-hidden="true"></span>
    <span class="gd-sconce-sparks" aria-hidden="true">
      <span class="gd-sconce-spark gd-sconce-spark-1"></span>
      <span class="gd-sconce-spark gd-sconce-spark-2"></span>
      <span class="gd-sconce-spark gd-sconce-spark-3"></span>
    </span>
    <svg class="gd-prop-svg" width="44" height="44" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">
      <!-- Iron brazier pedestal & rim -->
      <path d="M13 38 L31 38 L27 33 L17 33 Z" fill="#3B322A" stroke="#1E1812" stroke-width="1.2"/>
      <path d="M11 26 L33 26 L29 33 L15 33 Z" fill="#2F2924" stroke="#1E1812" stroke-width="1.3"/>
      <rect x="9" y="24" width="26" height="3.2" rx="1.2" fill="#4A4139" stroke="#1E1812" stroke-width="1.2"/>
      <!-- Brass trim rivets -->
      <circle cx="16" cy="29.5" r="1.1" fill="#D9A44E"/>
      <circle cx="22" cy="29.5" r="1.1" fill="#D9A44E"/>
      <circle cx="28" cy="29.5" r="1.1" fill="#D9A44E"/>
      <!-- Charcoal ember bed -->
      <path d="M14 24 C16 20.5, 28 20.5, 30 24 Z" fill="#241D17" stroke="#18120D" stroke-width="0.9"/>
      <!-- Animated Hearth Flames (visible when lantern lights or stoked) -->
      <g class="gd-sconce-flames" style="transform-origin: 22px 24px;">
        <path d="M15 24 C15 16, 20 11, 22 7 C24 11, 29 16, 29 24 Z" fill="#F28A2E"/>
        <path d="M18 24 C18 18, 20.5 14, 22 11 C23.5 14, 26 18, 26 24 Z" fill="#FFD666"/>
        <path d="M20.2 24 C20.2 20, 21.5 17, 22 15 C22.5 17, 23.8 20, 23.8 24 Z" fill="#FFF7D4"/>
      </g>
    </svg>
  `;
  sconceBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    sconceBtn.classList.remove('is-stoked');
    void sconceBtn.offsetWidth;
    sconceBtn.classList.add('is-stoked');
    setTimeout(() => sconceBtn.classList.remove('is-stoked'), 1100);
  });
  return sconceBtn;
}

/**
 * Hand-Blown Edo-Glass Japanese Fūrin (風鈴) wind chime hanging beneath the wooden greeting sign.
 * Brushing your cursor past it or clicking sets the glass dome, interior porcelain clapper,
 * and washi tanzaku strip swinging with coupled 3-body pendulum physics, glass-rim
 * collision detection, and clear pentatonic glass tones.
 */
export function createWoodBoardFurinProp(): HTMLElement {
  const furinBtn = document.createElement('button');
  furinBtn.type = 'button';
  furinBtn.className = 'gd-prop-btn gd-prop-board-furin';
  furinBtn.setAttribute('aria-label', 'Ring Japanese glass wind chime');
  furinBtn.title = 'Brush cursor across chime or click to ring';
  furinBtn.tabIndex = -1;

  interface FurinSpec {
    cx: number;
    cordEndY: number;
    domeR: number;
    domeH: number;
    stripH: number;
    freq: number;
    glassGrad: string;
    rimStroke: string;
    cordStroke: string;
    motif: string;
    naturalStiff: number;
    stripStiff: number;
  }

  const SVG_W = 66;
  const SVG_H = 98;

  const FURIN_SPECS: FurinSpec[] = [
    {
      // Hand-blown Sky-Celadon Goldfish (Edo Kingyo) Fūrin
      cx: 33,
      cordEndY: 13.5,
      domeR: 13.8,
      domeH: 23.5,
      stripH: 43,
      freq: 1760.0,
      glassGrad: 'gd-furin-glass-celadon',
      rimStroke: 'rgba(64, 98, 104, 0.72)',
      cordStroke: '#B83123',
      naturalStiff: 25,
      stripStiff: 19,
      motif: `
        <!-- Inner hand-painted waterweed fronds (matsumo) -->
        <path d="M39.5 34.5 C38.6 29.5, 40.4 25.0, 42.4 21.8" stroke="#4D7556" stroke-width="1.05" stroke-linecap="round" opacity="0.72"/>
        <path d="M38.2 35.0 C37.0 31.2, 37.5 27.5, 39.0 24.8" stroke="#648D69" stroke-width="0.8" stroke-linecap="round" opacity="0.62"/>
        <!-- Hand-painted Edo Kingyo (Calico Goldfish) with flowing fins -->
        <path d="M23.5 28.0 C21.2 26.8, 19.8 25.4, 20.6 24.4 C21.6 25.3, 22.8 26.4, 24.2 27.3 Z" fill="#E96B52" opacity="0.74"/>
        <path d="M23.3 28.4 C20.8 28.8, 19.4 29.8, 20.5 30.9 C21.8 30.1, 22.8 29.2, 24.1 28.7 Z" fill="#D94B34" opacity="0.76"/>
        <ellipse cx="27.2" cy="26.8" rx="3.4" ry="1.85" transform="rotate(-18 27.2 26.8)" fill="#E2523A" opacity="0.86"/>
        <ellipse cx="26.8" cy="26.2" rx="1.6" ry="0.7" transform="rotate(-18 26.8 26.2)" fill="#F99F84" opacity="0.68"/>
        <circle cx="29.4" cy="25.9" r="0.45" fill="#1E2321" opacity="0.85"/>
        <!-- Tiny rising glass air bubbles -->
        <circle cx="32.2" cy="22.8" r="0.65" fill="#FFFFFF" opacity="0.72"/>
        <circle cx="33.5" cy="20.4" r="0.45" fill="#FFFFFF" opacity="0.64"/>
      `,
    },
  ];

  const wavesHtml = FURIN_SPECS.map(
    (s, i) =>
      `<span class="gd-furin-wave" data-wave-idx="${i}" style="left:${s.cx}px;top:${(s.cordEndY + s.domeH * 0.48).toFixed(1)}px;" aria-hidden="true"></span>`
  ).join('');

  const chimesSvg = FURIN_SPECS.map((s, i) => {
    const cx = s.cx;
    const dTop = s.cordEndY;
    const dBot = dTop + s.domeH;
    const rx = s.domeR;
    const mouthRx = rx * 0.85;
    const mouthRy = 3.5;
    const clapY = dBot - 2.4;
    const stripTop = dBot + 7.2;
    const stripBot = stripTop + s.stripH;
    const stripHalfW = 5.4;

    return `
      <!-- Aged forged-brass ceiling screw-eye anchoring beneath the wood rim -->
      <rect x="${cx - 4.4}" y="0" width="8.8" height="3.2" rx="1.1" fill="#3B2D20" stroke="#1E160E" stroke-width="0.85"/>
      <line x1="${cx - 3.2}" y1="1.1" x2="${cx + 3.2}" y2="1.1" stroke="#8C6A3A" stroke-width="0.6" opacity="0.65"/>
      <circle cx="${cx}" cy="4.8" r="1.8" fill="none" stroke="url(#gd-furin-brass)" stroke-width="1.2"/>

      <!-- Link 1: Open-mouthed Edo-Glass Bell (${i}) -->
      <g class="gd-furin-dome" data-chime-idx="${i}" style="transform-origin: ${cx}px 4.8px;">
        <rect x="${cx - rx - 4}" y="3" width="${(rx + 4) * 2}" height="${stripBot}" fill="transparent"/>
        <!-- Braided vermilion kumihimo cord & glazed ceramic stopper bead -->
        <line x1="${cx}" y1="5.8" x2="${cx}" y2="${dTop + 0.5}" stroke="${s.cordStroke}" stroke-width="1.45" stroke-linecap="round"/>
        <circle cx="${cx}" cy="${dTop - 1.1}" r="1.9" fill="url(#gd-furin-bead)" stroke="#2E4B52" stroke-width="0.65"/>
        <circle cx="${cx - 0.55}" cy="${dTop - 1.65}" r="0.55" fill="#FFFFFF" opacity="0.8"/>

        <!-- Back Interior Wall & Hollow Open-Bottom Rim (visible behind clapper) -->
        <path d="M${cx} ${dTop} C${cx - rx * 0.68} ${dTop + 0.6}, ${cx - rx} ${dTop + s.domeH * 0.36}, ${cx - rx} ${dBot - 4.5} C${cx - rx} ${dBot - 2.0}, ${cx - mouthRx} ${dBot - 0.6}, ${cx - mouthRx} ${dBot} A${mouthRx.toFixed(2)} ${mouthRy} 0 0 0 ${cx + mouthRx} ${dBot} C${cx + mouthRx} ${dBot - 0.6}, ${cx + rx} ${dBot - 2.0}, ${cx + rx} ${dBot - 4.5} C${cx + rx} ${dTop + s.domeH * 0.36}, ${cx + rx * 0.68} ${dTop + 0.6}, ${cx} ${dTop} Z" fill="url(#${s.glassGrad})"/>
        <path d="M${cx - mouthRx} ${dBot} A${mouthRx.toFixed(2)} ${mouthRy} 0 0 1 ${cx + mouthRx} ${dBot}" stroke="rgba(54, 88, 94, 0.34)" stroke-width="0.85" fill="rgba(126, 178, 184, 0.14)"/>

        <!-- Link 2: Suspended Porcelain Clapper inside glass cavity -->
        <g class="gd-furin-clapper" data-clapper-idx="${i}" style="transform-origin: ${cx}px ${dTop + 1.5}px;">
          <line x1="${cx}" y1="${dTop + 1.2}" x2="${cx}" y2="${dBot + 2.2}" stroke="#9E2C1D" stroke-width="0.9" stroke-linecap="round"/>
          <!-- Glazed ceramic clapper bead with subtle specular spot -->
          <ellipse cx="${cx}" cy="${clapY}" rx="2.35" ry="2.65" fill="url(#gd-furin-clapper-glaze)" stroke="#755226" stroke-width="0.72"/>
          <circle cx="${cx - 0.7}" cy="${clapY - 0.85}" r="0.75" fill="#FFFFFF" opacity="0.88"/>

          <!-- Link 3: Echizen Washi Paper Tanzaku Strip -->
          <g class="gd-furin-tanzaku" data-strip-idx="${i}" style="transform-origin: ${cx}px ${dBot + 2.2}px;">
            <line x1="${cx}" y1="${dBot + 2.2}" x2="${cx}" y2="${stripTop}" stroke="#A63222" stroke-width="0.9" stroke-linecap="round"/>
            <!-- Washi paper slip with subtle 3D fold shading & deckle bottom -->
            <path d="M${cx - stripHalfW} ${stripTop} L${cx + stripHalfW} ${stripTop} L${cx + stripHalfW + 0.35} ${stripBot - 1.2} Q${cx + 2.2} ${stripBot + 0.6}, ${cx} ${stripBot - 1.5} Q${cx - 2.4} ${stripBot + 0.5}, ${cx - stripHalfW - 0.2} ${stripBot - 0.8} Z" fill="url(#gd-furin-washi)" stroke="#B7A07B" stroke-width="0.78" stroke-linejoin="round"/>
            <!-- Subtle glass-mouth shadow cast across top of washi paper -->
            <rect x="${cx - stripHalfW + 0.5}" y="${stripTop + 0.4}" width="${(stripHalfW * 2 - 1).toFixed(1)}" height="3.2" fill="rgba(78, 68, 52, 0.12)"/>
            <!-- Sumi-e indigo mist brush strokes -->
            <path d="M${cx - stripHalfW + 1.5} ${stripTop + 13} Q${cx - 0.6} ${stripTop + 11.2}, ${cx + stripHalfW - 1.4} ${stripTop + 13.6}" stroke="rgba(76, 124, 138, 0.40)" stroke-width="1.05" fill="none" stroke-linecap="round"/>
            <path d="M${cx - stripHalfW + 2.0} ${stripTop + 17.5} Q${cx + 0.5} ${stripTop + 16.0}, ${cx + stripHalfW - 1.8} ${stripTop + 18.2}" stroke="rgba(76, 124, 138, 0.25)" stroke-width="0.8" fill="none" stroke-linecap="round"/>
            <!-- Traditional cinnabar hanko seal stamp -->
            <rect x="${cx + 0.9}" y="${stripBot - 9.2}" width="3.0" height="3.0" rx="0.4" fill="#BA3524" opacity="0.86"/>
            <path d="M${cx + 1.6} ${stripBot - 8.2} H${cx + 3.2} M${cx + 2.4} ${stripBot - 8.5} V${stripBot - 6.8}" stroke="#FCF7EB" stroke-width="0.45" opacity="0.72"/>
            <!-- Tiny brass hatome paper grommet ring -->
            <circle cx="${cx}" cy="${stripTop + 2.0}" r="1.05" fill="#DFBE74" stroke="#85632B" stroke-width="0.55"/>
            <circle cx="${cx}" cy="${stripTop + 2.0}" r="0.45" fill="#8C2316"/>
          </g>
        </g>

        <!-- Night Watch warm amber inner light glow -->
        <ellipse class="gd-furin-amber-glow" cx="${cx}" cy="${dTop + s.domeH * 0.50}" rx="${(rx * 0.80).toFixed(1)}" ry="${(s.domeH * 0.39).toFixed(1)}" fill="url(#gd-furin-amber)"/>

        <!-- Hand-painted Edo goldfish & waterweed on inner glass wall -->
        ${s.motif}

        <!-- Front Hand-Blown Glass Refraction Shell & Specular Highlights -->
        <path d="M${cx} ${dTop} C${cx - rx * 0.68} ${dTop + 0.6}, ${cx - rx} ${dTop + s.domeH * 0.36}, ${cx - rx} ${dBot - 4.5} C${cx - rx} ${dBot - 2.0}, ${cx - mouthRx} ${dBot - 0.6}, ${cx - mouthRx} ${dBot} A${mouthRx.toFixed(2)} ${mouthRy} 0 0 0 ${cx + mouthRx} ${dBot} C${cx + mouthRx} ${dBot - 0.6}, ${cx + rx} ${dBot - 2.0}, ${cx + rx} ${dBot - 4.5} C${cx + rx} ${dTop + s.domeH * 0.36}, ${cx + rx * 0.68} ${dTop + 0.6}, ${cx} ${dTop} Z" fill="url(#gd-furin-glass-shell)" stroke="${s.rimStroke}" stroke-width="0.9"/>
        <!-- Primary window specular crescent -->
        <path d="M${cx - rx * 0.66} ${dTop + 4.4} C${cx - rx * 0.80} ${dTop + s.domeH * 0.38}, ${cx - rx * 0.78} ${dBot - 7.5}, ${cx - rx * 0.60} ${dBot - 3.6}" stroke="url(#gd-furin-spec)" stroke-width="2.1" stroke-linecap="round"/>
        <ellipse cx="${cx - rx * 0.44}" cy="${dTop + 3.4}" rx="1.6" ry="0.85" transform="rotate(-24 ${cx - rx * 0.44} ${dTop + 3.4})" fill="#FFFFFF" opacity="0.86"/>
        <!-- Secondary cool bounce catchlight on right cheek -->
        <path d="M${cx + rx * 0.70} ${dTop + 7.5} C${cx + rx * 0.80} ${dTop + s.domeH * 0.48}, ${cx + rx * 0.74} ${dBot - 6.5}, ${cx + rx * 0.56} ${dBot - 3.8}" stroke="rgba(232, 250, 250, 0.58)" stroke-width="1.15" stroke-linecap="round"/>
        <!-- Crisp beveled cut-glass front lip (kuchimoto) -->
        <path d="M${cx - mouthRx + 0.5} ${dBot + 0.2} A${mouthRx.toFixed(2)} ${mouthRy} 0 0 0 ${cx + mouthRx - 0.5} ${dBot + 0.2}" stroke="rgba(255, 255, 255, 0.78)" stroke-width="1.05" fill="none" stroke-linecap="round"/>
        <path d="M${cx - mouthRx} ${dBot + 0.6} A${mouthRx.toFixed(2)} ${mouthRy} 0 0 0 ${cx + mouthRx} ${dBot + 0.6}" stroke="rgba(54, 86, 92, 0.55)" stroke-width="0.85" fill="none" stroke-linecap="round"/>
      </g>
    `;
  }).join('');

  furinBtn.innerHTML = `
    ${wavesHtml}
    <svg class="gd-prop-svg" width="${SVG_W}" height="${SVG_H}" viewBox="0 0 ${SVG_W} ${SVG_H}" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="gd-furin-brass" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#E7C67A"/>
          <stop offset="55%" stop-color="#BA8E42"/>
          <stop offset="100%" stop-color="#765520"/>
        </linearGradient>
        <radialGradient id="gd-furin-bead" cx="35%" cy="30%" r="70%">
          <stop offset="0%" stop-color="#9BD0D6"/>
          <stop offset="55%" stop-color="#4B8B96"/>
          <stop offset="100%" stop-color="#27505A"/>
        </radialGradient>
        <radialGradient id="gd-furin-glass-celadon" cx="36%" cy="32%" r="70%">
          <stop offset="0%" stop-color="rgba(255, 255, 255, 0.30)"/>
          <stop offset="48%" stop-color="rgba(212, 240, 240, 0.42)"/>
          <stop offset="84%" stop-color="rgba(150, 202, 208, 0.56)"/>
          <stop offset="100%" stop-color="rgba(100, 154, 162, 0.64)"/>
        </radialGradient>
        <radialGradient id="gd-furin-glass-shell" cx="34%" cy="30%" r="72%">
          <stop offset="0%" stop-color="rgba(255, 255, 255, 0.16)"/>
          <stop offset="58%" stop-color="rgba(224, 246, 246, 0.08)"/>
          <stop offset="86%" stop-color="rgba(156, 206, 212, 0.34)"/>
          <stop offset="100%" stop-color="rgba(96, 150, 158, 0.52)"/>
        </radialGradient>
        <linearGradient id="gd-furin-spec" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="rgba(255, 255, 255, 0.94)"/>
          <stop offset="65%" stop-color="rgba(255, 255, 255, 0.58)"/>
          <stop offset="100%" stop-color="rgba(255, 255, 255, 0.12)"/>
        </linearGradient>
        <radialGradient id="gd-furin-clapper-glaze" cx="35%" cy="30%" r="70%">
          <stop offset="0%" stop-color="#FFF7DC"/>
          <stop offset="58%" stop-color="#EED192"/>
          <stop offset="100%" stop-color="#B98A42"/>
        </radialGradient>
        <radialGradient id="gd-furin-amber" cx="50%" cy="62%" r="60%">
          <stop offset="0%" stop-color="rgba(255, 224, 134, 0.72)"/>
          <stop offset="65%" stop-color="rgba(242, 184, 72, 0.32)"/>
          <stop offset="100%" stop-color="rgba(242, 184, 72, 0)"/>
        </radialGradient>
        <linearGradient id="gd-furin-washi" x1="0%" y1="0%" x2="100%" y2="6%">
          <stop offset="0%" stop-color="#FDF9EE"/>
          <stop offset="58%" stop-color="#F6ECD5"/>
          <stop offset="100%" stop-color="#E5D3AF"/>
        </linearGradient>
      </defs>
      ${chimesSvg}
    </svg>
  `;

  const domeEls = Array.from(furinBtn.querySelectorAll('.gd-furin-dome')) as SVGGElement[];
  const clapperEls = Array.from(furinBtn.querySelectorAll('.gd-furin-clapper')) as SVGGElement[];
  const tanzakuEls = Array.from(furinBtn.querySelectorAll('.gd-furin-tanzaku')) as SVGGElement[];
  const waveEls = Array.from(furinBtn.querySelectorAll('.gd-furin-wave')) as HTMLElement[];

  interface ChimeState {
    domeAngle: number;
    domeVel: number;
    clapAngle: number;
    clapVel: number;
    stripAngle: number;
    stripVel: number;
    lastChimeAt: number;
    lastBrushAt: number;
  }

  const states: ChimeState[] = FURIN_SPECS.map(() => ({
    domeAngle: 0,
    domeVel: 0,
    clapAngle: 0,
    clapVel: 0,
    stripAngle: 0,
    stripVel: 0,
    lastChimeAt: 0,
    lastBrushAt: 0,
  }));

  let breezeClock = 0;
  let lastTs = 0;
  let hasUserGesture = false;
  let furinRaf: number | null = null;
  let lastPointerX: number | null = null;
  let lastPointerY: number | null = null;

  const emitChimeWave = (idx: number, strength: number, withAudio: boolean) => {
    const waveEl = waveEls[idx];
    if (waveEl) {
      waveEl.classList.remove('is-ringing');
      void waveEl.offsetWidth;
      waveEl.classList.add('is-ringing');
    }
    if (withAudio) {
      const pitchShift = (Math.random() - 0.5) * 14;
      playJapaneseFurinChime(strength, pitchShift, FURIN_SPECS[idx].freq);
    }
  };

  const stepPhysics = (ts: number) => {
    if (typeof document !== 'undefined' && !document.contains(furinBtn)) {
      furinRaf = null;
      lastTs = 0;
      return;
    }

    const dt = lastTs ? Math.min(0.032, (ts - lastTs) / 1000) : 0.016;
    lastTs = ts;
    breezeClock += dt;

    for (let i = 0; i < FURIN_SPECS.length; i += 1) {
      const spec = FURIN_SPECS[i];
      const st = states[i];

      // Traveling organic night-breeze ripple from chime 0 -> 3
      const phaseShift = i * 0.65;
      const gentleBreeze =
        Math.sin(breezeClock * 0.92 - phaseShift) * 16 +
        Math.sin(breezeClock * 2.15 + phaseShift * 1.3) * 8 +
        Math.max(0, Math.sin(breezeClock * 0.36 - phaseShift * 0.5)) * 14;

      const stripForce = -spec.stripStiff * st.stripAngle + gentleBreeze + (st.clapAngle - st.domeAngle) * 5.5;
      st.stripVel = (st.stripVel + stripForce * dt) * Math.pow(0.20, dt);
      st.stripAngle += st.stripVel * dt;

      const clapPull = (st.stripAngle - st.clapAngle) * 14;
      const clapGrav = -spec.naturalStiff * 1.65 * st.clapAngle;
      st.clapVel = (st.clapVel + (clapGrav + clapPull) * dt) * Math.pow(0.46, dt);
      st.clapAngle += st.clapVel * dt;

      const domePull = (st.clapAngle - st.domeAngle) * 4.2 + gentleBreeze * 0.12;
      const domeGrav = -spec.naturalStiff * st.domeAngle;
      st.domeVel = (st.domeVel + (domeGrav + domePull) * dt) * Math.pow(0.42, dt);
      st.domeAngle += st.domeVel * dt;

      // Physical Glass Rim Impact
      const RIM_CLEARANCE = 10.2;
      const relAngle = st.clapAngle - st.domeAngle;
      if (Math.abs(relAngle) >= RIM_CLEARANCE) {
        const sign = relAngle >= 0 ? 1 : -1;
        st.clapAngle = st.domeAngle + sign * RIM_CLEARANCE;
        const relVel = (st.clapVel - st.domeVel) * sign;
        if (relVel > 0) {
          st.clapVel = st.domeVel - sign * relVel * 0.64;
          st.domeVel += sign * Math.min(46, relVel * 0.25);
          if (relVel > 24 && ts - st.lastChimeAt > 135) {
            st.lastChimeAt = ts;
            emitChimeWave(i, Math.min(1.15, relVel / 135), hasUserGesture);
          }
        }
      }
    }

    // Neighbor chime air-draft & physical rim bump when swinging strongly toward each other
    for (let i = 0; i < FURIN_SPECS.length - 1; i += 1) {
      const a = states[i];
      const b = states[i + 1];
      const overlap = a.domeAngle - b.domeAngle;
      if (overlap > 24) {
        const push = (overlap - 24) * 18 * dt;
        a.domeVel -= push;
        b.domeVel += push;
        a.stripVel -= push * 1.4;
        b.stripVel += push * 1.4;
      }
    }

    for (let i = 0; i < FURIN_SPECS.length; i += 1) {
      const st = states[i];
      st.domeAngle = Math.max(-24, Math.min(24, st.domeAngle));
      st.stripAngle = Math.max(-44, Math.min(44, st.stripAngle));

      const domeEl = domeEls[i];
      const clapperEl = clapperEls[i];
      const tanzakuEl = tanzakuEls[i];
      if (domeEl) domeEl.style.transform = `rotate(${st.domeAngle.toFixed(2)}deg)`;
      if (clapperEl) clapperEl.style.transform = `rotate(${(st.clapAngle - st.domeAngle).toFixed(2)}deg)`;
      if (tanzakuEl) {
        const skew = Math.max(-6, Math.min(6, st.stripVel * 0.032));
        const flutterScaleX = (1 - Math.min(0.14, Math.abs(st.stripVel) * 0.0005)).toFixed(3);
        tanzakuEl.style.transform = `rotate(${(st.stripAngle - st.clapAngle).toFixed(2)}deg) skewX(${skew.toFixed(2)}deg) scaleX(${flutterScaleX})`;
      }
    }

    furinRaf = requestAnimationFrame(stepPhysics);
  };

  const ensurePhysics = () => {
    if (furinRaf === null && typeof requestAnimationFrame === 'function') {
      lastTs = 0;
      furinRaf = requestAnimationFrame(stepPhysics);
    }
  };

  const strikeChime = (idx: number, dir = 1, strength = 1, withAudio = true) => {
    const st = states[idx];
    if (!st) return;
    if (withAudio) hasUserGesture = true;
    st.stripVel += dir * 245 * strength;
    st.clapVel -= dir * 195 * strength;
    st.domeVel += dir * 52 * strength;
    if (withAudio) {
      const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
      st.lastChimeAt = nowMs;
      emitChimeWave(idx, Math.min(1.15, strength), true);
    }
    ensurePhysics();
  };

  const playCascade = (dir = 1, strength = 0.95) => {
    hasUserGesture = true;
    const order = FURIN_SPECS.map((_, i) => i);
    if (dir < 0) order.reverse();
    order.forEach((chimeIdx, stepIdx) => {
      setTimeout(() => {
        if (typeof document !== 'undefined' && !document.contains(furinBtn)) return;
        strikeChime(chimeIdx, dir, strength - stepIdx * 0.06, true);
      }, stepIdx * 85);
    });
  };

  furinBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    hasUserGesture = true;
    const rect = typeof furinBtn.getBoundingClientRect === 'function' ? furinBtn.getBoundingClientRect() : null;
    if (rect && rect.width > 0 && typeof e.clientX === 'number' && e.clientX > 0) {
      const localX = ((e.clientX - rect.left) / rect.width) * SVG_W;
      let nearestIdx = 0;
      let bestDist = Infinity;
      FURIN_SPECS.forEach((s, idx) => {
        const d = Math.abs(localX - s.cx);
        if (d < bestDist) {
          bestDist = d;
          nearestIdx = idx;
        }
      });
      if (bestDist < 28) {
        strikeChime(nearestIdx, 1, 1.05, true);
        if (states[nearestIdx - 1]) strikeChime(nearestIdx - 1, -0.5, 0.35, false);
        if (states[nearestIdx + 1]) strikeChime(nearestIdx + 1, 0.5, 0.35, false);
        return;
      }
    }
    playCascade(1, 0.95);
  });

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    const unlockOnGesture = () => {
      hasUserGesture = true;
      ensureUnlockedBirdAudioCtx();
    };
    window.addEventListener('pointerdown', unlockOnGesture, { passive: true });
    window.addEventListener('keydown', unlockOnGesture, { passive: true });

    const onBellEvent = () => {
      if (!document.contains(furinBtn)) {
        window.removeEventListener('gd-nightwatch-bell-ring', onBellEvent);
        return;
      }
      playCascade(-1, 0.85);
    };
    window.addEventListener('gd-nightwatch-bell-ring', onBellEvent);

    const brushChimeAtPoint = (clientX: number, clientY: number, dxCursor: number, dyCursor: number, forceRing = false) => {
      const rect = furinBtn.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      if (
        clientX < rect.left - 28 ||
        clientX > rect.right + 28 ||
        clientY < rect.top - 16 ||
        clientY > rect.bottom + 24
      ) {
        return;
      }

      hasUserGesture = true;
      const scaleX = rect.width / SVG_W;
      const scaleY = rect.height / SVG_H;
      const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const moveMag = Math.hypot(dxCursor, dyCursor);
      const directionalDelta =
        Math.abs(dxCursor) >= 0.45 ? dxCursor : (clientX < rect.left + rect.width * 0.5 ? 5 : -5);
      const dir = directionalDelta >= 0 ? 1 : -1;
      const speedNorm = Math.min(1.18, Math.max(0.42, (forceRing ? Math.max(8, moveMag) : moveMag) / 13));

      for (let i = 0; i < FURIN_SPECS.length; i += 1) {
        const s = FURIN_SPECS[i];
        const chimeScreenX = rect.left + s.cx * scaleX;
        const chimeScreenY = rect.top + (s.cordEndY + (s.domeH + s.stripH) * 0.45) * scaleY;
        const distX = Math.abs(clientX - chimeScreenX);
        const distY = Math.abs(clientY - chimeScreenY);

        if (distX < 34 && distY < 60) {
          const prox = 1 - distX / 34;
          const st = states[i];
          const push = Math.max(-220, Math.min(220, directionalDelta * 10.5)) * prox;
          st.stripVel += push;
          st.clapVel += push * 0.45;
          st.domeVel += push * 0.16;

          // Sound crisp crystal chime when gliding cursor brushes past the bell or strip
          if ((distX < 25 || forceRing) && nowMs - st.lastBrushAt > 175) {
            st.lastBrushAt = nowMs;
            st.lastChimeAt = nowMs;
            emitChimeWave(i, 0.62 + 0.45 * speedNorm, true);
            st.clapVel -= dir * 145 * speedNorm;
          }
          ensurePhysics();
        }
      }
    };

    furinBtn.addEventListener('pointerenter', (ev) => {
      if (!document.contains(furinBtn)) return;
      const dx = lastPointerX !== null ? ev.clientX - lastPointerX : 7;
      const dy = lastPointerY !== null ? ev.clientY - lastPointerY : 0;
      lastPointerX = ev.clientX;
      lastPointerY = ev.clientY;
      brushChimeAtPoint(ev.clientX, ev.clientY, dx, dy, true);
    });

    // Brush cursor past the chime (horizontally, vertically, or diagonally) to sway & ring cleanly
    const onCursorGlide = (ev: MouseEvent) => {
      if (!document.contains(furinBtn)) {
        window.removeEventListener('mousemove', onCursorGlide);
        window.removeEventListener('pointerdown', unlockOnGesture);
        window.removeEventListener('keydown', unlockOnGesture);
        return;
      }
      const dxCursor = lastPointerX !== null ? ev.clientX - lastPointerX : 0;
      const dyCursor = lastPointerY !== null ? ev.clientY - lastPointerY : 0;
      lastPointerX = ev.clientX;
      lastPointerY = ev.clientY;
      if (Math.hypot(dxCursor, dyCursor) < 0.8) return;
      brushChimeAtPoint(ev.clientX, ev.clientY, dxCursor, dyCursor, false);
    };
    window.addEventListener('mousemove', onCursorGlide, { passive: true });
  }

  if (typeof requestAnimationFrame === 'function') {
    ensurePhysics();
  }

  return furinBtn;
}

/** Backward-compatible alias keeping overview/module imports working cleanly. */
export const createWoodBoardBellProp = createWoodBoardFurinProp;

/**
 * Synthesizes a warm, delicate metallic key-ring clink using Web Audio.
 */
function playBrassKeysClink(): void {
  try {
    if (typeof window === 'undefined') return;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    if (!sharedBirdAudioCtx) sharedBirdAudioCtx = new AudioCtx();
    if (sharedBirdAudioCtx.state === 'suspended') void sharedBirdAudioCtx.resume();
    const now = sharedBirdAudioCtx.currentTime;

    // Two gentle overlapping high metallic key clinks
    const hits = [
      { delay: 0, freq: 2180, dur: 0.14, peak: 0.022 },
      { delay: 0.032, freq: 3120, dur: 0.11, peak: 0.016 },
      { delay: 0.095, freq: 2640, dur: 0.12, peak: 0.012 },
    ];
    hits.forEach(({ delay, freq, dur, peak }) => {
      if (!sharedBirdAudioCtx) return;
      const osc = sharedBirdAudioCtx.createOscillator();
      const gain = sharedBirdAudioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + delay);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.94, now + delay + dur);
      gain.gain.setValueAtTime(0.0001, now + delay);
      gain.gain.linearRampToValueAtTime(peak, now + delay + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + dur);
      osc.connect(gain);
      gain.connect(sharedBirdAudioCtx.destination);
      osc.start(now + delay);
      osc.stop(now + delay + dur + 0.01);
    });
  } catch {
    // Ignore audio errors cleanly
  }
}

export interface WardKeyPropItem {
  id: string;
  name: string;
  relationshipLabel?: string;
  pendingCount?: number;
  recentCount?: number;
}

export interface WardKeyRackCallbacks {
  onInspectPending?: (wardId: string) => void;
  onInspectHistory?: (wardId: string) => void;
  onOpenWards?: () => void;
}

/**
 * Miniature Carved Oak & Brass Keyhook Rack perched atop the 01 / Wards frame.
 * Holds an antique brass skeleton key per connected ward (up to 4 visible keys).
 * Keys with pending approvals display a warm glowing amber wax jewel.
 * - Hovering rustles the keys and shows a quick parchment hover tag.
 * - Clicking a key clinks & unlocks a parchment ward key-folio with direct
 *   Pending / History filter jumps for that ward (double-click jumps immediately).
 */
export function createWardKeyRackProp(
  wardsInput: readonly (string | WardKeyPropItem)[] = [],
  callbacks: WardKeyRackCallbacks = {}
): HTMLElement {
  const wards: WardKeyPropItem[] = wardsInput.map((item, idx) =>
    typeof item === 'string'
      ? { id: `ward_${idx}`, name: item, pendingCount: 0, recentCount: 0 }
      : {
          id: item.id,
          name: item.name,
          relationshipLabel: item.relationshipLabel,
          pendingCount: item.pendingCount ?? 0,
          recentCount: item.recentCount ?? 0,
        }
  );

  const rackWrap = document.createElement('div');
  rackWrap.className = 'gd-prop-btn gd-prop-ward-keyrack';

  const rackBtn = document.createElement('button');
  rackBtn.type = 'button';
  rackBtn.className = 'gd-keyrack-trigger';
  rackBtn.setAttribute(
    'aria-label',
    wards.length > 0
      ? `Inspect ward keys (${wards.length} connected)`
      : 'Inspect ward key rack'
  );
  rackBtn.setAttribute('aria-expanded', 'false');
  rackBtn.title =
    wards.length > 0
      ? 'Click a key for ward actions · Double-click to jump straight to queue'
      : 'Click to link your first ward';
  rackBtn.tabIndex = -1;

  const visibleCount = wards.length > 0 ? Math.min(4, wards.length) : 1;
  const xLayoutMap: Record<number, number[]> = {
    1: [47],
    2: [36, 58],
    3: [29, 47, 65],
    4: [24, 39.5, 54.5, 70],
  };
  const keyPositions = xLayoutMap[visibleCount] ?? [47];
  const isEmptyRack = wards.length === 0;

  const buildBowPath = (cx: number, variant: number): string => {
    switch (variant % 4) {
      case 0:
        return `
          <circle cx="${cx}" cy="16.4" r="3.4" fill="none" stroke="url(#gd-kr-brass-${variant % 3})" stroke-width="1.75"/>
          <circle cx="${cx - 1.8}" cy="16.4" r="1.4" fill="none" stroke="#442B08" stroke-width="0.55" opacity="0.55"/>
          <circle cx="${cx + 1.8}" cy="16.4" r="1.4" fill="none" stroke="#442B08" stroke-width="0.55" opacity="0.55"/>
          <circle cx="${cx}" cy="16.4" r="3.4" fill="none" stroke="#362006" stroke-width="0.65"/>
        `;
      case 1:
        return `
          <ellipse cx="${cx}" cy="16.5" rx="3.1" ry="3.9" fill="none" stroke="url(#gd-kr-brass-${variant % 3})" stroke-width="1.8"/>
          <ellipse cx="${cx}" cy="16.5" rx="3.1" ry="3.9" fill="none" stroke="#362006" stroke-width="0.65"/>
        `;
      case 2:
        return `
          <path d="M${cx} 12.6 L${cx + 3.5} 16.5 L${cx} 20.3 L${cx - 3.5} 16.5 Z" fill="none" stroke="url(#gd-kr-brass-${variant % 3})" stroke-width="1.8" stroke-linejoin="round"/>
          <path d="M${cx} 12.6 L${cx + 3.5} 16.5 L${cx} 20.3 L${cx - 3.5} 16.5 Z" fill="none" stroke="#362006" stroke-width="0.65" stroke-linejoin="round"/>
        `;
      default:
        return `
          <path d="M${cx} 19.8 C${cx - 4.2} 17.6, ${cx - 4} 13.3, ${cx - 1.3} 13.3 C${cx - 0.3} 13.3, ${cx} 14.3, ${cx} 14.3 C${cx} 14.3, ${cx + 0.3} 13.3, ${cx + 1.3} 13.3 C${cx + 4} 13.3, ${cx + 4.2} 17.6, ${cx} 19.8 Z" fill="none" stroke="url(#gd-kr-brass-0)" stroke-width="1.7" stroke-linejoin="round"/>
          <path d="M${cx} 19.8 C${cx - 4.2} 17.6, ${cx - 4} 13.3, ${cx - 1.3} 13.3 C${cx - 0.3} 13.3, ${cx} 14.3, ${cx} 14.3 C${cx} 14.3, ${cx + 0.3} 13.3, ${cx + 1.3} 13.3 C${cx + 4} 13.3, ${cx + 4.2} 17.6, ${cx} 19.8 Z" fill="none" stroke="#362006" stroke-width="0.6" stroke-linejoin="round"/>
        `;
    }
  };

  const buildBitPath = (cx: number, variant: number, shaftEndY: number): string => {
    switch (variant % 4) {
      case 0:
        return `M${cx + 0.8} ${shaftEndY - 4.5} H${cx + 4.3} V${shaftEndY - 2.6} H${cx + 2.4} V${shaftEndY - 1.5} H${cx + 4.3} V${shaftEndY} H${cx + 0.8} Z`;
      case 1:
        return `M${cx + 0.8} ${shaftEndY - 4.2} H${cx + 4.4} V${shaftEndY - 0.3} H${cx + 2.8} V${shaftEndY - 2.1} H${cx + 1.8} V${shaftEndY - 0.3} H${cx + 0.8} Z`;
      case 2:
        return `M${cx + 0.8} ${shaftEndY - 4.8} H${cx + 3.9} V${shaftEndY - 3.1} H${cx + 2.5} V${shaftEndY - 1.9} H${cx + 4.2} V${shaftEndY - 0.2} H${cx + 0.8} Z`;
      default:
        return `M${cx + 0.8} ${shaftEndY - 4.4} H${cx + 4.1} V${shaftEndY - 2.2} H${cx + 2.9} V${shaftEndY - 0.2} H${cx + 0.8} Z`;
    }
  };

  const hooksAndKeysSvg = keyPositions
    .map((cx, i) => {
      const ward = wards[i];
      const hasPending = Boolean(ward && (ward.pendingCount ?? 0) > 0);
      const gradId = isEmptyRack ? 'gd-kr-pewter' : `gd-kr-brass-${i % 3}`;
      const strokeOutline = isEmptyRack ? '#3A3A3A' : '#3B2507';
      const shaftLen = i % 2 === 0 ? 31.5 : 33;
      return `
        <circle cx="${cx}" cy="9.2" r="1.25" fill="#E8BA54" stroke="#3B2507" stroke-width="0.55"/>
        <path d="M${cx} 9.8 V12.3 C${cx} 13.7, ${cx + 1.6} 13.7, ${cx + 1.7} 12.1" fill="none" stroke="#C9922F" stroke-width="1.35" stroke-linecap="round"/>

        <g class="gd-ward-key${isEmptyRack ? ' is-empty' : ''}${hasPending ? ' has-pending' : ''}" data-key-idx="${i}" style="transform-origin: ${cx}px 12.6px;">
          <rect x="${cx - 6}" y="10.5" width="12" height="25" fill="transparent"/>
          <circle cx="${cx}" cy="12.7" r="1.85" fill="none" stroke="url(#${gradId})" stroke-width="1.05"/>
          <circle cx="${cx}" cy="12.7" r="1.85" fill="none" stroke="${strokeOutline}" stroke-width="0.4"/>
          ${buildBowPath(cx, i)}
          ${hasPending ? `<circle class="gd-key-pending-gem" cx="${cx}" cy="16.4" r="1.8" fill="#E36D2B" stroke="#FFF4CE" stroke-width="0.6"/>` : ''}
          <rect x="${cx - 1.5}" y="19.6" width="3" height="1.5" rx="0.6" fill="url(#${gradId})" stroke="${strokeOutline}" stroke-width="0.55"/>
          <rect x="${cx - 0.9}" y="21.1" width="1.8" height="${(shaftLen - 21.1).toFixed(1)}" rx="0.8" fill="url(#${gradId})" stroke="${strokeOutline}" stroke-width="0.6"/>
          <path d="${buildBitPath(cx, i, shaftLen)}" fill="url(#${gradId})" stroke="${strokeOutline}" stroke-width="0.6" stroke-linejoin="round"/>
          <line class="gd-key-glint" x1="${cx - 0.25}" y1="22" x2="${cx - 0.25}" y2="${(shaftLen - 2.5).toFixed(1)}" stroke="#FFF7CE" stroke-width="0.65" stroke-linecap="round"/>
        </g>
      `;
    })
    .join('');

  rackBtn.innerHTML = `
    <span class="gd-keyrack-tag" aria-hidden="true">
      <span class="gd-keyrack-tag-hole"></span>
      <span class="gd-keyrack-tag-text"></span>
    </span>
    <svg class="gd-prop-svg gd-keyrack-svg" width="94" height="39" viewBox="0 0 94 39" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="gd-kr-wood" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#8A603B"/>
          <stop offset="45%" stop-color="#614023"/>
          <stop offset="100%" stop-color="#36200D"/>
        </linearGradient>
        <linearGradient id="gd-kr-brass-0" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#FFF2AE"/>
          <stop offset="38%" stop-color="#E1AA43"/>
          <stop offset="82%" stop-color="#9A6616"/>
          <stop offset="100%" stop-color="#593809"/>
        </linearGradient>
        <linearGradient id="gd-kr-brass-1" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#FFE69A"/>
          <stop offset="42%" stop-color="#CF912E"/>
          <stop offset="85%" stop-color="#875412"/>
          <stop offset="100%" stop-color="#4D2E07"/>
        </linearGradient>
        <linearGradient id="gd-kr-brass-2" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#FCE7B4"/>
          <stop offset="40%" stop-color="#D7993C"/>
          <stop offset="84%" stop-color="#8F5D18"/>
          <stop offset="100%" stop-color="#52320A"/>
        </linearGradient>
        <linearGradient id="gd-kr-pewter" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#D2D0CA"/>
          <stop offset="50%" stop-color="#9A968E"/>
          <stop offset="100%" stop-color="#5B5852"/>
        </linearGradient>
      </defs>

      <ellipse cx="47" cy="36.8" rx="37" ry="1.8" fill="rgba(26, 18, 10, 0.22)"/>
      <rect x="11.5" y="7" width="4.2" height="28.5" rx="1.2" fill="url(#gd-kr-wood)" stroke="#291709" stroke-width="1"/>
      <rect x="78.3" y="7" width="4.2" height="28.5" rx="1.2" fill="url(#gd-kr-wood)" stroke="#291709" stroke-width="1"/>
      <rect x="10.2" y="34.2" width="6.8" height="2.4" rx="1" fill="url(#gd-kr-brass-0)" stroke="#3B2507" stroke-width="0.75"/>
      <rect x="77" y="34.2" width="6.8" height="2.4" rx="1" fill="url(#gd-kr-brass-0)" stroke="#3B2507" stroke-width="0.75"/>
      <rect x="9.5" y="4.5" width="75" height="6.2" rx="2" fill="url(#gd-kr-wood)" stroke="#291709" stroke-width="1.1"/>
      <line x1="12.5" y1="6.1" x2="81.5" y2="6.1" stroke="rgba(255, 228, 178, 0.34)" stroke-width="0.8" stroke-linecap="round"/>
      <rect x="36" y="1.8" width="22" height="4.2" rx="1.5" fill="url(#gd-kr-brass-0)" stroke="#3B2507" stroke-width="0.8"/>
      <circle cx="13.6" cy="7.6" r="1" fill="#E8BA54"/>
      <circle cx="80.4" cy="7.6" r="1" fill="#E8BA54"/>

      ${hooksAndKeysSvg}
    </svg>
  `;

  // Hanging cream parchment key-tag folio for instant ward actions
  const folioEl = document.createElement('div');
  folioEl.className = 'gd-keyrack-folio';
  folioEl.setAttribute('role', 'region');
  folioEl.setAttribute('aria-label', 'Ward key quick actions');
  folioEl.innerHTML = `
    <div class="gd-folio-top">
      <span class="gd-folio-eyelet" aria-hidden="true"></span>
      <span class="gd-folio-kicker">WARD KEY</span>
      <div class="gd-folio-pager">
        <button type="button" class="gd-folio-nav-btn gd-folio-prev" aria-label="Previous ward key" title="Previous ward key">&lsaquo;</button>
        <button type="button" class="gd-folio-nav-btn gd-folio-next" aria-label="Next ward key" title="Next ward key">&rsaquo;</button>
      </div>
    </div>
    <div class="gd-folio-title"></div>
    <div class="gd-folio-meta"></div>
    <div class="gd-folio-actions">
      <button type="button" class="gd-folio-act-btn gd-folio-pending-btn"></button>
      <button type="button" class="gd-folio-act-btn gd-folio-history-btn"></button>
    </div>
  `;

  rackWrap.appendChild(rackBtn);
  rackWrap.appendChild(folioEl);

  const keyEls = Array.from(rackBtn.querySelectorAll('.gd-ward-key')) as SVGGElement[];
  const tagEl = rackBtn.querySelector('.gd-keyrack-tag') as HTMLElement | null;
  const tagTextEl = rackBtn.querySelector('.gd-keyrack-tag-text') as HTMLElement | null;
  const folioKickerEl = folioEl.querySelector('.gd-folio-kicker') as HTMLElement | null;
  const folioTitleEl = folioEl.querySelector('.gd-folio-title') as HTMLElement | null;
  const folioMetaEl = folioEl.querySelector('.gd-folio-meta') as HTMLElement | null;
  const folioPagerEl = folioEl.querySelector('.gd-folio-pager') as HTMLElement | null;
  const folioPrevBtn = folioEl.querySelector('.gd-folio-prev') as HTMLButtonElement | null;
  const folioNextBtn = folioEl.querySelector('.gd-folio-next') as HTMLButtonElement | null;
  const folioPendingBtn = folioEl.querySelector('.gd-folio-pending-btn') as HTMLButtonElement | null;
  const folioHistoryBtn = folioEl.querySelector('.gd-folio-history-btn') as HTMLButtonElement | null;

  const angles = keyEls.map(() => 0);
  const vels = keyEls.map(() => 0);
  let swingRaf: number | null = null;
  let activeWardIdx = -1;
  let isOpen = false;

  const stepKeys = () => {
    if (typeof document !== 'undefined' && !document.contains(rackWrap)) {
      swingRaf = null;
      return;
    }
    let moving = false;
    for (let i = 0; i < keyEls.length; i += 1) {
      vels[i] = (vels[i] - 0.14 * angles[i]) * 0.91;
      angles[i] += vels[i];
      if (Math.abs(angles[i]) > 0.08 || Math.abs(vels[i]) > 0.08) {
        moving = true;
        keyEls[i].style.transform = `rotate(${angles[i].toFixed(2)}deg)`;
      } else {
        angles[i] = 0;
        vels[i] = 0;
        keyEls[i].style.transform = '';
      }
    }
    if (moving && typeof requestAnimationFrame === 'function') {
      swingRaf = requestAnimationFrame(stepKeys);
    } else {
      swingRaf = null;
    }
  };

  const kickKeys = (primaryIdx: number, impulse = 3.2) => {
    for (let i = 0; i < keyEls.length; i += 1) {
      const dist = Math.abs(i - primaryIdx);
      const dir = i <= primaryIdx ? 1 : -1;
      if (dist === 0) {
        vels[i] += impulse * (Math.random() > 0.3 ? 1 : -1);
      } else if (dist === 1) {
        vels[i] += dir * impulse * 0.42;
      } else {
        vels[i] += dir * impulse * 0.18;
      }
    }
    if (swingRaf === null && typeof requestAnimationFrame === 'function') {
      swingRaf = requestAnimationFrame(stepKeys);
    }
  };

  const getCardNameEls = (): HTMLElement[] => {
    const cardEl = rackWrap.closest('.gd-metric-card-ward') as HTMLElement | null;
    return cardEl ? (Array.from(cardEl.querySelectorAll('.gd-ward-inline-name')) as HTMLElement[]) : [];
  };

  const closeFolio = () => {
    isOpen = false;
    activeWardIdx = -1;
    rackWrap.classList.remove('is-open');
    rackBtn.setAttribute('aria-expanded', 'false');
    keyEls.forEach((k) => k.classList.remove('is-active'));
    getCardNameEls().forEach((el) => el.classList.remove('is-key-lit'));
    tagEl?.classList.remove('is-visible');
  };

  const openWardFolio = (idx: number, playAudio = true) => {
    if (playAudio) playBrassKeysClink();

    const nameEls = getCardNameEls();
    nameEls.forEach((el) => el.classList.remove('is-key-lit'));
    keyEls.forEach((k) => k.classList.remove('is-active'));

    isOpen = true;
    rackWrap.classList.add('is-open');
    rackBtn.setAttribute('aria-expanded', 'true');
    tagEl?.classList.remove('is-visible');

    if (wards.length === 0) {
      activeWardIdx = 0;
      kickKeys(0, 2.8);
      if (folioKickerEl) folioKickerEl.textContent = 'SPARE HOOK';
      if (folioTitleEl) folioTitleEl.textContent = 'No wards linked';
      if (folioMetaEl) folioMetaEl.textContent = 'Connect a ward to hang their key here.';
      if (folioPagerEl) folioPagerEl.style.display = 'none';
      if (folioPendingBtn) {
        folioPendingBtn.textContent = 'Connect Ward →';
        folioPendingBtn.className = 'gd-folio-act-btn gd-folio-pending-btn is-alert';
        folioPendingBtn.onclick = (ev) => {
          ev.stopPropagation();
          closeFolio();
          callbacks.onOpenWards?.();
        };
      }
      if (folioHistoryBtn) folioHistoryBtn.style.display = 'none';
      return;
    }

    const total = wards.length;
    activeWardIdx = ((idx % total) + total) % total;
    const ward = wards[activeWardIdx];
    const keySlot = Math.min(keyEls.length - 1, activeWardIdx % Math.max(1, keyEls.length));

    keyEls[keySlot]?.classList.add('is-active');
    kickKeys(keySlot, 3.5);
    nameEls[activeWardIdx]?.classList.add('is-key-lit');

    const pending = ward.pendingCount ?? 0;
    const recent = ward.recentCount ?? 0;
    const rel = ward.relationshipLabel?.trim() || 'Protected Ward';

    if (folioKickerEl) {
      folioKickerEl.textContent = total > 1 ? `KEY ${activeWardIdx + 1} OF ${total}` : 'WARD KEY';
    }
    if (folioTitleEl) folioTitleEl.textContent = ward.name;
    if (folioMetaEl) {
      folioMetaEl.textContent =
        pending > 0
          ? `${rel} · ${pending} awaiting review`
          : `${rel} · Queue clear`;
    }
    if (folioPagerEl) {
      folioPagerEl.style.display = total > 1 ? 'inline-flex' : 'none';
    }
    if (folioPendingBtn) {
      folioPendingBtn.textContent = pending > 0 ? `Review (${pending}) →` : 'Pending →';
      folioPendingBtn.className = `gd-folio-act-btn gd-folio-pending-btn${pending > 0 ? ' is-alert' : ''}`;
      folioPendingBtn.onclick = (ev) => {
        ev.stopPropagation();
        closeFolio();
        if (callbacks.onInspectPending) {
          callbacks.onInspectPending(ward.id);
        } else {
          callbacks.onOpenWards?.();
        }
      };
    }
    if (folioHistoryBtn) {
      folioHistoryBtn.style.display = '';
      folioHistoryBtn.textContent = recent > 0 ? `History (${recent}) →` : 'History →';
      folioHistoryBtn.onclick = (ev) => {
        ev.stopPropagation();
        closeFolio();
        if (callbacks.onInspectHistory) {
          callbacks.onInspectHistory(ward.id);
        } else {
          callbacks.onOpenWards?.();
        }
      };
    }
  };

  // Stop clicks & keys inside keyrack/folio from accidentally triggering parent card click
  rackWrap.addEventListener('click', (e) => e.stopPropagation());
  rackWrap.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape' && isOpen) closeFolio();
  });

  // Hovering peeks a lightweight one-line parchment label and rustles keys when closed
  rackBtn.addEventListener('mousemove', (e) => {
    if (isOpen || wards.length === 0) return;
    const target = e.target as { closest?: (sel: string) => Element | null } | null;
    const keyGroup = target?.closest?.('.gd-ward-key') as SVGGElement | null;
    if (!keyGroup) return;
    const slot = Number(keyGroup.getAttribute('data-key-idx') ?? '-1');
    if (slot >= 0 && slot < wards.length && tagEl && tagTextEl) {
      const w = wards[slot];
      const pending = w.pendingCount ?? 0;
      tagTextEl.textContent = pending > 0 ? `${w.name} · ${pending} waiting` : w.name;
      tagEl.classList.add('is-visible');
      getCardNameEls().forEach((el, i) => el.classList.toggle('is-key-lit', i === slot));
    }
  });

  rackBtn.addEventListener('mouseenter', () => {
    kickKeys(Math.floor(keyEls.length / 2), 1.35);
  });

  rackBtn.addEventListener('mouseleave', () => {
    if (isOpen) return;
    tagEl?.classList.remove('is-visible');
    getCardNameEls().forEach((el) => el.classList.remove('is-key-lit'));
  });

  rackBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const target = e.target as { closest?: (sel: string) => Element | null } | null;
    const clickedKeyGroup = target?.closest?.('.gd-ward-key') as SVGGElement | null;
    const clickedSlotAttr = clickedKeyGroup?.getAttribute('data-key-idx');
    const clickedSlot =
      clickedSlotAttr !== null && clickedSlotAttr !== undefined ? Number(clickedSlotAttr) : -1;

    if (wards.length === 0) {
      if (isOpen) {
        closeFolio();
      } else {
        openWardFolio(0, true);
      }
      return;
    }

    if (clickedSlot >= 0 && clickedSlot < wards.length) {
      if (isOpen && activeWardIdx === clickedSlot) {
        closeFolio();
      } else {
        openWardFolio(clickedSlot, true);
      }
    } else if (!isOpen) {
      openWardFolio(0, true);
    } else if (wards.length > 1) {
      openWardFolio((activeWardIdx + 1) % wards.length, true);
    } else {
      closeFolio();
    }
  });

  // Double-clicking a key immediately opens that ward's filtered queue
  rackBtn.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    if (wards.length === 0) {
      closeFolio();
      callbacks.onOpenWards?.();
      return;
    }
    const target = e.target as { closest?: (sel: string) => Element | null } | null;
    const clickedKeyGroup = target?.closest?.('.gd-ward-key') as SVGGElement | null;
    const slot = Number(clickedKeyGroup?.getAttribute('data-key-idx') ?? (activeWardIdx >= 0 ? activeWardIdx : 0));
    const idx = Math.max(0, Math.min(wards.length - 1, slot));
    const ward = wards[idx];
    closeFolio();
    if ((ward.pendingCount ?? 0) > 0 && callbacks.onInspectPending) {
      callbacks.onInspectPending(ward.id);
    } else if (callbacks.onInspectHistory) {
      callbacks.onInspectHistory(ward.id);
    } else {
      callbacks.onOpenWards?.();
    }
  });

  folioPrevBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (wards.length > 1) openWardFolio(activeWardIdx - 1, true);
  });

  folioNextBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (wards.length > 1) openWardFolio(activeWardIdx + 1, true);
  });

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    const onDocClick = (ev: MouseEvent) => {
      if (!document.contains(rackWrap)) {
        document.removeEventListener('click', onDocClick);
        return;
      }
      if (isOpen && ev.target && !rackWrap.contains(ev.target as Node)) {
        closeFolio();
      }
    };
    document.addEventListener('click', onDocClick);
  }

  return rackWrap;
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
let sharedStormCalmingRemaining = 0; // seconds left in Option-2 dramatic wind-down after mid-storm flip

/**
 * Shared spring-physics & 3D letter-flip interaction for animated page headings
 * when their companion prop (Overview Lantern or Pending Hourglass) is active.
 */
export function attachInteractiveHeadingSprings(
  titleEl: HTMLElement,
  isActiveFn: () => boolean,
  onLetterClick?: (charRect: DOMRect) => void,
  mode: 'thermal' | 'wind-banner' | 'tick' = 'thermal',
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
        } else if (mode === 'tick') {
          const beat = clock * 2.4;
          const stepIdx = Math.floor(beat);
          const frac = beat - stepIdx;
          const snapped = stepIdx + Math.min(1, frac * 4.2);
          targetY = Math.sin(snapped * 0.95 + i * 0.65) * 1.9 - 1.1;
          targetRot = Math.cos(snapped * 1.15 + i * 0.85) * 1.5;
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

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function' && mode === 'thermal') {
    const onLanternSync = () => {
      if (!document.contains(titleEl)) return;
      if (isActiveFn()) {
        for (let i = 0; i < states.length; i++) {
          states[i].vy -= 42 - i * 2;
        }
        ensureRunning();
      }
    };
    window.addEventListener('gd-lantern-ambience-sync', onLanternSync);
  }

  if (typeof window !== 'undefined' && typeof MutationObserver === 'function') {
    requestAnimationFrame(() => {
      if (!document.contains(titleEl)) return;
      const appEl = document.querySelector('.gd-dashboard-app');
      const sectionEl = titleEl.closest('.gd-view-section');
      const targets = [appEl, sectionEl].filter(Boolean) as Element[];
      if (targets.length) {
        const obs = new MutationObserver(() => {
          if (!document.contains(titleEl)) {
            queueMicrotask(() => {
              if (!document.contains(titleEl)) obs.disconnect();
            });
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
    <span class="gd-hourglass-note" aria-hidden="true">Flip for storm</span>
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
  const noteEl = btn.querySelector('.gd-hourglass-note') as HTMLElement | null;
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
  let lastStormActiveState = false;

  const updateNote = (flowing: boolean, flipping: boolean) => {
    const label = sharedStormCalmingRemaining > 0
      ? 'Calming storm...'
      : flowing
        ? 'Flip to calm'
        : flipping
          ? 'Flipping...'
          : 'Flip for storm';
    if (noteEl && noteEl.textContent !== label) {
      noteEl.textContent = label;
    }
    btn.classList.toggle('is-flipping', flipping);
    btn.title = flowing
      ? sharedStormCalmingRemaining > 0
        ? 'Calming sandstorm...'
        : 'Click again to calm the sandstorm'
      : 'Click to flip hourglass & summon sandstorm';
  };

  const syncSectionClass = (flowing: boolean, flipping = false) => {
    btn.classList.toggle('is-flowing', flowing);
    btn.setAttribute('aria-pressed', flowing ? 'true' : 'false');
    updateNote(flowing, flipping);
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

    // Weighted dt-independent trunnion pivot physics (~0.24s turn before sand catches & pours)
    const angAccel = (targetAngle - angle) * 145;
    angVel += angAccel * dt;
    angVel *= Math.exp(-dt * 14.5);
    angle += angVel * dt;
    if (frameEl) {
      frameEl.style.transform = `rotate(${angle.toFixed(2)}deg)`;
    }

    const angleDiff = targetAngle - angle;
    const absDiff = Math.abs(angleDiff);
    const flippedOdd = (Math.round(targetAngle / 180) % 2) !== 0;
    const upperSand = flippedOdd ? 1 - bulbASand : bulbASand;

    const calming = sharedStormCalmingRemaining > 0;
    if (calming) {
      sharedStormCalmingRemaining = Math.max(0, sharedStormCalmingRemaining - dt);
      // Rapidly settle any remaining top sand into the resting bottom bulb during the farewell gust
      if (upperSand > 0.001) {
        const fastDrain = Math.max(dt * 1.9, upperSand * Math.min(1, dt * 5.2));
        bulbASand = flippedOdd
          ? Math.min(1, bulbASand + fastDrain)
          : Math.max(0, bulbASand - fastDrain);
        sharedBulbASand = bulbASand;
      }
      grainClock += dt * 1.35;
    }

    const activeUpper = flippedOdd ? 1 - bulbASand : bulbASand;
    // Wait until the hourglass visibly turns past horizontal (~125 deg turned, absDiff < 55) so
    // sand starts pouring first and triggers the sandstorm naturally rather than at t=0ms.
    const normalPouring = !calming && activeUpper > 0.002 && absDiff < 55;
    const stormActive = normalPouring || calming;
    const prePourFlip = !calming && activeUpper > 0.002 && absDiff >= 55;
    if (normalPouring) {
      const drain = dt / 22; // 22-second realistic pour
      bulbASand = flippedOdd
        ? Math.min(1, bulbASand + drain)
        : Math.max(0, bulbASand - drain);
      sharedBulbASand = bulbASand;
      grainClock += dt;
    }

    if (stormActive && !lastStormActiveState && !calming) {
      if (typeof window !== 'undefined' && typeof CustomEvent === 'function') {
        window.dispatchEvent(new CustomEvent('gd-hourglass-flip'));
      }
    }
    lastStormActiveState = stormActive;

    const showStream = normalPouring || (calming && activeUpper > 0.008 && absDiff < 55);
    renderSandGeometry(flippedOdd, showStream, angleDiff);
    syncSectionClass(stormActive, prePourFlip);

    const stillSpinning = absDiff > 0.25 || Math.abs(angVel) > 0.6;
    if (stillSpinning || stormActive || prePourFlip) {
      rafId = requestAnimationFrame(step);
    } else {
      angle = targetAngle;
      angVel = 0;
      sharedStormCalmingRemaining = 0;
      lastStormActiveState = false;
      if (frameEl) frameEl.style.transform = `rotate(${targetAngle}deg)`;
      renderSandGeometry(flippedOdd, false, 0);
      syncSectionClass(false, false);
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
  const initActive = sharedStormCalmingRemaining > 0 || initUpper > 0.01;
  lastStormActiveState = initActive;
  if (frameEl) frameEl.style.transform = `rotate(${targetAngle}deg)`;
  renderSandGeometry(initOdd, initUpper > 0.01 && sharedStormCalmingRemaining <= 0, 0);
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => syncSectionClass(initActive, false));
    if (initActive) ensureRunning();
  }

  btn.addEventListener('mouseenter', () => {
    if (Math.abs(targetAngle - angle) < 2) {
      angVel += 65;
      ensureRunning();
    }
  });

  btn.addEventListener('click', () => {
    const curOdd = (Math.round(targetAngle / 180) % 2) !== 0;
    const curUpper = curOdd ? 1 - bulbASand : bulbASand;
    const isCurrentlyPouring = sharedStormCalmingRemaining <= 0 && curUpper > 0.008;

    targetAngle += 180;
    sharedHourglassAngle = targetAngle;
    const nextOdd = (Math.round(targetAngle / 180) % 2) !== 0;

    if (isCurrentlyPouring) {
      // Option 2: mid-storm click flips hourglass back, triggers a dramatic ~0.95s closing gust,
      // drains sand into the lower bulb cleanly, and lets the lingering leaves float & settle.
      sharedStormCalmingRemaining = 0.95;
      lastStormActiveState = true;
      syncSectionClass(true, false);
      if (typeof window !== 'undefined' && typeof CustomEvent === 'function') {
        window.dispatchEvent(new CustomEvent('gd-hourglass-storm-calm'));
      }
    } else {
      // Start rotating the hourglass immediately; step() launches the storm right as sand pours
      sharedStormCalmingRemaining = 0;
      const nextUpper = nextOdd ? 1 - bulbASand : bulbASand;
      if (nextUpper <= 0.12) {
        bulbASand = nextOdd ? 0 : 1;
        sharedBulbASand = bulbASand;
      }
      updateNote(false, true);
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

  interface StormLeaf {
    x: number;
    y: number;
    vx: number;
    vy: number;
    size: number;
    rot: number;
    rotSpeed: number;
    tumble: number;
    tumbleSpeed: number;
    phase: number;
    alpha: number;
    color: string;
    undersideColor: string;
    variant: 0 | 1;
  }

  interface LingerLeaf {
    x: number;
    y: number;
    vx: number;
    vy: number;
    size: number;
    rot: number;
    tumble: number;
    tumbleSpeed: number;
    phase: number;
    swayAmp: number;
    swayFreq: number;
    targetY: number;
    restRot: number;
    alpha: number;
    color: string;
    undersideColor: string;
    variant: 0 | 1;
    settled: boolean;
    settledAge: number;
  }

  // High-contrast bronze, ochre, amber, and sunlit gold so grains read crisply on cream/parchment
  const palette = ['#9C651C', '#B87A24', '#D69834', '#E8B84E', '#7A4E14', '#C98A2E'];
  const leafPalette = [
    { top: '#965222', under: '#6F3A16' },
    { top: '#B06A28', under: '#804A1A' },
    { top: '#7D4720', under: '#5A3114' },
    { top: '#BD7E32', under: '#8C5B20' },
    { top: '#785B2A', under: '#553F1B' },
  ];
  let width = 800;
  let height = 600;
  let gust = 0.55;
  let closingSurge = 0;
  let stormAlpha = 0;
  let clock = 0;
  let lastTs = 0;
  let rafId: number | null = null;
  let boardAngle = 0;
  let boardVel = 0;
  let wasStormActive = false;

  const resize = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    width = Math.max(320, window.innerWidth);
    height = Math.max(320, window.innerHeight);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener('resize', resize, { passive: true });

  const particles: SandParticle[] = Array.from({ length: 155 }, (_, i) => {
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

  const stormLeaves: StormLeaf[] = Array.from({ length: 14 }, (_, i) => {
    const tone = leafPalette[i % leafPalette.length];
    return {
      x: Math.random() * width,
      y: Math.random() * height,
      vx: 245 + Math.random() * 210,
      vy: -12 + Math.random() * 52,
      size: 7.5 + Math.random() * 5.0,
      rot: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 4.8,
      tumble: Math.random() * Math.PI * 2,
      tumbleSpeed: 2.8 + Math.random() * 3.4,
      phase: Math.random() * Math.PI * 2,
      alpha: 0.78 + Math.random() * 0.18,
      color: tone.top,
      undersideColor: tone.under,
      variant: (i % 2) as 0 | 1,
    };
  });

  const lingerLeaves: LingerLeaf[] = [];

  const traceLeafPath = (s: number, variant: 0 | 1) => {
    ctx.beginPath();
    if (variant === 0) {
      // Tapered dry willow/birch leaf with curled pointed tip
      ctx.moveTo(-s * 0.92, 0.1 * s);
      ctx.quadraticCurveTo(-s * 0.25, -s * 0.62, s * 0.95, -0.08 * s);
      ctx.quadraticCurveTo(s * 0.22, s * 0.56, -s * 0.92, 0.1 * s);
    } else {
      // Crisp lobed dry autumn leaf silhouette
      ctx.moveTo(-s * 0.88, 0.05 * s);
      ctx.quadraticCurveTo(-s * 0.48, -s * 0.52, -s * 0.12, -s * 0.34);
      ctx.quadraticCurveTo(s * 0.28, -s * 0.66, s * 0.96, -0.02 * s);
      ctx.quadraticCurveTo(s * 0.42, s * 0.58, s * 0.02, s * 0.36);
      ctx.quadraticCurveTo(-s * 0.44, s * 0.52, -s * 0.88, 0.05 * s);
    }
    ctx.closePath();
  };

  const drawDryLeaf = (
    leaf: Pick<StormLeaf, 'x' | 'y' | 'size' | 'rot' | 'tumble' | 'color' | 'undersideColor' | 'variant'>,
    alpha: number,
    shadowRatio: number,
  ) => {
    if (alpha <= 0.01) return;
    ctx.save();
    ctx.translate(leaf.x, leaf.y);

    if (shadowRatio > 0.02) {
      ctx.save();
      ctx.translate(2 * shadowRatio, 3 * shadowRatio);
      ctx.rotate(leaf.rot);
      ctx.scale(1, Math.max(0.32, Math.abs(Math.cos(leaf.tumble))));
      ctx.globalAlpha = alpha * 0.24 * shadowRatio;
      ctx.fillStyle = '#38240E';
      traceLeafPath(leaf.size, leaf.variant);
      ctx.fill();
      ctx.restore();
    }

    ctx.rotate(leaf.rot);
    const flatCos = Math.cos(leaf.tumble);
    ctx.scale(1, (flatCos >= 0 ? 1 : -1) * Math.max(0.28, Math.abs(flatCos)));
    ctx.globalAlpha = alpha;
    ctx.fillStyle = flatCos >= 0 ? leaf.color : leaf.undersideColor;
    traceLeafPath(leaf.size, leaf.variant);
    ctx.fill();

    ctx.lineWidth = 0.85;
    ctx.strokeStyle = 'rgba(54, 28, 10, 0.38)';
    ctx.stroke();

    // Fine stem, central midrib, and dry veins
    ctx.beginPath();
    ctx.moveTo(-leaf.size * 1.18, leaf.size * 0.08);
    ctx.quadraticCurveTo(-leaf.size * 0.1, -leaf.size * 0.05, leaf.size * 0.84, -leaf.size * 0.03);
    ctx.moveTo(-leaf.size * 0.32, 0);
    ctx.lineTo(-leaf.size * 0.02, -leaf.size * 0.26);
    ctx.moveTo(leaf.size * 0.06, -leaf.size * 0.02);
    ctx.lineTo(leaf.size * 0.36, leaf.size * 0.24);
    ctx.lineWidth = 0.72;
    ctx.strokeStyle = 'rgba(58, 30, 10, 0.42)';
    ctx.stroke();

    ctx.restore();
  };

  const spawnLingerLeaves = () => {
    lingerLeaves.length = 0;
    const minX = Math.min(340, width * 0.35);
    const maxX = Math.max(minX + 80, width - 140);
    const candidates = stormLeaves.filter(
      (l) => l.x >= minX && l.x <= maxX && l.y >= height * 0.12 && l.y <= height * 0.64,
    );

    const slots = [0, 1];
    for (const idx of slots) {
      const src = candidates[idx];
      const tone = leafPalette[(idx * 2 + 1) % leafPalette.length];
      lingerLeaves.push({
        x: src ? src.x : width * (0.42 + idx * 0.22) + (Math.random() - 0.5) * 70,
        y: src ? src.y : height * (0.22 + idx * 0.11),
        vx: 72 + Math.random() * 54,
        vy: 28 + Math.random() * 14,
        size: src ? src.size + 1.2 : 9.5 + idx * 1.4,
        rot: src ? src.rot : (Math.random() - 0.5) * 0.8,
        tumble: src ? src.tumble : Math.random() * Math.PI * 2,
        tumbleSpeed: 1.9 + Math.random() * 1.1,
        phase: idx * 2.1 + Math.random() * 1.2,
        swayAmp: 36 + Math.random() * 20,
        swayFreq: 1.55 + Math.random() * 0.45,
        targetY: Math.max(120, height - (14 + idx * 8 + Math.random() * 7)),
        restRot: (idx === 0 ? -0.18 : 0.24) + (Math.random() - 0.5) * 0.22,
        alpha: 0.9,
        color: src ? src.color : tone.top,
        undersideColor: src ? src.undersideColor : tone.under,
        variant: src ? src.variant : (idx as 0 | 1),
        settled: false,
        settledAge: 0,
      });
    }
  };

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

  const isPendingViewVisible = () =>
    Boolean(document.querySelector('#view-pending.active'));

  const step = (ts: number) => {
    if (!document.contains(canvas)) {
      rafId = null;
      return;
    }

    const dt = lastTs ? Math.min(0.04, (ts - lastTs) / 1000) : 0.016;
    lastTs = ts;
    clock += dt;

    const active = isStormActive();
    const pendingVisible = isPendingViewVisible();
    if (!pendingVisible && lingerLeaves.length > 0) {
      lingerLeaves.length = 0;
    }
    if (wasStormActive && !active && pendingVisible) {
      spawnLingerLeaves();
    }
    wasStormActive = active;

    if (closingSurge > 0) {
      closingSurge = Math.max(0, closingSurge - dt);
    }

    const targetAlpha = active ? 1 : 0;
    stormAlpha += (targetAlpha - stormAlpha) * Math.min(1, dt * (active ? 4.8 : 3.0));
    // Dramatic natural wind surges while active, plus an intensified farewell gust during Option-2 calm-down
    const waveGust = active
      ? closingSurge > 0
        ? 1.32 + Math.sin(clock * 7.5) * 0.24
        : 0.54 + Math.max(0, Math.sin(clock * 1.45)) * 0.34 + Math.max(0, Math.sin(clock * 3.1)) * 0.16
      : 0.35;
    gust += (waveGust - gust) * Math.min(1, dt * (closingSurge > 0 ? 4.2 : 2.1));

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

      // 3. Tumbling dry leaves swept through the sandstorm
      for (const l of stormLeaves) {
        const eddyY = Math.sin(clock * 3.1 + l.phase + l.x * 0.007) * 56;
        const eddyX = Math.cos(clock * 2.0 + l.phase) * 28;
        l.x += (l.vx + eddyX) * speedMul * dt;
        l.y += (l.vy + eddyY) * speedMul * dt;
        l.rot += l.rotSpeed * (0.75 + gust * 0.55) * dt;
        l.tumble += l.tumbleSpeed * (0.75 + gust * 0.55) * dt;

        if (l.x > width + 48) {
          l.x = -42;
          l.y = Math.random() * height;
        }
        if (l.y > height + 36) {
          l.y = -24;
        } else if (l.y < -36) {
          l.y = height + 24;
        }

        drawDryLeaf(l, l.alpha * stormAlpha, 0);
      }
    }

    // 4. Lingering dry leaves: gently float in calm air after storm ends & settle at the bottom
    for (let i = lingerLeaves.length - 1; i >= 0; i--) {
      const l = lingerLeaves[i];
      if (active) {
        // New gust picks settled/floating leaves right back up into the wind
        l.settled = false;
        l.vx += 420 * dt;
        l.vy -= 130 * dt;
        l.x += l.vx * dt;
        l.y += l.vy * dt;
        l.rot += 4.6 * dt;
        l.tumble += 5.4 * dt;
        drawDryLeaf(l, l.alpha, 0);
        if (l.x > width + 48 || l.y < -40) {
          lingerLeaves.splice(i, 1);
        }
        continue;
      }

      if (!l.settled) {
        l.vx *= Math.exp(-dt * 1.45);
        const swayAngle = clock * l.swayFreq + l.phase;
        const swayVelX = Math.cos(swayAngle) * l.swayAmp;
        const bankAngle = Math.cos(swayAngle) * 0.42;

        l.x += (l.vx + swayVelX) * dt;
        const minVisibleX = Math.min(300, width * 0.25);
        if (l.x > width - 34) l.x = width - 34;
        if (l.x < minVisibleX) l.x = minVisibleX;

        const fallRate = l.vy * (0.72 + 0.45 * Math.abs(Math.sin(swayAngle)));
        l.y += fallRate * dt;

        const distToBottom = Math.max(0, l.targetY - l.y);
        const nearGround = Math.max(0, 1 - distToBottom / 72);
        const targetRot = bankAngle * (1 - nearGround) + l.restRot * nearGround;
        l.rot += (targetRot - l.rot) * Math.min(1, dt * 6);

        if (nearGround > 0.65) {
          const flatTumble = Math.round(l.tumble / (Math.PI * 2)) * Math.PI * 2;
          l.tumble += (flatTumble - l.tumble) * Math.min(1, dt * 7);
        } else {
          l.tumble += l.tumbleSpeed * (1 - nearGround * 0.75) * dt;
        }

        if (l.y >= l.targetY) {
          l.y = l.targetY;
          l.settled = true;
          l.settledAge = 0;
          l.rot = l.restRot;
          l.tumble = Math.round(l.tumble / (Math.PI * 2)) * Math.PI * 2;
        }

        drawDryLeaf(l, l.alpha, Math.max(0, 1 - distToBottom / 85));
      } else {
        l.targetY = Math.min(l.targetY, height - 12);
        l.y = l.targetY;
        l.settledAge += dt;
        const fade = l.settledAge <= 10 ? 1 : Math.max(0, 1 - (l.settledAge - 10) / 2.5);
        drawDryLeaf(l, l.alpha * fade, fade);
        if (l.settledAge >= 12.5) {
          lingerLeaves.splice(i, 1);
        }
      }
    }

    canvas.classList.toggle('is-leaves-lingering', lingerLeaves.length > 0 && pendingVisible);

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

    if (
      active ||
      stormAlpha > 0.015 ||
      lingerLeaves.length > 0 ||
      Math.abs(boardAngle) > 0.04 ||
      Math.abs(boardVel) > 0.06
    ) {
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
    closingSurge = 0;
    gust = 1.42;
    ensureRunning();
  });

  window.addEventListener('gd-hourglass-storm-calm', () => {
    closingSurge = 0.95;
    gust = 1.62;
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

let sharedWatchOpen = false;

/**
 * Engraved Brass Pocket Watch beside Decision History.
 * - Hover rocks the fob chain gently; click pops open the hinged brass lid,
 *   spins hands counter-clockwise, and activates Time Rewind / Memory Reverie.
 */
export function createHistoryPocketWatchProp(): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `gd-prop-btn gd-prop-history-watch${sharedWatchOpen ? ' is-open' : ''}`;
  btn.setAttribute('aria-label', 'Toggle archival pocket watch time rewind');
  btn.setAttribute('aria-pressed', sharedWatchOpen ? 'true' : 'false');
  btn.title = sharedWatchOpen ? 'Click to close watch & return to present' : 'Click to open pocket watch & rewind time';
  btn.tabIndex = -1;

  const tickMarks = Array.from({ length: 60 }, (_, i) => {
    const rad = (i * 6 * Math.PI) / 180;
    const isHour = i % 5 === 0;
    const isQuarter = i % 15 === 0;
    const r1 = isQuarter ? 17.6 : isHour ? 18.6 : 20.1;
    const r2 = 21.4;
    const x1 = (38 + Math.sin(rad) * r1).toFixed(2);
    const y1 = (55 - Math.cos(rad) * r1).toFixed(2);
    const x2 = (38 + Math.sin(rad) * r2).toFixed(2);
    const y2 = (55 - Math.cos(rad) * r2).toFixed(2);
    if (!isHour) {
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(96, 68, 28, 0.45)" stroke-width="0.45"/>`;
    }
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${isQuarter ? '#432B0B' : '#745322'}" stroke-width="${isQuarter ? '1.25' : '0.8'}" stroke-linecap="round"/>`;
  }).join('');

  btn.innerHTML = `
    <span class="gd-watch-note" aria-hidden="true">${sharedWatchOpen ? 'Return to present' : 'Rewind time'}</span>
    <span class="gd-watch-aura" aria-hidden="true"></span>
    <span class="gd-watch-motes" aria-hidden="true">
      <span class="gd-watch-mote gd-watch-mote-1"></span>
      <span class="gd-watch-mote gd-watch-mote-2"></span>
      <span class="gd-watch-mote gd-watch-mote-3"></span>
      <span class="gd-watch-mote gd-watch-mote-4"></span>
    </span>
    <svg class="gd-prop-svg" width="76" height="94" viewBox="0 0 76 94" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="gd-watch-brass" x1="10%" y1="6%" x2="90%" y2="94%">
          <stop offset="0%" stop-color="#FFF0AD"/>
          <stop offset="28%" stop-color="#E0AC4B"/>
          <stop offset="68%" stop-color="#9E6C1D"/>
          <stop offset="100%" stop-color="#53350B"/>
        </linearGradient>
        <linearGradient id="gd-watch-bezel-inner" x1="15%" y1="90%" x2="85%" y2="10%">
          <stop offset="0%" stop-color="#F2CC74"/>
          <stop offset="50%" stop-color="#8A5E19"/>
          <stop offset="100%" stop-color="#4A300A"/>
        </linearGradient>
        <radialGradient id="gd-watch-lid-grad" cx="38%" cy="32%" r="72%">
          <stop offset="0%" stop-color="#FFEBA6"/>
          <stop offset="32%" stop-color="#DBA444"/>
          <stop offset="72%" stop-color="#9A691B"/>
          <stop offset="100%" stop-color="#593A0C"/>
        </radialGradient>
        <radialGradient id="gd-watch-dial" cx="44%" cy="38%" r="64%">
          <stop offset="0%" stop-color="#FFFDF7"/>
          <stop offset="68%" stop-color="#F7EEDB"/>
          <stop offset="100%" stop-color="#DECBA8"/>
        </radialGradient>
        <linearGradient id="gd-watch-glass" x1="10%" y1="5%" x2="82%" y2="75%">
          <stop offset="0%" stop-color="rgba(255, 255, 255, 0.34)"/>
          <stop offset="45%" stop-color="rgba(255, 255, 255, 0.06)"/>
          <stop offset="100%" stop-color="rgba(255, 255, 255, 0)"/>
        </linearGradient>
      </defs>

      <!-- Soft resting ground shadow -->
      <ellipse cx="38" cy="87.5" rx="19" ry="2.8" fill="rgba(28, 20, 12, 0.16)"/>

      <!-- Pivoting watch assembly (hangs from top fob bow) -->
      <g class="gd-watch-swing" style="transform-origin: 38px 12px;">
        <!-- Antique Fob Bow Ring with inner metallic bevel -->
        <ellipse cx="38" cy="13.2" rx="7.2" ry="6.2" stroke="#4D320C" stroke-width="3.2" fill="none"/>
        <ellipse cx="38" cy="13.2" rx="7.2" ry="6.2" stroke="url(#gd-watch-brass)" stroke-width="2.2" fill="none"/>

        <!-- Pedestal Stem & Fluted Onion Winding Crown -->
        <rect x="35.2" y="21.5" width="5.6" height="6" rx="0.8" fill="url(#gd-watch-brass)" stroke="#4A300B" stroke-width="0.8"/>
        <rect x="33" y="18.2" width="10" height="4.2" rx="1.8" fill="url(#gd-watch-brass)" stroke="#4A300B" stroke-width="0.85"/>
        <line x1="35.5" y1="18.6" x2="35.5" y2="22" stroke="rgba(68, 42, 10, 0.65)" stroke-width="0.7"/>
        <line x1="38" y1="18.4" x2="38" y2="22.2" stroke="rgba(255, 244, 198, 0.6)" stroke-width="0.7"/>
        <line x1="40.5" y1="18.6" x2="40.5" y2="22" stroke="rgba(68, 42, 10, 0.65)" stroke-width="0.7"/>
        <!-- Crown collar guard -->
        <rect x="32.2" y="24.2" width="11.6" height="2.6" rx="1.1" fill="#F0CA72" stroke="#4A300B" stroke-width="0.75"/>

        <!-- Side Hinged Barrel (9 o'clock) & Opening Clasp Lip (3 o'clock) -->
        <rect x="8.2" y="51.2" width="2.8" height="7.6" rx="1.1" fill="url(#gd-watch-brass)" stroke="#432A09" stroke-width="0.75"/>
        <rect x="65.2" y="53" width="2.2" height="4" rx="0.9" fill="#E8BE5E" stroke="#432A09" stroke-width="0.7"/>

        <!-- Stepped Multi-Bevel Outer Brass Case -->
        <circle cx="38" cy="55" r="28" fill="url(#gd-watch-brass)" stroke="#3E280B" stroke-width="1.25"/>
        <circle cx="38" cy="55" r="26.1" fill="none" stroke="rgba(255, 243, 192, 0.55)" stroke-width="0.75"/>
        <circle cx="38" cy="55" r="25.2" fill="url(#gd-watch-bezel-inner)"/>

        <!-- Enamel Dial Face with Railway Track & Roman Cardinal Numerals -->
        <circle cx="38" cy="55" r="23.2" fill="url(#gd-watch-dial)" stroke="#6E4E1B" stroke-width="0.8"/>
        <circle cx="38" cy="55" r="21.5" fill="none" stroke="rgba(120, 88, 38, 0.35)" stroke-width="0.5"/>
        <circle cx="38" cy="55" r="17.8" fill="none" stroke="rgba(120, 88, 38, 0.25)" stroke-width="0.45"/>
        ${tickMarks}
        <text x="38" y="40.8" text-anchor="middle" font-family="Georgia, serif" font-size="4.4" font-weight="700" fill="#2E200E">XII</text>
        <text x="53.5" y="56.5" text-anchor="middle" font-family="Georgia, serif" font-size="4.2" font-weight="700" fill="#2E200E">III</text>
        <text x="22.5" y="56.5" text-anchor="middle" font-family="Georgia, serif" font-size="4.2" font-weight="700" fill="#2E200E">IX</text>

        <!-- Sub-seconds guilloché dial at 6 o'clock -->
        <circle cx="38" cy="66.2" r="5.2" fill="rgba(222, 206, 174, 0.42)" stroke="#8B682C" stroke-width="0.65"/>
        <line x1="38" y1="61.2" x2="38" y2="62.3" stroke="#5A3B12" stroke-width="0.55"/>
        <line x1="38" y1="70.1" x2="38" y2="71.2" stroke="#5A3B12" stroke-width="0.55"/>
        <line x1="33" y1="66.2" x2="34.1" y2="66.2" stroke="#5A3B12" stroke-width="0.55"/>
        <line x1="41.9" y1="66.2" x2="43" y2="66.2" stroke="#5A3B12" stroke-width="0.55"/>
        <line x1="38" y1="66.2" x2="38" y2="62.4" stroke="#9C4E18" stroke-width="0.75" stroke-linecap="round"/>
        <circle cx="38" cy="66.2" r="0.8" fill="#5A3B12"/>

        <!-- Breguet Pierced Blued-Steel Clock Hands -->
        <g class="gd-watch-hand-hour" style="transform-origin: 38px 55px;">
          <path d="M38 57.5 L37.1 53.5 L37.6 46.8 L38 41.2 L38.4 46.8 L38.9 53.5 Z" fill="#1F252E"/>
          <circle cx="38" cy="45.2" r="1.45" fill="#F9F1DF" stroke="#1F252E" stroke-width="0.8"/>
        </g>
        <g class="gd-watch-hand-min" style="transform-origin: 38px 55px;">
          <path d="M38 58 L37.3 53.5 L37.7 41.5 L38 35 L38.3 41.5 L38.7 53.5 Z" fill="#1F252E"/>
          <circle cx="38" cy="39.5" r="1.25" fill="#F9F1DF" stroke="#1F252E" stroke-width="0.75"/>
        </g>
        <g class="gd-watch-hand-sec" style="transform-origin: 38px 55px;">
          <line x1="38" y1="60.5" x2="38" y2="34.2" stroke="#A84C14" stroke-width="0.85" stroke-linecap="round"/>
          <circle cx="38" cy="59.4" r="1.1" fill="#A84C14"/>
        </g>
        <circle cx="38" cy="55" r="2.1" fill="url(#gd-watch-brass)" stroke="#3E280B" stroke-width="0.65"/>

        <!-- Curved Sapphire Crystal Glint -->
        <path d="M18 44 A22 22 0 0 1 56 41 Q41 51 18 44 Z" fill="url(#gd-watch-glass)" pointer-events="none"/>

        <!-- Hinged Guilloché Engraved Hunter Cover Lid (swings open from left barrel hinge) -->
        <g class="gd-watch-lid" style="transform-origin: 11px 55px;">
          <circle cx="38" cy="55" r="25.5" fill="url(#gd-watch-lid-grad)" stroke="#432A09" stroke-width="1.15"/>
          <circle cx="38" cy="55" r="23.4" fill="none" stroke="rgba(255, 240, 184, 0.45)" stroke-width="0.7"/>
          <circle cx="38" cy="55" r="20.6" fill="none" stroke="rgba(68, 42, 10, 0.52)" stroke-width="0.8" stroke-dasharray="1.6 1.8"/>
          <circle cx="38" cy="55" r="15.8" fill="none" stroke="rgba(68, 42, 10, 0.35)" stroke-width="0.65"/>
          <!-- Engraved 8-point mariner star & recessed center cartouche -->
          <path d="M38 40.5 L40 53 L52.5 55 L40 57 L38 69.5 L36 57 L23.5 55 L36 53 Z" fill="rgba(255, 245, 202, 0.48)" stroke="rgba(72, 46, 12, 0.58)" stroke-width="0.7"/>
          <path d="M28.5 45.5 L36.8 53.8 L47.5 45.5 L39.2 55 L47.5 64.5 L38 56.2 L28.5 64.5 L36.8 55 Z" fill="rgba(255, 238, 178, 0.25)" stroke="rgba(72, 46, 12, 0.4)" stroke-width="0.55"/>
          <circle cx="38" cy="55" r="5.6" fill="url(#gd-watch-lid-grad)" stroke="#54360E" stroke-width="0.8"/>
          <circle cx="38" cy="55" r="2.6" fill="#FFF2B8" stroke="#6E4916" stroke-width="0.7"/>
        </g>
      </g>
    </svg>
  `;

  const swingEl = btn.querySelector('.gd-watch-swing') as SVGGElement | null;
  const lidEl = btn.querySelector('.gd-watch-lid') as SVGGElement | null;
  const hourEl = btn.querySelector('.gd-watch-hand-hour') as SVGGElement | null;
  const minEl = btn.querySelector('.gd-watch-hand-min') as SVGGElement | null;
  const secEl = btn.querySelector('.gd-watch-hand-sec') as SVGGElement | null;
  const noteEl = btn.querySelector('.gd-watch-note') as HTMLElement | null;

  const getCurrentAngles = () => {
    const now = new Date();
    const s = now.getSeconds() + now.getMilliseconds() / 1000;
    const m = now.getMinutes() + s / 60;
    const h = (now.getHours() % 12) + m / 60;
    return { h: h * 30, m: m * 6, s: s * 6 };
  };

  const initialAngles = getCurrentAngles();
  let hourDeg = initialAngles.h;
  let minDeg = initialAngles.m;
  let secDeg = initialAngles.s;
  let lidOpen = sharedWatchOpen ? 1 : 0;
  let lidVel = 0;
  let swingDeg = 0;
  let swingVel = 0;
  let lastTs = 0;
  let rafId: number | null = null;

  const syncSectionClass = (open: boolean) => {
    btn.classList.toggle('is-open', open);
    btn.setAttribute('aria-pressed', open ? 'true' : 'false');
    btn.title = open ? 'Click to close watch & return to present' : 'Click to open pocket watch & rewind time';
    if (noteEl) {
      noteEl.textContent = open ? 'Return to present' : 'Rewind time';
    }
    if (typeof document !== 'undefined') {
      const appEl = document.querySelector('.gd-dashboard-app');
      const viewEl = btn.closest('#view-history');
      if (appEl) {
        const isHistoryMounted = Boolean(viewEl && document.contains(viewEl));
        appEl.classList.toggle('gd-history-rewind-on', open && isHistoryMounted);
      }
    }
  };

  const applyTransforms = () => {
    if (swingEl) {
      swingEl.style.transform = `rotate(${swingDeg.toFixed(2)}deg)`;
    }
    if (lidEl) {
      const openFrac = Math.max(0, Math.min(1, lidOpen));
      const scaleX = Math.max(0.06, 1 - openFrac * 0.94);
      const liftX = -openFrac * 3.5;
      lidEl.style.transform = `translateX(${liftX.toFixed(2)}px) scaleX(${scaleX.toFixed(3)})`;
      lidEl.style.opacity = openFrac >= 0.72 ? '0' : `${Math.max(0, 1 - openFrac * 1.38).toFixed(2)}`;
    }
    if (hourEl) hourEl.style.transform = `rotate(${hourDeg.toFixed(1)}deg)`;
    if (minEl) minEl.style.transform = `rotate(${minDeg.toFixed(1)}deg)`;
    if (secEl) secEl.style.transform = `rotate(${secDeg.toFixed(1)}deg)`;
  };

  const step = (ts: number) => {
    if (typeof document !== 'undefined' && !document.contains(btn)) {
      rafId = null;
      return;
    }

    const dt = lastTs ? Math.min(0.04, (ts - lastTs) / 1000) : 0.016;
    lastTs = ts;

    const targetLid = sharedWatchOpen ? 1 : 0;
    lidVel += ((targetLid - lidOpen) * 145 - lidVel * 14) * dt;
    lidOpen = Math.max(0, Math.min(1.06, lidOpen + lidVel * dt));

    swingVel += (-swingDeg * 95 - swingVel * 7.2) * dt;
    swingDeg += swingVel * dt;

    if (sharedWatchOpen) {
      // Smooth counter-clockwise rewind spin
      secDeg -= 240 * dt;
      minDeg -= 34 * dt;
      hourDeg -= 4.2 * dt;
    } else {
      const target = getCurrentAngles();
      const easeAngle = (cur: number, dest: number) => {
        const diff = (((dest - cur) % 360) + 540) % 360 - 180;
        return cur + diff * Math.min(1, dt * 8);
      };
      hourDeg = easeAngle(hourDeg, target.h);
      minDeg = easeAngle(minDeg, target.m);
      secDeg = easeAngle(secDeg, target.s);
    }

    applyTransforms();

    const lidMoving = Math.abs(targetLid - lidOpen) > 0.005 || Math.abs(lidVel) > 0.01;
    const swinging = Math.abs(swingDeg) > 0.08 || Math.abs(swingVel) > 0.2;
    if (sharedWatchOpen || lidMoving || swinging) {
      rafId = requestAnimationFrame(step);
    } else {
      lidOpen = targetLid;
      lidVel = 0;
      swingDeg = 0;
      swingVel = 0;
      applyTransforms();
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

  applyTransforms();
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => syncSectionClass(sharedWatchOpen));
    if (sharedWatchOpen) ensureRunning();
  }

  btn.addEventListener('mouseenter', () => {
    swingVel += 52;
    ensureRunning();
  });

  btn.addEventListener('click', () => {
    sharedWatchOpen = !sharedWatchOpen;
    swingVel += sharedWatchOpen ? -78 : 78;
    syncSectionClass(sharedWatchOpen);
    if (typeof window !== 'undefined' && typeof CustomEvent === 'function') {
      window.dispatchEvent(new CustomEvent('gd-watch-toggle', { detail: { open: sharedWatchOpen } }));
    }
    ensureRunning();
  });

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    const onWatchSync = (ev: Event) => {
      if (typeof document !== 'undefined' && !document.contains(btn)) {
        window.removeEventListener('gd-watch-toggle', onWatchSync);
        return;
      }
      const nextOpen = (ev as CustomEvent<{ open?: boolean }>).detail?.open;
      if (typeof nextOpen === 'boolean' && nextOpen !== sharedWatchOpen) {
        sharedWatchOpen = nextOpen;
        swingVel += sharedWatchOpen ? -78 : 78;
        syncSectionClass(sharedWatchOpen);
        ensureRunning();
      }
    };
    window.addEventListener('gd-watch-toggle', onWatchSync);
  }

  return btn;
}

/**
 * Full-screen Memory Reverie canvas overlay triggered when the Decision History
 * brass pocket watch opens (.gd-history-rewind-on).
 * Emerges from behind the sidebar and floats warm ascending memory sparks +
 * counter-clockwise temporal dial wisps.
 */
export function createHistoryRewindOverlay(): HTMLElement {
  const canvas = document.createElement('canvas');
  canvas.className = 'gd-history-rewind';
  canvas.setAttribute('aria-hidden', 'true');

  if (typeof window === 'undefined' || typeof requestAnimationFrame !== 'function') {
    return canvas;
  }
  const ctx = canvas.getContext?.('2d');
  if (!ctx) return canvas;

  interface MemorySpark {
    x: number;
    y: number;
    vy: number;
    driftAmp: number;
    driftFreq: number;
    phase: number;
    radius: number;
    alpha: number;
    color: string;
  }

  interface RomanClockRing {
    x: number;
    y: number;
    r: number;
    angle: number;
    spinSpeed: number;
    alpha: number;
  }

  interface ArchivePage {
    x: number;
    y: number;
    vx: number;
    vy: number;
    w: number;
    h: number;
    rot: number;
    rotSpeed: number;
    tumble: number;
    tumbleSpeed: number;
    phase: number;
    alpha: number;
    hasWaxSeal: boolean;
  }

  interface LingerPage {
    x: number;
    y: number;
    vx: number;
    vy: number;
    w: number;
    h: number;
    rot: number;
    tumble: number;
    tumbleSpeed: number;
    phase: number;
    swayAmp: number;
    swayFreq: number;
    targetY: number;
    restRot: number;
    alpha: number;
    hasWaxSeal: boolean;
    settled: boolean;
    settledAge: number;
  }

  const sparkColors = ['#FCE28B', '#E5AD44', '#C98328', '#FFF2BE', '#D69436'];
  let width = 800;
  let height = 600;
  let rewindAlpha = 0;
  let clock = 0;
  let journeyTime = 0;
  let introRemaining = 0;
  let lastTs = 0;
  let rafId: number | null = null;
  let boardAngle = 0;
  let boardVel = 0;
  let wasRewindActive = false;

  const INTRO_DURATION = 1.2;
  const ERA_DURATION = 5.0;
  const TRANSITION_DUR = 1.3;
  const ERAS = [
    {
      year: '1885 AD',
      title: 'Steam Locomotive',
      desc: 'Iron rails & steam',
    },
    {
      year: '1420 AD',
      title: 'Medieval Knights',
      desc: 'Steel & chivalry',
    },
    {
      year: '2500 BC',
      title: 'Ancient Egypt',
      desc: 'Pharaohs & chariots',
    },
    {
      year: '66M BC',
      title: 'Cretaceous Era',
      desc: 'Titans & calderas',
    },
  ] as const;

  interface PlumeParticle {
    x: number;
    y: number;
    vx: number;
    vy: number;
    r: number;
    grow: number;
    age: number;
    maxAge: number;
    tone: 'steam' | 'soot' | 'dust' | 'ash' | 'ember';
  }

  interface PhysicsSpark {
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
    maxLife: number;
    size: number;
    hot: boolean;
  }

  const eraPlumes: PlumeParticle[] = [];
  const eraSparks: PhysicsSpark[] = [];
  let steamEmitAcc = 0;
  let dustEmitAcc = 0;
  let volcanoEmitAcc = 0;
  let lastClashBeat = -1;
  let pointerX = -999;
  let pointerY = -999;
  let volcanoSurge = 0;

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener(
      'mousemove',
      (e: MouseEvent) => {
        if (!document.contains(canvas)) return;
        pointerX = e.clientX;
        pointerY = e.clientY;
        const vx = width * 0.89;
        if (Math.hypot(pointerX - vx, pointerY - (height - 85)) < 140) {
          volcanoSurge = Math.min(1, volcanoSurge + 0.28);
        }
      },
      { passive: true },
    );
    window.addEventListener(
      'click',
      (e: MouseEvent) => {
        if (!document.contains(canvas) || !isRewindActive() || !isHistoryVisible()) return;
        if (e.clientX > width * 0.48 && e.clientY > height * 0.62) {
          volcanoSurge = 1.0;
        }
      },
      { passive: true },
    );
  }

  const dialTicksSvg = Array.from({ length: 12 }, (_, idx) => {
    const a = (idx * Math.PI * 2) / 12;
    const isCardinal = idx % 3 === 0;
    const r1 = isCardinal ? 91 : 94;
    const r2 = 98;
    const x1 = (104 + Math.cos(a) * r1).toFixed(1);
    const y1 = (104 + Math.sin(a) * r1).toFixed(1);
    const x2 = (104 + Math.cos(a) * r2).toFixed(1);
    const y2 = (104 + Math.sin(a) * r2).toFixed(1);
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#8B6A2B" stroke-width="${isCardinal ? '1.35' : '0.9'}" stroke-linecap="round" opacity="${isCardinal ? '0.68' : '0.36'}"/>`;
  }).join('');

  const PROGRESS_CIRCUMFERENCE = 2 * Math.PI * 86;

  const hudEl = document.createElement('div');
  hudEl.className = 'gd-rewind-center-hud';
  hudEl.setAttribute('aria-hidden', 'true');
  hudEl.innerHTML = `
    <div class="gd-rewind-medallion">
      <svg class="gd-rewind-ring-outer" width="208" height="208" viewBox="0 0 208 208" fill="none">
        <circle cx="104" cy="104" r="98" stroke="#8B6A2B" stroke-width="0.9" stroke-dasharray="3 6" opacity="0.48"/>
        ${dialTicksSvg}
      </svg>
      <svg class="gd-rewind-ring-svg" width="208" height="208" viewBox="0 0 208 208" fill="none">
        <circle cx="104" cy="104" r="86" stroke="rgba(139, 106, 43, 0.14)" stroke-width="1.2"/>
        <circle class="gd-rewind-progress-arc" cx="104" cy="104" r="86" stroke="#9C752C" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="${PROGRESS_CIRCUMFERENCE.toFixed(2)}" stroke-dashoffset="${PROGRESS_CIRCUMFERENCE.toFixed(2)}" opacity="0.72"/>
      </svg>
      <div class="gd-rewind-core">
        <svg class="gd-rewind-arrows" width="20" height="12" viewBox="0 0 38 24" fill="none">
          <path d="M18 4L6 12L18 20V4Z" fill="#8B6A2B" opacity="0.78"/>
          <path d="M32 4L20 12L32 20V4Z" fill="#8B6A2B" opacity="0.78"/>
        </svg>
        <span class="gd-rewind-year">2026 AD</span>
        <span class="gd-rewind-divider"></span>
        <span class="gd-rewind-era-name">Rewinding</span>
        <span class="gd-rewind-caption">Back through time</span>
      </div>
    </div>
  `;
  const hudYearEl = hudEl.querySelector('.gd-rewind-year') as HTMLElement | null;
  const hudTitleEl = hudEl.querySelector('.gd-rewind-era-name') as HTMLElement | null;
  const hudDescEl = hudEl.querySelector('.gd-rewind-caption') as HTMLElement | null;
  const hudProgressEl = hudEl.querySelector('.gd-rewind-progress-arc') as SVGCircleElement | null;

  const ensureHudMounted = () => {
    const parent = canvas.parentElement;
    if (!parent) return;
    if (!parent.contains(hudEl)) parent.appendChild(hudEl);
  };

  const resize = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    width = Math.max(320, window.innerWidth);
    height = Math.max(320, window.innerHeight);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener('resize', resize, { passive: true });

  const sparks: MemorySpark[] = Array.from({ length: 65 }, (_, i) => ({
    x: Math.random() * width,
    y: Math.random() * height,
    vy: -(20 + Math.random() * 42),
    driftAmp: 10 + Math.random() * 20,
    driftFreq: 0.9 + Math.random() * 1.3,
    phase: Math.random() * Math.PI * 2,
    radius: 1.2 + Math.random() * 2.2,
    alpha: 0.36 + Math.random() * 0.48,
    color: sparkColors[i % sparkColors.length],
  }));

  const clockRings: RomanClockRing[] = [
    { x: width * 0.16, y: height * 0.28, r: 108, angle: 0, spinSpeed: -0.22, alpha: 0.12 },
    { x: width * 0.56, y: height * 0.48, r: 164, angle: 1.1, spinSpeed: -0.14, alpha: 0.095 },
    { x: width * 0.84, y: height * 0.24, r: 92, angle: 2.3, spinSpeed: -0.28, alpha: 0.11 },
  ];

  const archivePages: ArchivePage[] = Array.from({ length: 9 }, (_, i) => ({
    x: Math.random() * width,
    y: Math.random() * height,
    vx: 38 + Math.random() * 48,
    vy: -(16 + Math.random() * 26),
    w: 15 + (i % 3) * 3.5,
    h: 20 + (i % 3) * 4.5,
    rot: (Math.random() - 0.5) * 0.8,
    rotSpeed: (Math.random() - 0.5) * 1.4,
    tumble: Math.random() * Math.PI * 2,
    tumbleSpeed: 1.6 + Math.random() * 1.6,
    phase: Math.random() * Math.PI * 2,
    alpha: 0.72 + Math.random() * 0.2,
    hasWaxSeal: i % 2 === 0,
  }));

  const lingerPages: LingerPage[] = [];

  const drawRomanClockRing = (ring: RomanClockRing, alpha: number) => {
    if (alpha <= 0.01) return;
    ctx.save();
    ctx.translate(ring.x, ring.y);
    ctx.rotate(ring.angle);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = '#9E6822';
    ctx.fillStyle = '#8C5818';

    // Outer & inner concentric brass dial rings
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(0, 0, ring.r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(0, 0, ring.r * 0.78, 0, Math.PI * 2);
    ctx.stroke();

    // 12 dial ticks + cardinal Roman numerals
    const numerals = ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
    ctx.font = '600 12px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < 12; i++) {
      const a = (i * Math.PI) / 6 - Math.PI / 2;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      ctx.beginPath();
      ctx.moveTo(cos * ring.r * 0.94, sin * ring.r * 0.94);
      ctx.lineTo(cos * ring.r, sin * ring.r);
      ctx.stroke();

      if (i % 3 === 0) {
        ctx.save();
        ctx.translate(cos * ring.r * 0.87, sin * ring.r * 0.87);
        ctx.rotate(a + Math.PI / 2);
        ctx.fillText(numerals[i], 0, 0);
        ctx.restore();
      }
    }
    ctx.restore();
  };

  const drawArchivePage = (
    p: Pick<ArchivePage, 'x' | 'y' | 'w' | 'h' | 'rot' | 'tumble' | 'hasWaxSeal'>,
    alpha: number,
    shadowRatio: number,
  ) => {
    if (alpha <= 0.01) return;
    ctx.save();
    ctx.translate(p.x, p.y);

    const flat = Math.cos(p.tumble);
    const scaleY = (flat >= 0 ? 1 : -1) * Math.max(0.32, Math.abs(flat));

    if (shadowRatio > 0.02) {
      ctx.save();
      ctx.translate(2 * shadowRatio, 3 * shadowRatio);
      ctx.rotate(p.rot);
      ctx.scale(1, Math.abs(scaleY));
      ctx.globalAlpha = alpha * 0.2 * shadowRatio;
      ctx.fillStyle = '#38240E';
      ctx.fillRect(-p.w * 0.5, -p.h * 0.5, p.w, p.h);
      ctx.restore();
    }

    ctx.rotate(p.rot);
    ctx.scale(1, scaleY);
    ctx.globalAlpha = alpha;

    // Aged parchment sheet with folded top-right dog-ear
    const hw = p.w * 0.5;
    const hh = p.h * 0.5;
    const fold = Math.min(4.5, p.w * 0.28);
    ctx.beginPath();
    ctx.moveTo(-hw, -hh);
    ctx.lineTo(hw - fold, -hh);
    ctx.lineTo(hw, -hh + fold);
    ctx.lineTo(hw, hh);
    ctx.lineTo(-hw, hh);
    ctx.closePath();
    ctx.fillStyle = flat >= 0 ? '#F6E8C8' : '#E5D1A8';
    ctx.fill();
    ctx.lineWidth = 0.85;
    ctx.strokeStyle = 'rgba(112, 74, 28, 0.55)';
    ctx.stroke();

    // Dog-ear crease
    ctx.beginPath();
    ctx.moveTo(hw - fold, -hh);
    ctx.lineTo(hw - fold, -hh + fold);
    ctx.lineTo(hw, -hh + fold);
    ctx.stroke();

    // Faint archival ink lines
    ctx.beginPath();
    ctx.moveTo(-hw + 3, -hh + 5);
    ctx.lineTo(hw - fold - 2, -hh + 5);
    ctx.moveTo(-hw + 3, -hh + 9);
    ctx.lineTo(hw - 3, -hh + 9);
    ctx.moveTo(-hw + 3, -hh + 13);
    ctx.lineTo(hw - 5, -hh + 13);
    ctx.lineWidth = 0.7;
    ctx.strokeStyle = 'rgba(92, 62, 28, 0.45)';
    ctx.stroke();

    // Tiny crimson archival wax seal dot
    if (p.hasWaxSeal) {
      ctx.fillStyle = '#9E3224';
      ctx.beginPath();
      ctx.arc(hw - 4.5, hh - 4.5, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  };

  const spawnLingerPages = () => {
    lingerPages.length = 0;
    const minX = Math.min(340, width * 0.35);
    const maxX = Math.max(minX + 80, width - 140);
    const candidates = archivePages.filter(
      (p) => p.x >= minX && p.x <= maxX && p.y >= height * 0.14 && p.y <= height * 0.65,
    );

    for (const idx of [0, 1]) {
      const src = candidates[idx];
      lingerPages.push({
        x: src ? src.x : width * (0.4 + idx * 0.24),
        y: src ? src.y : height * (0.24 + idx * 0.1),
        vx: 26 + Math.random() * 22,
        vy: 30 + Math.random() * 14,
        w: src ? src.w : 16 + idx * 2,
        h: src ? src.h : 21 + idx * 3,
        rot: src ? src.rot : (idx === 0 ? -0.2 : 0.22),
        tumble: src ? src.tumble : 0,
        tumbleSpeed: 1.5 + Math.random() * 0.8,
        phase: idx * 2.3 + Math.random(),
        swayAmp: 34 + Math.random() * 18,
        swayFreq: 1.45 + Math.random() * 0.4,
        targetY: Math.max(120, height - (16 + idx * 8 + Math.random() * 6)),
        restRot: (idx === 0 ? -0.15 : 0.22) + (Math.random() - 0.5) * 0.18,
        alpha: 0.88,
        hasWaxSeal: idx === 0,
        settled: false,
        settledAge: 0,
      });
    }
  };

  const drawEraPlumesAndSparks = (alpha: number) => {
    for (const p of eraPlumes) {
      const lifeRatio = p.age / p.maxAge;
      const a = Math.sin(Math.min(1, lifeRatio * 4.5) * Math.PI * 0.5) * Math.pow(1 - lifeRatio, 1.35) * alpha;
      if (a <= 0.01) continue;
      ctx.save();
      if (p.tone === 'ember') {
        const g = ctx.createRadialGradient(p.x, p.y, 0.4, p.x, p.y, p.r * 2.2);
        g.addColorStop(0, `rgba(255, 245, 190, ${Math.min(1, a * 1.4).toFixed(2)})`);
        g.addColorStop(0.55, `rgba(252, 138, 36, ${(a * 0.85).toFixed(2)})`);
        g.addColorStop(1, 'rgba(180, 42, 10, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 2.2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const g = ctx.createRadialGradient(p.x - p.r * 0.2, p.y - p.r * 0.2, p.r * 0.12, p.x, p.y, p.r);
        if (p.tone === 'steam') {
          g.addColorStop(0, `rgba(255, 252, 242, ${(a * 0.62).toFixed(2)})`);
          g.addColorStop(0.5, `rgba(235, 222, 198, ${(a * 0.34).toFixed(2)})`);
          g.addColorStop(1, 'rgba(235, 222, 198, 0)');
        } else if (p.tone === 'soot') {
          g.addColorStop(0, `rgba(82, 62, 42, ${(a * 0.38).toFixed(2)})`);
          g.addColorStop(0.5, `rgba(128, 102, 70, ${(a * 0.2).toFixed(2)})`);
          g.addColorStop(1, 'rgba(128, 102, 70, 0)');
        } else if (p.tone === 'ash') {
          g.addColorStop(0, `rgba(54, 32, 18, ${(a * 0.68).toFixed(2)})`);
          g.addColorStop(0.55, `rgba(148, 72, 24, ${(a * 0.32).toFixed(2)})`);
          g.addColorStop(1, 'rgba(92, 52, 26, 0)');
        } else {
          g.addColorStop(0, `rgba(218, 174, 106, ${(a * 0.45).toFixed(2)})`);
          g.addColorStop(1, 'rgba(218, 174, 106, 0)');
        }
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    for (const sp of eraSparks) {
      const a = Math.max(0, 1 - sp.life / sp.maxLife) * alpha;
      if (a <= 0.01) continue;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.strokeStyle = sp.hot ? '#FFF7CE' : '#FF8A2B';
      ctx.lineWidth = sp.size;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(sp.x, sp.y);
      ctx.lineTo(sp.x - sp.vx * 0.032, sp.y - sp.vy * 0.032);
      ctx.stroke();
      ctx.restore();
    }
  };

  const updateEraEmitters = (dt: number, eraIdx: number, eraT: number, active: boolean) => {
    // Advance existing plumes & ballistic sparks smoothly
    for (let i = eraPlumes.length - 1; i >= 0; i--) {
      const p = eraPlumes[i];
      p.age += dt;
      if (p.age >= p.maxAge) {
        eraPlumes.splice(i, 1);
        continue;
      }
      if (p.tone === 'ember') {
        p.vy += 175 * dt;
      } else if (p.tone === 'steam' || p.tone === 'soot') {
        p.vx += (-96 - p.vx) * Math.min(1, dt * 1.45);
        p.vy *= Math.max(0, 1 - dt * 1.35);
        p.vy -= 4.5 * dt;
        p.r += p.grow * dt;
      } else {
        p.vx += (-18 - p.vx) * Math.min(1, dt * 1.4);
        p.r += p.grow * dt;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }

    for (let i = eraSparks.length - 1; i >= 0; i--) {
      const sp = eraSparks[i];
      sp.life += dt;
      if (sp.life >= sp.maxLife) {
        eraSparks.splice(i, 1);
        continue;
      }
      sp.vy += 320 * dt;
      sp.vx *= Math.exp(-dt * 1.6);
      sp.x += sp.vx * dt;
      sp.y += sp.vy * dt;
    }

    if (!active) return;
    const groundY = height - 10;

    if (eraIdx === 0) {
      const groundTrackTop = groundY - 9;
      const progress = eraT / ERA_DURATION;
      const trainX = -260 + progress * (width + 780);
      const wheelAngle = clock * 8.4;
      const chugBurst = Math.pow(0.5 + 0.5 * Math.sin(wheelAngle * 2), 1.4);
      steamEmitAcc += dt;
      while (steamEmitAcc >= 0.022) {
        steamEmitAcc -= 0.022;
        const stackX = trainX + 94;
        const stackY = groundTrackTop - 72;
        // Dense continuous curling slipstream exhaust hugging boiler & coach roofs
        eraPlumes.push({
          x: stackX + (Math.random() - 0.5) * 3.5,
          y: stackY + (Math.random() - 0.5) * 2,
          vx: -94 - Math.random() * 48,
          vy: -24 - chugBurst * 26 - Math.random() * 14,
          r: 5.2 + chugBurst * 3.8,
          grow: 11 + Math.random() * 7,
          age: 0,
          maxAge: 1.25 + Math.random() * 0.45,
          tone: Math.random() < 0.34 ? 'soot' : 'steam',
        });
        if (chugBurst > 0.45 || Math.random() < 0.45) {
          eraPlumes.push({
            x: stackX - 4 + (Math.random() - 0.5) * 4,
            y: stackY - 2,
            vx: -112 - Math.random() * 42,
            vy: -16 - chugBurst * 16 - Math.random() * 10,
            r: 4.5 + Math.random() * 3.2,
            grow: 12 + Math.random() * 6,
            age: 0,
            maxAge: 1.05 + Math.random() * 0.4,
            tone: 'steam',
          });
        }
        // Subtle safety-valve wisp atop steam dome
        if (Math.random() < 0.18) {
          eraPlumes.push({
            x: trainX + 46,
            y: groundTrackTop - 65,
            vx: -88 - Math.random() * 30,
            vy: -12 - Math.random() * 10,
            r: 2.6 + Math.random() * 1.6,
            grow: 7.5,
            age: 0,
            maxAge: 0.65 + Math.random() * 0.25,
            tone: 'steam',
          });
        }
        // Cylinder drain-cock high-pressure white steam jetting low across the rails
        if (chugBurst > 0.52) {
          eraPlumes.push({
            x: trainX + 86,
            y: groundTrackTop - 9,
            vx: -125 - Math.random() * 45,
            vy: -6 + Math.random() * 9,
            r: 3.4 + Math.random() * 2.4,
            grow: 13.5,
            age: 0,
            maxAge: 0.68 + Math.random() * 0.26,
            tone: 'steam',
          });
        }
      }
    } else if (eraIdx === 1) {
      const duelCenterNow = width * 0.69 + Math.sin(clock * 0.72) * 32;
      dustEmitAcc += dt;
      while (dustEmitAcc >= 0.085) {
        dustEmitAcc -= 0.085;
        eraPlumes.push({
          x: duelCenterNow + (Math.random() - 0.5) * 90,
          y: groundY - 3 - Math.random() * 8,
          vx: (Math.random() - 0.5) * 26,
          vy: -8 - Math.random() * 12,
          r: 8 + Math.random() * 7,
          grow: 14,
          age: 0,
          maxAge: 1.4 + Math.random() * 0.6,
          tone: 'dust',
        });
      }
    } else if (eraIdx === 2) {
      const progress = (eraT % ERA_DURATION) / ERA_DURATION;
      const cx = width + 180 - progress * (width + 460);
      dustEmitAcc += dt;
      while (dustEmitAcc >= 0.055) {
        dustEmitAcc -= 0.055;
        eraPlumes.push({
          x: cx + (Math.random() - 0.1) * 95,
          y: groundY - 3 - Math.random() * 9,
          vx: 44 + Math.random() * 34,
          vy: -12 - Math.random() * 18,
          r: 8 + Math.random() * 6,
          grow: 16,
          age: 0,
          maxAge: 1.3 + Math.random() * 0.6,
          tone: 'dust',
        });
      }
    } else if (eraIdx === 3) {
      volcanoSurge = Math.max(0, volcanoSurge - dt * 0.55);
      const vx = width * 0.89;
      const craterY = groundY - 124;
      const emitStep = volcanoSurge > 0.2 ? 0.026 : 0.044;
      volcanoEmitAcc += dt;
      while (volcanoEmitAcc >= emitStep) {
        volcanoEmitAcc -= emitStep;
        // Towering Plinian pyroclastic ash column expanding wide into an anvil canopy
        const speedUp = 82 + volcanoSurge * 54 + Math.random() * 50;
        eraPlumes.push({
          x: vx + (Math.random() - 0.5) * 32,
          y: craterY,
          vx: (Math.random() - 0.35) * 58,
          vy: -speedUp,
          r: 14 + Math.random() * 10,
          grow: 24 + Math.random() * 16,
          age: 0,
          maxAge: 2.5 + Math.random() * 1.1,
          tone: 'ash',
        });
        // Ballistic incandescent lava bombs & glowing pyroclasts arcing high from caldera
        if (Math.random() < (0.82 + volcanoSurge * 0.16)) {
          eraPlumes.push({
            x: vx + (Math.random() - 0.5) * 24,
            y: craterY - 4,
            vx: (Math.random() - 0.58) * (175 + volcanoSurge * 95),
            vy: -(140 + volcanoSurge * 85 + Math.random() * 105),
            r: 2.2 + Math.random() * 2.5,
            grow: 0,
            age: 0,
            maxAge: 1.55 + Math.random() * 0.7,
            tone: 'ember',
          });
        }
      }

      // Dynamic Dinosaur Footstep & Triceratops Hoof-Impact Ash Dust
      const strideImpact = Math.abs(Math.sin(clock * 2.9));
      const triImpact = Math.abs(Math.sin(clock * 2.6));
      if ((strideImpact > 0.96 || triImpact > 0.96) && Math.random() < 0.5) {
        const txNow = width * 0.53 + ((eraT % ERA_DURATION) / ERA_DURATION) * (width * 0.08);
        const triNow = txNow + 225;
        const spawnX = triImpact > 0.96 ? triNow : txNow;
        eraPlumes.push({
          x: spawnX + (Math.random() - 0.5) * 28,
          y: groundY - 4,
          vx: (Math.random() - 0.5) * 32,
          vy: -12 - Math.random() * 14,
          r: 6 + Math.random() * 5,
          grow: 13,
          age: 0,
          maxAge: 0.9 + Math.random() * 0.4,
          tone: 'dust',
        });
      }
    }
  };

  const drawEraSteamTrain = (eraT: number, alpha: number) => {
    if (alpha <= 0.01) return;
    const groundY = height - 10;
    const railY = groundY - 9;
    const progress = eraT / ERA_DURATION;
    const trainX = -260 + progress * (width + 780);
    const wheelAngle = clock * 8.4;

    ctx.save();
    ctx.globalAlpha = alpha;

    // 1. Atmospheric Industrial Horizon (factory smokestacks, brick water tower, windmill & telegraph poles)
    ctx.fillStyle = 'rgba(130, 105, 70, 0.14)';
    ctx.fillRect(width * 0.18, railY - 28, 42, 24);
    ctx.fillRect(width * 0.24, railY - 40, 26, 36);
    ctx.fillRect(width * 0.27, railY - 64, 7, 60);
    ctx.fillRect(width * 0.31, railY - 56, 6, 52);
    // Water tower on trestle stilts
    ctx.strokeStyle = 'rgba(120, 95, 62, 0.22)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(width * 0.72, railY - 4);
    ctx.lineTo(width * 0.72 + 5, railY - 28);
    ctx.moveTo(width * 0.72 + 22, railY - 4);
    ctx.lineTo(width * 0.72 + 17, railY - 28);
    ctx.stroke();
    ctx.fillRect(width * 0.72 + 2, railY - 46, 18, 18);
    ctx.beginPath();
    ctx.moveTo(width * 0.72, railY - 46);
    ctx.lineTo(width * 0.72 + 11, railY - 54);
    ctx.lineTo(width * 0.72 + 22, railY - 46);
    ctx.fill();

    // Spinning wooden windmill silhouette
    const wmX = width * 0.44;
    const wmY = railY - 56;
    ctx.beginPath();
    ctx.moveTo(wmX - 10, railY - 4);
    ctx.lineTo(wmX - 3, wmY);
    ctx.lineTo(wmX + 3, wmY);
    ctx.lineTo(wmX + 10, railY - 4);
    ctx.fill();
    ctx.save();
    ctx.translate(wmX, wmY);
    ctx.rotate(clock * 0.65);
    ctx.strokeStyle = 'rgba(130, 105, 70, 0.22)';
    ctx.lineWidth = 2.4;
    for (let b = 0; b < 4; b++) {
      ctx.rotate(Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -24);
      ctx.stroke();
    }
    ctx.restore();

    // Telegraph poles + sagged catenary copper lines
    ctx.strokeStyle = 'rgba(94, 72, 44, 0.26)';
    ctx.lineWidth = 1.4;
    const poleStep = 148;
    for (let px = 40; px < width + poleStep; px += poleStep) {
      ctx.beginPath();
      ctx.moveTo(px, railY - 4);
      ctx.lineTo(px, railY - 54);
      ctx.moveTo(px - 8, railY - 48);
      ctx.lineTo(px + 8, railY - 48);
      ctx.stroke();
      if (px + poleStep < width + poleStep) {
        ctx.beginPath();
        ctx.moveTo(px - 6, railY - 48);
        ctx.quadraticCurveTo(px + poleStep * 0.5, railY - 38, px + poleStep - 6, railY - 48);
        ctx.moveTo(px + 6, railY - 48);
        ctx.quadraticCurveTo(px + poleStep * 0.5, railY - 37, px + poleStep + 6, railY - 48);
        ctx.stroke();
      }
    }

    // 2. Realistic Multi-Layer Crushed Ballast Roadbed, Oak Sleepers & Steel I-Beam Rail
    const earthGrad = ctx.createLinearGradient(0, railY + 3, 0, height);
    earthGrad.addColorStop(0, '#786246');
    earthGrad.addColorStop(0.28, '#59452E');
    earthGrad.addColorStop(1, '#312316');
    ctx.fillStyle = earthGrad;
    ctx.fillRect(0, railY + 3, width, height - (railY + 3));

    // Crushed granite/limestone shoulder highlight along ballast crown
    const ballastGrad = ctx.createLinearGradient(0, railY + 1, 0, railY + 8);
    ballastGrad.addColorStop(0, 'rgba(176, 152, 118, 0.65)');
    ballastGrad.addColorStop(1, 'rgba(92, 72, 48, 0.85)');
    ctx.fillStyle = ballastGrad;
    ctx.fillRect(0, railY + 2, width, 6);

    // Deterministic angular ballast gravel aggregate texture
    for (let gx = 4; gx < width; gx += 7) {
      const h1 = ((gx * 37) % 11) / 11;
      const h2 = ((gx * 53) % 7) / 7;
      ctx.fillStyle = h1 > 0.5 ? 'rgba(208, 186, 152, 0.45)' : 'rgba(42, 31, 19, 0.52)';
      ctx.fillRect(gx + h2 * 3, railY + 3.5 + h1 * 8.5, 2.6, 1.8);
    }

    // Creosoted oak crosstie sleepers with recessed depth & iron tie plates
    for (let sx = 6; sx < width; sx += 19) {
      ctx.fillStyle = 'rgba(22, 15, 9, 0.72)';
      ctx.fillRect(sx - 0.5, railY + 3.8, 11.5, 3.2);
      ctx.fillStyle = '#4B331C';
      ctx.fillRect(sx, railY + 1.8, 10.5, 4.2);
      ctx.fillStyle = 'rgba(138, 104, 68, 0.55)';
      ctx.fillRect(sx + 0.5, railY + 1.8, 9.5, 1.1);
      ctx.fillStyle = '#221A12';
      ctx.fillRect(sx + 2.2, railY + 0.8, 6.2, 1.4);
      ctx.fillRect(sx + 3, railY, 1.2, 1.2);
      ctx.fillRect(sx + 6.4, railY, 1.2, 1.2);
    }

    // Steel I-beam rail: base flange, shadowed web, and gleaming burnished railhead
    ctx.fillStyle = '#2B2016';
    ctx.fillRect(0, railY + 1.4, width, 1.3);
    ctx.fillStyle = '#463726';
    ctx.fillRect(0, railY + 0.5, width, 1.0);
    const railTopGrad = ctx.createLinearGradient(0, railY - 0.8, 0, railY + 0.6);
    railTopGrad.addColorStop(0, '#EFE0BE');
    railTopGrad.addColorStop(1, '#9A8158');
    ctx.fillStyle = railTopGrad;
    ctx.fillRect(0, railY - 0.7, width, 1.4);

    // Rail fishplate joint bars every 114px
    ctx.fillStyle = '#332517';
    for (let jx = 52; jx < width; jx += 114) {
      ctx.fillRect(jx, railY - 0.2, 9, 2.2);
    }

    // Helper: Flanged spoked wheel with cast rim, optional crescent counterweight & crankpin
    const drawSpokedWheel = (
      wx: number,
      radius: number,
      spokes: number,
      isDriver: boolean
    ) => {
      const wy = railY - radius;
      ctx.save();
      ctx.translate(wx, wy);

      // Rail contact shadow
      ctx.fillStyle = 'rgba(18, 12, 7, 0.65)';
      ctx.beginPath();
      ctx.ellipse(0, radius, radius * 0.75, 1.8, 0, 0, Math.PI * 2);
      ctx.fill();

      // Rear steel flange & rolled tire ring
      ctx.beginPath();
      ctx.arc(0, 0, radius + 1.0, 0, Math.PI * 2);
      ctx.fillStyle = '#4F3E2A';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(0, 0, radius - 0.2, 0, Math.PI * 2);
      ctx.fillStyle = '#23190F';
      ctx.fill();

      // Polished tread rim
      ctx.strokeStyle = isDriver ? '#C9B186' : '#A9916B';
      ctx.lineWidth = isDriver ? 1.7 : 1.1;
      ctx.beginPath();
      ctx.arc(0, 0, radius - 0.8, 0, Math.PI * 2);
      ctx.stroke();

      // Open inner wheel cavity so ballast/rods show behind spokes
      ctx.beginPath();
      ctx.arc(0, 0, radius - 2.6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(34, 24, 15, 0.55)';
      ctx.fill();

      // Rotating spokes + counterweight + crankpin boss
      ctx.save();
      ctx.rotate(wheelAngle);
      ctx.strokeStyle = '#735A3B';
      ctx.lineWidth = isDriver ? 1.35 : 0.95;
      for (let s = 0; s < spokes; s++) {
        const ang = (s * Math.PI * 2) / spokes;
        ctx.beginPath();
        ctx.moveTo(Math.cos(ang) * 2.4, Math.sin(ang) * 2.4);
        ctx.lineTo(Math.cos(ang) * (radius - 2.6), Math.sin(ang) * (radius - 2.6));
        ctx.stroke();
      }
      if (isDriver) {
        // Heavy cast-iron crescent counterweight opposite the crankpin
        ctx.fillStyle = '#2B1F13';
        ctx.beginPath();
        ctx.arc(0, 0, radius - 2.6, Math.PI - 0.72, Math.PI + 0.72);
        ctx.lineTo(Math.cos(Math.PI + 0.72) * (radius * 0.48), Math.sin(Math.PI + 0.72) * (radius * 0.48));
        ctx.arc(0, 0, radius * 0.48, Math.PI + 0.72, Math.PI - 0.72, true);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#6A5337';
        ctx.lineWidth = 0.7;
        ctx.stroke();

        // Crankpin boss
        ctx.fillStyle = '#C8A567';
        ctx.beginPath();
        ctx.arc(radius * 0.54, 0, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // Brass/iron central axle hub
      ctx.fillStyle = isDriver ? '#B69459' : '#6F583B';
      ctx.beginPath();
      ctx.arc(0, 0, isDriver ? 3.4 : 2.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1E150C';
      ctx.beginPath();
      ctx.arc(0, 0, isDriver ? 1.4 : 0.9, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    };

    // Helper: 4-wheel Arch-Bar Bogie Truck (leaf springs, side frame beam & journal boxes)
    const drawBogieTruck = (centerX: number) => {
      const wheelR = 6.2;
      const ax1 = centerX - 11;
      const ax2 = centerX + 11;
      drawSpokedWheel(ax1, wheelR, 8, false);
      drawSpokedWheel(ax2, wheelR, 8, false);
      const axleY = railY - wheelR;

      ctx.fillStyle = '#2B2014';
      ctx.beginPath();
      ctx.moveTo(ax1 - 4, axleY - 1.8);
      ctx.lineTo(ax2 + 4, axleY - 1.8);
      ctx.lineTo(ax2 + 2, axleY + 1.8);
      ctx.lineTo(ax1 - 2, axleY + 1.8);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#4A3823';
      ctx.fillRect(centerX - 6, axleY - 4.2, 12, 4);
      ctx.strokeStyle = '#8F714A';
      ctx.lineWidth = 0.7;
      ctx.strokeRect(centerX - 6, axleY - 4.2, 12, 4);

      ctx.fillStyle = '#3B2C1B';
      ctx.fillRect(ax1 - 2.6, axleY - 2.6, 5.2, 5.2);
      ctx.fillRect(ax2 - 2.6, axleY - 2.6, 5.2, 5.2);
    };

    // Helper: Authentic Victorian Pullman Passenger Coach (clerestory roof, vestibuled steps, under-truss, lit curtains)
    const drawPullmanCoach = (cx: number, hasAccordionFront: boolean) => {
      const coachW = 144;
      const sillY = railY - 17;
      const roofY = railY - 56;
      const bodyH = sillY - roofY;

      // Queen-post underframe truss rods & Westinghouse air-brake tank
      ctx.strokeStyle = 'rgba(40, 29, 18, 0.9)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(cx + 12, sillY + 3.5);
      ctx.lineTo(cx + 50, railY - 8);
      ctx.lineTo(cx + 94, railY - 8);
      ctx.lineTo(cx + coachW - 12, sillY + 3.5);
      ctx.moveTo(cx + 50, sillY + 3);
      ctx.lineTo(cx + 50, railY - 8);
      ctx.moveTo(cx + 94, sillY + 3);
      ctx.lineTo(cx + 94, railY - 8);
      ctx.stroke();

      ctx.fillStyle = '#251B11';
      ctx.fillRect(cx + 60, sillY + 3, 24, 6);
      ctx.strokeStyle = '#6B5233';
      ctx.lineWidth = 0.7;
      ctx.strokeRect(cx + 60, sillY + 3, 24, 6);

      drawBogieTruck(cx + 28);
      drawBogieTruck(cx + coachW - 28);

      // Recessed end vestibule boarding steps
      for (const sx of [cx + 2, cx + coachW - 10]) {
        ctx.fillStyle = '#2B1E12';
        ctx.fillRect(sx, sillY + 2, 8, 2.2);
        ctx.fillRect(sx + 1, sillY + 5, 6.5, 2.2);
        ctx.fillRect(sx + 2, sillY + 8, 5, 2);
      }

      // Steel underframe channel beam
      ctx.fillStyle = '#1E150C';
      ctx.fillRect(cx + 1, sillY, coachW - 2, 4.2);

      // Mahogany Pullman body inside vestibules
      const bodyX = cx + 10;
      const bodyW = coachW - 20;
      const bodyGrad = ctx.createLinearGradient(0, roofY + 5, 0, sillY);
      bodyGrad.addColorStop(0, '#442D19');
      bodyGrad.addColorStop(0.55, '#342111');
      bodyGrad.addColorStop(1, '#21140A');
      ctx.fillStyle = bodyGrad;
      ctx.fillRect(bodyX, roofY + 6, bodyW, bodyH - 6);

      // Subtle vertical tongue-and-groove timber paneling lines
      ctx.strokeStyle = 'rgba(20, 12, 6, 0.32)';
      ctx.lineWidth = 0.6;
      for (let px = bodyX + 4; px < bodyX + bodyW; px += 4) {
        ctx.beginPath();
        ctx.moveTo(px, roofY + 24);
        ctx.lineTo(px, sillY - 1);
        ctx.stroke();
      }

      // Gold-leaf Pullman belt rail & eaves pinstriping
      ctx.fillStyle = 'rgba(209, 171, 98, 0.55)';
      ctx.fillRect(bodyX, sillY - 10, bodyW, 1.1);
      ctx.fillRect(bodyX, roofY + 8, bodyW, 1.0);

      // Vestibule end platforms, wrought-iron gates & brass grab stanchions
      for (const vx of [cx + 2, cx + coachW - 10]) {
        ctx.fillStyle = 'rgba(34, 24, 15, 0.85)';
        ctx.fillRect(vx, roofY + 8, 8, bodyH - 8);
        ctx.strokeStyle = '#9C7B4C';
        ctx.lineWidth = 1.0;
        ctx.beginPath();
        ctx.moveTo(vx + 2, sillY);
        ctx.lineTo(vx + 2, roofY + 9);
        ctx.moveTo(vx + 6, sillY);
        ctx.lineTo(vx + 6, roofY + 9);
        ctx.moveTo(vx + 1, sillY - 9);
        ctx.lineTo(vx + 7, sillY - 9);
        ctx.stroke();
      }

      // 6 Arched Victorian Passenger Windows with warm gaslamp glow, muntins & velvet curtains
      const winCount = 6;
      const winPad = 8;
      const winGap = (bodyW - winPad * 2) / winCount;
      for (let w = 0; w < winCount; w++) {
        const wx = bodyX + winPad + w * winGap;
        const wy = roofY + 12;
        const ww = winGap - 5.5;
        const wh = 13.5;

        ctx.fillStyle = '#1D1209';
        ctx.beginPath();
        ctx.roundRect(wx - 1, wy - 1, ww + 2, wh + 2, [4, 4, 1, 1]);
        ctx.fill();

        const glowGrad = ctx.createRadialGradient(
          wx + ww * 0.5,
          wy + wh * 0.35,
          1,
          wx + ww * 0.5,
          wy + wh * 0.5,
          ww * 0.9
        );
        glowGrad.addColorStop(0, 'rgba(255, 232, 168, 0.92)');
        glowGrad.addColorStop(0.65, 'rgba(232, 178, 88, 0.62)');
        glowGrad.addColorStop(1, 'rgba(138, 92, 38, 0.38)');
        ctx.fillStyle = glowGrad;
        ctx.beginPath();
        ctx.roundRect(wx, wy, ww, wh, [3, 3, 0.5, 0.5]);
        ctx.fill();

        ctx.fillStyle = 'rgba(66, 36, 18, 0.72)';
        ctx.beginPath();
        ctx.moveTo(wx, wy);
        ctx.lineTo(wx + 3.2, wy);
        ctx.quadraticCurveTo(wx + 2.4, wy + wh * 0.55, wx + 0.6, wy + wh);
        ctx.lineTo(wx, wy + wh);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(wx + ww, wy);
        ctx.lineTo(wx + ww - 3.2, wy);
        ctx.quadraticCurveTo(wx + ww - 2.4, wy + wh * 0.55, wx + ww - 0.6, wy + wh);
        ctx.lineTo(wx + ww, wy + wh);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = '#2A1B0E';
        ctx.fillRect(wx, wy + 4, ww, 1.0);
      }

      // Outer Arched Coach Roof + Overhang Eaves
      ctx.fillStyle = '#271A0E';
      ctx.beginPath();
      ctx.moveTo(cx - 1, roofY + 8);
      ctx.quadraticCurveTo(cx + coachW * 0.5, roofY + 2.5, cx + coachW + 1, roofY + 8);
      ctx.lineTo(cx + coachW + 1, roofY + 10.5);
      ctx.lineTo(cx - 1, roofY + 10.5);
      ctx.closePath();
      ctx.fill();

      // Raised Clerestory Monitor Deck with glowing transom slits & brass roof vents
      const clX = bodyX + 6;
      const clW = bodyW - 12;
      ctx.fillStyle = '#1E140B';
      ctx.beginPath();
      ctx.roundRect(clX, roofY - 1, clW, 6.5, 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(250, 214, 134, 0.5)';
      for (let tx = clX + 6; tx < clX + clW - 6; tx += 12) {
        ctx.fillRect(tx, roofY + 2, 7, 1.8);
      }
      ctx.fillStyle = '#5C452B';
      ctx.fillRect(clX + 24, roofY - 3, 5, 2.2);
      ctx.fillRect(clX + clW - 29, roofY - 3, 5, 2.2);

      // Accordion Canvas Gangway Diaphragm & Knuckle Coupler connecting forward
      if (hasAccordionFront) {
        const gx = cx + coachW;
        ctx.fillStyle = '#1E150C';
        ctx.fillRect(gx, roofY + 11, 10, bodyH - 11);
        ctx.strokeStyle = 'rgba(130, 102, 68, 0.55)';
        ctx.lineWidth = 0.8;
        for (let f = 2; f <= 8; f += 2.5) {
          ctx.beginPath();
          ctx.moveTo(gx + f, roofY + 11);
          ctx.lineTo(gx + f, sillY);
          ctx.stroke();
        }
        ctx.fillStyle = '#1B130B';
        ctx.fillRect(gx - 2, sillY + 0.5, 14, 3);
      }
    };

    // 3. Draw Twin Passenger Coaches
    drawPullmanCoach(trainX - 404, true);
    drawPullmanCoach(trainX - 250, true);

    // 4. Draw Riveted Coal Tender (with bogie trucks, water dome & glittering anthracite heap)
    const tenderX = trainX - 96;
    const tenderW = 84;
    const tenderSillY = railY - 16;
    const tenderTopY = railY - 44;

    drawBogieTruck(tenderX + 18);
    drawBogieTruck(tenderX + tenderW - 18);

    ctx.fillStyle = '#1A120A';
    ctx.fillRect(tenderX + tenderW - 2, tenderSillY + 0.5, 16, 3.2);

    ctx.fillStyle = '#1F150C';
    ctx.fillRect(tenderX, tenderSillY, tenderW, 4);

    // Jagged heaped anthracite coal pile
    ctx.fillStyle = '#18120B';
    ctx.beginPath();
    ctx.moveTo(tenderX + 8, tenderTopY + 1);
    ctx.lineTo(tenderX + 19, tenderTopY - 8);
    ctx.lineTo(tenderX + 31, tenderTopY - 6);
    ctx.lineTo(tenderX + 43, tenderTopY - 10);
    ctx.lineTo(tenderX + 57, tenderTopY - 5);
    ctx.lineTo(tenderX + 70, tenderTopY - 3);
    ctx.lineTo(tenderX + 78, tenderTopY + 1);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(176, 146, 102, 0.42)';
    ctx.fillRect(tenderX + 22, tenderTopY - 6, 3, 2);
    ctx.fillRect(tenderX + 40, tenderTopY - 8, 4, 2);
    ctx.fillRect(tenderX + 54, tenderTopY - 4, 3, 2);

    const tenderGrad = ctx.createLinearGradient(0, tenderTopY, 0, tenderSillY);
    tenderGrad.addColorStop(0, '#3D2B19');
    tenderGrad.addColorStop(1, '#1E140B');
    ctx.fillStyle = tenderGrad;
    ctx.fillRect(tenderX + 2, tenderTopY, tenderW - 4, tenderSillY - tenderTopY);
    ctx.fillStyle = '#291C10';
    ctx.fillRect(tenderX, tenderTopY - 1.5, tenderW, 3);
    ctx.fillStyle = 'rgba(209, 171, 98, 0.52)';
    ctx.fillRect(tenderX + 4, tenderTopY + 7, tenderW - 8, 1.1);
    ctx.fillRect(tenderX + 4, tenderSillY - 4, tenderW - 8, 1.0);
    ctx.fillStyle = '#A88246';
    ctx.fillRect(tenderX + 6, tenderTopY - 4.5, 8, 3.2);
    ctx.fillStyle = 'rgba(255, 198, 92, 0.85)';
    ctx.beginPath();
    ctx.arc(tenderX, tenderTopY + 4, 2.2, 0, Math.PI * 2);
    ctx.fill();

    // 5. Realistic 1885 4-6-0 Steam Locomotive
    const driveXs = [trainX + 14, trainX + 45, trainX + 76];
    const driverR = 14.5;
    const driveCY = railY - driverR;

    drawSpokedWheel(trainX + 95, 6.8, 8, false);
    drawSpokedWheel(trainX + 111, 6.8, 8, false);

    // Cowcatcher wedge + diagonal iron bars
    ctx.fillStyle = '#23180E';
    ctx.beginPath();
    ctx.moveTo(trainX + 104, railY - 13);
    ctx.lineTo(trainX + 131, railY - 2);
    ctx.lineTo(trainX + 104, railY - 2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#755A38';
    ctx.lineWidth = 1.0;
    for (let s = 0; s < 5; s++) {
      ctx.beginPath();
      ctx.moveTo(trainX + 106, railY - 12 + s * 2.1);
      ctx.lineTo(trainX + 129 - s * 4.5, railY - 2.2);
      ctx.stroke();
    }

    // Engineer's Cab (tapered Victorian arch window + glowing coal firebox inside)
    const cabX = trainX - 9;
    const cabW = 30;
    const cabTopY = railY - 68;
    const cabSillY = railY - 18;
    ctx.fillStyle = '#2D1E11';
    ctx.fillRect(cabX, cabTopY + 4, cabW, cabSillY - (cabTopY + 4));
    ctx.fillStyle = '#1D130A';
    ctx.beginPath();
    ctx.moveTo(cabX - 4, cabTopY + 5);
    ctx.quadraticCurveTo(cabX + cabW * 0.5, cabTopY, cabX + cabW + 3, cabTopY + 5);
    ctx.lineTo(cabX + cabW + 3, cabTopY + 8);
    ctx.lineTo(cabX - 4, cabTopY + 8);
    ctx.closePath();
    ctx.fill();

    const cabWinGrad = ctx.createRadialGradient(cabX + 16, cabTopY + 20, 1, cabX + 16, cabTopY + 20, 16);
    cabWinGrad.addColorStop(0, 'rgba(255, 198, 92, 0.94)');
    cabWinGrad.addColorStop(0.55, 'rgba(226, 118, 36, 0.72)');
    cabWinGrad.addColorStop(1, 'rgba(72, 34, 14, 0.65)');
    ctx.fillStyle = cabWinGrad;
    ctx.beginPath();
    ctx.roundRect(cabX + 5, cabTopY + 11, 18, 16, [5, 5, 1, 1]);
    ctx.fill();
    ctx.fillStyle = '#24170C';
    ctx.fillRect(cabX + 13.5, cabTopY + 11, 1.5, 16);
    ctx.beginPath();
    ctx.arc(cabX + 10, cabTopY + 19, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(cabX + 7, cabTopY + 21, 6, 6);

    // Cylindrical Horizontal Boiler Barrel & Riveted Smokebox
    const boilerY = railY - 55;
    const boilerH = 26;
    const boilerGrad = ctx.createLinearGradient(0, boilerY, 0, boilerY + boilerH);
    boilerGrad.addColorStop(0, '#4E3923');
    boilerGrad.addColorStop(0.28, '#362616');
    boilerGrad.addColorStop(1, '#1C130A');
    ctx.fillStyle = boilerGrad;
    ctx.fillRect(trainX + 20, boilerY, 64, boilerH);

    ctx.fillStyle = '#A88246';
    for (const bx of [trainX + 34, trainX + 51, trainX + 68, trainX + 83]) {
      ctx.fillRect(bx, boilerY, 1.4, boilerH);
    }

    const sbGrad = ctx.createLinearGradient(0, boilerY - 0.5, 0, boilerY + boilerH + 1);
    sbGrad.addColorStop(0, '#302214');
    sbGrad.addColorStop(0.4, '#22180D');
    sbGrad.addColorStop(1, '#150E07');
    ctx.fillStyle = sbGrad;
    ctx.fillRect(trainX + 83, boilerY - 0.5, 25, boilerH + 1);
    ctx.beginPath();
    ctx.moveTo(trainX + 108, boilerY + 1);
    ctx.quadraticCurveTo(trainX + 113, boilerY + boilerH * 0.5, trainX + 108, boilerY + boilerH - 1);
    ctx.closePath();
    ctx.fillStyle = '#2B1F13';
    ctx.fill();

    ctx.fillStyle = '#261A0E';
    ctx.fillRect(trainX - 6, boilerY + boilerH - 2, 118, 3.2);
    ctx.strokeStyle = '#C9A462';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(trainX + 21, boilerY + 9);
    ctx.lineTo(trainX + 105, boilerY + 9);
    ctx.stroke();

    // Brass-crowned Steam Dome & Sand Dome
    const drawDome = (dx: number, w: number, h: number, crown: boolean) => {
      const dg = ctx.createLinearGradient(dx - w * 0.5, 0, dx + w * 0.5, 0);
      dg.addColorStop(0, '#2A1D10');
      dg.addColorStop(0.45, '#594228');
      dg.addColorStop(1, '#1B1209');
      ctx.fillStyle = dg;
      ctx.beginPath();
      ctx.roundRect(dx - w * 0.5, boilerY - h, w, h + 1, [w * 0.45, w * 0.45, 0, 0]);
      ctx.fill();
      if (crown) {
        ctx.fillStyle = '#D1A960';
        ctx.fillRect(dx - 2.5, boilerY - h - 2.5, 5, 2.5);
        ctx.fillRect(dx + 1, boilerY - h - 3.5, 1.8, 3.5);
      }
    };
    drawDome(trainX + 46, 13, 10.5, true);
    drawDome(trainX + 66, 11.5, 9, false);
    ctx.strokeStyle = 'rgba(72, 54, 34, 0.85)';
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.moveTo(trainX + 64, boilerY + boilerH - 2);
    ctx.quadraticCurveTo(trainX + 66, railY - 22, trainX + 71, railY - 10);
    ctx.stroke();

    // Flared Victorian Diamond Smokestack (exact center trainX + 94, crown top railY - 72)
    const stackX = trainX + 94;
    const stackTopY = railY - 72;
    ctx.fillStyle = '#24190E';
    ctx.beginPath();
    ctx.moveTo(stackX - 4.2, boilerY);
    ctx.lineTo(stackX - 3.5, stackTopY + 7);
    ctx.lineTo(stackX - 7.5, stackTopY + 3);
    ctx.lineTo(stackX + 7.5, stackTopY + 3);
    ctx.lineTo(stackX + 3.5, stackTopY + 7);
    ctx.lineTo(stackX + 4.2, boilerY);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#C9A25B';
    ctx.beginPath();
    ctx.roundRect(stackX - 7.8, stackTopY, 15.6, 3.4, 1.2);
    ctx.fill();

    // Bracket-mounted Victorian Brass Headlamp + Forward Light Beam Cone
    const lampX = trainX + 109;
    const lampY = boilerY - 3;
    const beamGrad = ctx.createRadialGradient(lampX + 4, lampY - 2, 1, lampX + 95, lampY + 6, 115);
    beamGrad.addColorStop(0, 'rgba(255, 224, 132, 0.34)');
    beamGrad.addColorStop(0.5, 'rgba(255, 206, 98, 0.11)');
    beamGrad.addColorStop(1, 'rgba(255, 200, 86, 0)');
    ctx.fillStyle = beamGrad;
    ctx.beginPath();
    ctx.moveTo(lampX + 3, lampY - 4);
    ctx.lineTo(lampX + 125, lampY - 20);
    ctx.lineTo(lampX + 125, lampY + 26);
    ctx.lineTo(lampX + 3, lampY + 3);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#A68042';
    ctx.fillRect(lampX - 5, lampY - 6, 8, 8);
    ctx.fillStyle = '#FFF0B3';
    ctx.fillRect(lampX + 2.5, lampY - 5, 2.2, 6);

    // Three Large Flanged 12-Spoke Driving Wheels with Crescent Counterweights
    for (const wx of driveXs) {
      drawSpokedWheel(wx, driverR, 12, true);
    }

    // Riveted Steam Cylinder Saddle & Drain Cock Petcocks
    const cylX = trainX + 82;
    const cylY = railY - 22;
    ctx.fillStyle = '#2B1F13';
    ctx.beginPath();
    ctx.roundRect(cylX, cylY, 21, 13, 2);
    ctx.fill();
    ctx.strokeStyle = '#9C7B4C';
    ctx.lineWidth = 0.85;
    ctx.strokeRect(cylX, cylY, 21, 13);
    ctx.fillStyle = '#B89352';
    ctx.fillRect(cylX - 1.5, cylY + 2, 2, 9);
    ctx.fillRect(cylX + 20.5, cylY + 2, 2, 9);
    ctx.fillRect(cylX + 4, railY - 9.5, 3, 2.5);

    // Kinematic Piston Rod, Sliding Crosshead, Main Connecting Rod & 3-Axle Coupling Rod
    const crankRadius = driverR * 0.54;
    const crankDX = Math.cos(wheelAngle) * crankRadius;
    const crankDY = Math.sin(wheelAngle) * crankRadius;
    const crossheadX = cylX - 15 + crankDX * 0.72;
    const crossheadY = cylY + 6.5;

    ctx.strokeStyle = '#6E5537';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(cylX, crossheadY - 2.6);
    ctx.lineTo(cylX - 24, crossheadY - 2.6);
    ctx.moveTo(cylX, crossheadY + 2.6);
    ctx.lineTo(cylX - 24, crossheadY + 2.6);
    ctx.stroke();

    ctx.strokeStyle = '#D5BC8B';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(cylX, crossheadY);
    ctx.lineTo(crossheadX, crossheadY);
    ctx.stroke();

    ctx.fillStyle = '#B9975B';
    ctx.fillRect(crossheadX - 3, crossheadY - 3, 6, 6);

    ctx.strokeStyle = '#E0C792';
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(driveXs[0] + crankDX, driveCY + crankDY);
    ctx.lineTo(driveXs[2] + crankDX, driveCY + crankDY);
    ctx.stroke();

    ctx.strokeStyle = '#F2DCAB';
    ctx.lineWidth = 2.9;
    ctx.beginPath();
    ctx.moveTo(crossheadX, crossheadY);
    ctx.lineTo(driveXs[1] + crankDX, driveCY + crankDY);
    ctx.stroke();

    ctx.fillStyle = '#FFF0C2';
    for (const wx of driveXs) {
      ctx.beginPath();
      ctx.arc(wx + crankDX, driveCY + crankDY, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.strokeStyle = 'rgba(182, 148, 92, 0.75)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(cylX - 10, cylY + 1);
    ctx.lineTo(driveXs[1] + crankDX * 0.65, driveCY + crankDY * 0.65 - 4);
    ctx.stroke();

    ctx.restore();
  };

  const drawEraMedievalDuel = (eraT: number, alpha: number) => {
    if (alpha <= 0.01) return;
    const groundY = height - 8;

    const duelShiftX = Math.sin(clock * 0.72) * 32;
    const duelCenterX = width * 0.69 + duelShiftX;
    const knightFocus = Math.max(0, 1 - Math.hypot(pointerX - duelCenterX, pointerY - (groundY - 44)) / 170);

    ctx.save();
    ctx.globalAlpha = alpha;

    // 1. Distant Medieval Stone Fortress Curtain Wall, Pitched Keep & Battlements
    const castleX = Math.max(width * 0.80, width - 230);
    ctx.fillStyle = 'rgba(54, 36, 18, 0.36)';
    ctx.fillRect(castleX, groundY - 76, 36, 76);
    ctx.fillRect(castleX + 36, groundY - 50, 74, 50);
    ctx.fillRect(castleX + 110, groundY - 94, 42, 94);
    ctx.beginPath();
    ctx.moveTo(castleX + 106, groundY - 94);
    ctx.lineTo(castleX + 131, groundY - 122);
    ctx.lineTo(castleX + 156, groundY - 94);
    ctx.closePath();
    ctx.fill();
    for (let bx = castleX; bx < castleX + 148; bx += 11) {
      ctx.fillRect(bx, groundY - 56, 6, 6);
    }
    ctx.fillStyle = 'rgba(255, 168, 62, 0.55)';
    ctx.fillRect(castleX + 129, groundY - 68, 3, 9);
    const fWave = Math.sin(clock * 4.8) * 4;
    ctx.fillStyle = 'rgba(138, 42, 28, 0.58)';
    ctx.beginPath();
    ctx.moveTo(castleX + 131, groundY - 122);
    ctx.lineTo(castleX + 131, groundY - 142);
    ctx.quadraticCurveTo(castleX + 150, groundY - 138 + fWave, castleX + 166, groundY - 134 - fWave * 0.5);
    ctx.lineTo(castleX + 131, groundY - 128);
    ctx.fill();

    // 2. Jagged Defensive Wooden Stakes / Palisade on far flanks
    ctx.strokeStyle = 'rgba(58, 38, 18, 0.56)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (const sx of [duelCenterX - 155, duelCenterX - 143, duelCenterX + 145, duelCenterX + 157]) {
      ctx.beginPath();
      ctx.moveTo(sx, groundY + 4);
      ctx.lineTo(sx + (sx < duelCenterX ? 9 : -9), groundY - 22);
      ctx.stroke();
    }

    // 3. Flickering Battlefield Brazier Fire-Glow illuminating the Knights' Steel Armor
    const fireFlicker = 0.8 + 0.2 * Math.sin(clock * 11.4);
    const torchGlow = ctx.createRadialGradient(
      duelCenterX + 120,
      groundY - 14,
      3,
      duelCenterX + 120,
      groundY - 16,
      78,
    );
    torchGlow.addColorStop(0, `rgba(255, 224, 148, ${(0.72 * fireFlicker).toFixed(2)})`);
    torchGlow.addColorStop(0.4, `rgba(242, 118, 28, ${(0.35 * fireFlicker).toFixed(2)})`);
    torchGlow.addColorStop(1, 'rgba(180, 48, 12, 0)');
    ctx.fillStyle = torchGlow;
    ctx.beginPath();
    ctx.arc(duelCenterX + 120, groundY - 16, 78, 0, Math.PI * 2);
    ctx.fill();

    // 4. Photoreal Medieval War-Arrow Volleys along true quadratic gravity arcs
    const drawRealisticArrow = (
      x: number,
      y: number,
      ang: number,
      scale: number,
      arrowAlpha: number,
      isBroadhead: boolean,
      quiver = 0,
    ) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang + quiver);
      ctx.scale(scale, scale);
      ctx.globalAlpha = arrowAlpha;

      // Dark horn self-nock at tail
      ctx.fillStyle = '#181009';
      ctx.beginPath();
      ctx.moveTo(-21.6, -1.05);
      ctx.lineTo(-19.2, -0.72);
      ctx.lineTo(-19.2, 0.72);
      ctx.lineTo(-21.6, 1.05);
      ctx.lineTo(-20.5, 0);
      ctx.closePath();
      ctx.fill();

      // Natural parabolic barred goose-feather fletching (upper & lower vanes + quill barbs)
      for (const side of [-1, 1] as const) {
        const featherGrad = ctx.createLinearGradient(-19.5, 0, -10.5, side * 3.4);
        featherGrad.addColorStop(0, '#F0E4CA');
        featherGrad.addColorStop(0.55, '#D7C199');
        featherGrad.addColorStop(1, '#9A7D56');
        ctx.fillStyle = featherGrad;
        ctx.beginPath();
        ctx.moveTo(-19.5, side * 0.55);
        ctx.quadraticCurveTo(-17.8, side * 3.35, -13.2, side * 3.05);
        ctx.lineTo(-10.4, side * 0.55);
        ctx.closePath();
        ctx.fill();

        // Delicate barred feather quill markings
        ctx.strokeStyle = 'rgba(84, 60, 34, 0.42)';
        ctx.lineWidth = 0.48;
        ctx.beginPath();
        for (let fx = -17.6; fx <= -12.0; fx += 1.85) {
          ctx.moveTo(fx, side * 0.7);
          ctx.lineTo(fx - 1.1, side * 2.65);
        }
        ctx.stroke();
      }

      // Cylindrical shaded turned ash/chestnut shaft (tapered barrel)
      const shaftGrad = ctx.createLinearGradient(0, -1.1, 0, 1.1);
      shaftGrad.addColorStop(0, '#8A613B');
      shaftGrad.addColorStop(0.45, '#51341B');
      shaftGrad.addColorStop(1, '#23140A');
      ctx.fillStyle = shaftGrad;
      ctx.beginPath();
      ctx.moveTo(-19.4, -0.62);
      ctx.lineTo(-4.0, -0.88);
      ctx.lineTo(7.4, -0.74);
      ctx.lineTo(7.4, 0.74);
      ctx.lineTo(-4.0, 0.88);
      ctx.lineTo(-19.4, 0.62);
      ctx.closePath();
      ctx.fill();

      // Crimson waxed-silk fletching binding wraps & center cock-feather crest
      ctx.fillStyle = '#922318';
      ctx.fillRect(-19.4, -0.78, 1.3, 1.56);
      ctx.fillRect(-10.9, -0.92, 1.6, 1.84);
      ctx.fillStyle = 'rgba(244, 234, 212, 0.58)';
      ctx.fillRect(-18.0, -0.28, 6.8, 0.56);

      // Forged iron socket ferrule fitting cleanly onto shaft
      const ferruleGrad = ctx.createLinearGradient(6.2, -1.1, 6.2, 1.1);
      ferruleGrad.addColorStop(0, '#8F8271');
      ferruleGrad.addColorStop(0.55, '#41372D');
      ferruleGrad.addColorStop(1, '#1A130D');
      ctx.fillStyle = ferruleGrad;
      ctx.beginPath();
      ctx.moveTo(6.0, -0.92);
      ctx.lineTo(9.4, -1.18);
      ctx.lineTo(9.4, 1.18);
      ctx.lineTo(6.0, 0.92);
      ctx.closePath();
      ctx.fill();

      // Faceted two-bevel steel head (broadhead or armor-piercing bodkin) split along central ridge
      const tipX = isBroadhead ? 17.4 : 18.2;
      const barbBackX = isBroadhead ? 7.8 : 9.2;
      const wingHalfH = isBroadhead ? 2.85 : 1.72;
      // Upper sunlit chamfered bevel
      const topBevelGrad = ctx.createLinearGradient(8.8, -wingHalfH, tipX, 0);
      topBevelGrad.addColorStop(0, '#D4C8B4');
      topBevelGrad.addColorStop(0.55, '#8A7E6D');
      topBevelGrad.addColorStop(1, '#ECE2D0');
      ctx.fillStyle = topBevelGrad;
      ctx.beginPath();
      ctx.moveTo(tipX, 0);
      ctx.lineTo(barbBackX, -wingHalfH);
      ctx.lineTo(9.4, -0.2);
      ctx.lineTo(9.4, 0);
      ctx.closePath();
      ctx.fill();

      // Lower shadowed forged iron bevel
      ctx.fillStyle = '#211811';
      ctx.beginPath();
      ctx.moveTo(tipX, 0);
      ctx.lineTo(9.4, 0);
      ctx.lineTo(9.4, 0.2);
      ctx.lineTo(barbBackX, wingHalfH);
      ctx.closePath();
      ctx.fill();

      // Razor specular edge highlight
      ctx.strokeStyle = 'rgba(255, 248, 232, 0.85)';
      ctx.lineWidth = 0.55;
      ctx.beginPath();
      ctx.moveTo(barbBackX + 0.5, -wingHalfH + 0.35);
      ctx.lineTo(tipX - 0.3, -0.08);
      ctx.stroke();

      ctx.restore();
    };

    const drawVolley = (
      specs: Array<{
        startX: number;
        startY: number;
        endX: number;
        endY: number;
        peak: number;
        phase: number;
        speed: number;
        scale: number;
        depthAlpha: number;
        broadhead: boolean;
      }>,
    ) => {
      for (const a of specs) {
        const cycle = (eraT * a.speed + a.phase) % 1;
        if (cycle > 0.76) continue;
        const p = cycle / 0.76;
        const edgeFade = Math.min(1, Math.min(p * 6.5, (1 - p) * 5.0));
        const arrowAlpha = alpha * edgeFade * a.depthAlpha;
        if (arrowAlpha <= 0.02) continue;

        const evalPos = (u: number) => ({
          x: a.startX + (a.endX - a.startX) * u,
          y: a.startY + (a.endY - a.startY) * u - 4 * a.peak * u * (1 - u),
        });

        const pos = evalPos(p);
        const vx = a.endX - a.startX;
        const vy = a.endY - a.startY - 4 * a.peak * (1 - 2 * p);
        const ang = Math.atan2(vy, vx);

        // Curved air-wake ribbon sampled along true ballistic parabola behind tail
        if (p > 0.06) {
          const p0 = Math.max(0, p - 0.09);
          const p1 = Math.max(0, p - 0.045);
          const q0 = evalPos(p0);
          const q1 = evalPos(p1);
          const tailOffset = 19 * a.scale;
          const tailX = pos.x - Math.cos(ang) * tailOffset;
          const tailY = pos.y - Math.sin(ang) * tailOffset;
          const wakeGrad = ctx.createLinearGradient(q0.x, q0.y, tailX, tailY);
          wakeGrad.addColorStop(0, 'rgba(84, 62, 38, 0)');
          wakeGrad.addColorStop(1, `rgba(84, 62, 38, ${(0.22 * arrowAlpha).toFixed(2)})`);
          ctx.save();
          ctx.strokeStyle = wakeGrad;
          ctx.lineWidth = 0.85 * a.scale;
          ctx.beginPath();
          ctx.moveTo(q0.x, q0.y);
          ctx.quadraticCurveTo(q1.x, q1.y, tailX, tailY);
          ctx.stroke();
          ctx.restore();
        }

        drawRealisticArrow(pos.x, pos.y, ang, a.scale, arrowAlpha, a.broadhead);
      }
    };

    drawVolley([
      // Far atmospheric volley rising high from siege lines
      { startX: width * 0.21, startY: groundY - 24, endX: castleX + 46, endY: groundY - 52, peak: 175, phase: 0.03, speed: 0.54, scale: 0.78, depthAlpha: 0.56, broadhead: false },
      { startX: width * 0.23, startY: groundY - 20, endX: castleX + 94, endY: groundY - 68, peak: 196, phase: 0.11, speed: 0.54, scale: 0.8, depthAlpha: 0.58, broadhead: false },
      // Mid-ground primary attacking longbow volley (sleek wood + steel broadheads)
      { startX: width * 0.20, startY: groundY - 32, endX: duelCenterX + 124, endY: groundY - 16, peak: 146, phase: 0.17, speed: 0.58, scale: 0.96, depthAlpha: 0.84, broadhead: true },
      { startX: width * 0.24, startY: groundY - 22, endX: castleX + 36, endY: groundY - 40, peak: 184, phase: 0.24, speed: 0.58, scale: 1.0, depthAlpha: 0.86, broadhead: true },
      { startX: width * 0.22, startY: groundY - 28, endX: duelCenterX + 92, endY: groundY - 22, peak: 158, phase: 0.54, speed: 0.58, scale: 0.94, depthAlpha: 0.82, broadhead: false },
      // Castle rampart defenders' downward counter-volley
      { startX: castleX + 24, startY: groundY - 60, endX: duelCenterX - 188, endY: groundY - 14, peak: 132, phase: 0.34, speed: 0.6, scale: 0.94, depthAlpha: 0.82, broadhead: true },
      { startX: castleX + 52, startY: groundY - 78, endX: duelCenterX - 152, endY: groundY - 18, peak: 156, phase: 0.41, speed: 0.6, scale: 0.9, depthAlpha: 0.78, broadhead: false },
      { startX: castleX + 16, startY: groundY - 54, endX: duelCenterX - 214, endY: groundY - 12, peak: 122, phase: 0.70, speed: 0.6, scale: 0.88, depthAlpha: 0.76, broadhead: true },
    ]);

    // Grounded battlefield arrows embedded at natural ballistic impact angles in turf & flanks
    drawRealisticArrow(duelCenterX - 134, groundY - 7, 0.74, 0.9, alpha * 0.82, true, Math.sin(clock * 14) * 0.015);
    drawRealisticArrow(duelCenterX + 136, groundY - 9, Math.PI - 0.68, 0.88, alpha * 0.8, false, Math.sin(clock * 11 + 1.2) * 0.012);

    // 5. Uneven Muddy Siege Battlefield Ground Terrain + Cobbles + Turfs
    const earthGrad = ctx.createLinearGradient(0, groundY - 7, 0, height);
    earthGrad.addColorStop(0, '#3D2714');
    earthGrad.addColorStop(0.5, '#26170A');
    earthGrad.addColorStop(1, '#140B04');
    ctx.fillStyle = earthGrad;
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    for (let gx = 0; gx <= width + 48; gx += 48) {
      const mound = Math.sin(gx * 0.04) * 3.8 + Math.cos(gx * 0.09) * 2.2;
      ctx.lineTo(gx, groundY - mound);
    }
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#190E05';
    for (const [rx, rw, rh] of [
      [duelCenterX - 96, 18, 5],
      [duelCenterX - 38, 12, 3.5],
      [duelCenterX + 42, 16, 4.5],
      [duelCenterX + 104, 22, 6],
    ]) {
      ctx.beginPath();
      ctx.ellipse(rx, groundY + 1, rw, rh, 0, Math.PI, Math.PI * 2);
      ctx.fill();
    }

    // 6. Realistic 3-Phase HEMA / Chivalric Combat Timing & Metallic Clash Sparks
    const tempo = 1.05 + knightFocus * 0.45;
    const combatProgress = (clock * tempo) % 3;
    const combatPhase = Math.floor(combatProgress);
    const t = combatProgress - combatPhase;
    const smoothT = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const strikePeak = Math.sin(smoothT * Math.PI);
    const clashBeat = Math.floor(clock * tempo * 2);

    if ((strikePeak > 0.88 || knightFocus > 0.72) && clashBeat !== lastClashBeat) {
      lastClashBeat = clashBeat;
      const sx = duelCenterX + (combatPhase === 0 ? 4 : -4);
      const sy = groundY - (combatPhase === 2 ? 42 : 56);
      for (let k = 0; k < 18; k++) {
        const a = Math.random() * Math.PI * 2;
        const speed = 100 + Math.random() * 190;
        eraSparks.push({
          x: sx,
          y: sy,
          vx: Math.cos(a) * speed,
          vy: Math.sin(a) * speed - 54,
          life: 0,
          maxLife: 0.34 + Math.random() * 0.3,
          size: 1.3 + Math.random() * 1.2,
          hot: k % 3 !== 0,
        });
      }
    }

    // 7. Big, Heavily Armored Authentic Plate Knights (1.28x crouched HEMA duel scale)
    const drawRealKnight = (
      kx: number,
      dir: 1 | -1,
      lean: number,
      stepOffset: number,
      footLift: number,
      crouchY: number,
      swordShoulderAngle: number,
      swordElbowAngle: number,
      shieldFwd: number,
      shieldHeight: number,
      isCrimson: boolean,
    ) => {
      ctx.save();
      ctx.translate(kx, groundY);
      ctx.scale(dir * 1.28, 1.28);

      ctx.fillStyle = 'rgba(18, 10, 4, 0.36)';
      ctx.beginPath();
      ctx.ellipse(2, 0, 26, 3.8, 0, 0, Math.PI * 2);
      ctx.fill();

      const steelGrad = ctx.createLinearGradient(-14, -68, 18, 0);
      steelGrad.addColorStop(0, '#625444');
      steelGrad.addColorStop(0.4, '#2E2319');
      steelGrad.addColorStop(1, '#140E08');

      // Tattered Trailing Heraldic Battle Mantle
      const capeWhip = Math.sin(clock * 5.6 + dir) * 4.5 + stepOffset * 0.4;
      ctx.fillStyle = isCrimson ? '#5C2216' : '#263024';
      ctx.beginPath();
      ctx.moveTo(-6, -46 + crouchY);
      ctx.bezierCurveTo(-20 + lean * 6, -34, -24 + capeWhip, -18, -21 + capeWhip * 0.6, -4);
      ctx.lineTo(-14 + capeWhip * 0.3, -8);
      ctx.lineTo(-9, -15);
      ctx.quadraticCurveTo(-6, -30, -2, -45 + crouchY);
      ctx.closePath();
      ctx.fill();

      // Rear Pushing Leg
      ctx.fillStyle = '#1B130B';
      ctx.beginPath();
      ctx.moveTo(-7, -28 + crouchY);
      ctx.quadraticCurveTo(-15 - lean * 4, -20, -18 - stepOffset * 0.4, -14);
      ctx.quadraticCurveTo(-20 - stepOffset * 0.4, -7, -22 - stepOffset * 0.5, -2);
      ctx.lineTo(-12 - stepOffset * 0.5, -1);
      ctx.quadraticCurveTo(-14 - stepOffset * 0.4, -8, -11 - stepOffset * 0.4, -15);
      ctx.quadraticCurveTo(-7 - lean * 3, -22, 0, -27 + crouchY);
      ctx.closePath();
      ctx.fill();

      // Forward Articulated Stepping/Lunging Leg
      ctx.fillStyle = steelGrad;
      ctx.beginPath();
      ctx.moveTo(2, -28 + crouchY);
      ctx.quadraticCurveTo(13 + stepOffset * 0.5, -24, 16 + stepOffset * 0.7, -15 - footLift * 0.5);
      ctx.quadraticCurveTo(17 + stepOffset * 0.7, -8 - footLift, 16 + stepOffset * 0.8, -1 - footLift);
      ctx.lineTo(25 + stepOffset * 0.8, -footLift);
      ctx.lineTo(23 + stepOffset * 0.8, -5 - footLift);
      ctx.quadraticCurveTo(22 + stepOffset * 0.7, -11 - footLift * 0.5, 20 + stepOffset * 0.6, -16 - footLift * 0.4);
      ctx.quadraticCurveTo(16 + stepOffset * 0.4, -24, 8, -28 + crouchY);
      ctx.closePath();
      ctx.fill();

      // Sculpted Gothic Breastplate Cuirass + Chainmail + Hip Tassets & Scabbard
      ctx.save();
      ctx.translate(0, -27 + crouchY);
      ctx.rotate(lean * 0.34);

      ctx.strokeStyle = '#3B2814';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(-3, 2);
      ctx.lineTo(-17, 17);
      ctx.stroke();

      ctx.fillStyle = '#36302A';
      ctx.fillRect(-7, 2, 15, 4.5);

      ctx.fillStyle = steelGrad;
      ctx.beginPath();
      ctx.moveTo(-8, -21);
      ctx.quadraticCurveTo(1, -23, 10, -20);
      ctx.lineTo(7, -6);
      ctx.lineTo(10, 4);
      ctx.lineTo(-9, 4);
      ctx.lineTo(-6, -6);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(225, 204, 166, 0.42)';
      ctx.lineWidth = 0.8;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(4, -19);
      ctx.lineTo(3, -5);
      ctx.stroke();
      ctx.fillStyle = '#4A2E14';
      ctx.fillRect(-6.5, -7, 14, 2.2);

      // Laminated 3-Plate Shoulder Pauldron
      ctx.fillStyle = steelGrad;
      ctx.beginPath();
      ctx.moveTo(-9, -20);
      ctx.quadraticCurveTo(-1, -26, 8, -19);
      ctx.quadraticCurveTo(5, -13, -2, -12);
      ctx.quadraticCurveTo(-8, -13, -9, -20);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Detailed Gothic Sallet / Armet Helmet
      ctx.fillStyle = steelGrad;
      ctx.beginPath();
      ctx.moveTo(-5, -22);
      ctx.lineTo(-8, -32);
      ctx.quadraticCurveTo(-1, -39, 8, -35);
      ctx.lineTo(13.5, -29.5);
      ctx.lineTo(8, -24);
      ctx.lineTo(4, -21);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = '#120C06';
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.moveTo(5, -31);
      ctx.lineTo(12, -30);
      ctx.stroke();

      ctx.fillStyle = isCrimson ? '#7C291C' : '#8A6324';
      ctx.beginPath();
      ctx.moveTo(-1, -36);
      ctx.quadraticCurveTo(-10, -41 - capeWhip * 0.2, -16, -32);
      ctx.quadraticCurveTo(-9, -34, -2, -33);
      ctx.closePath();
      ctx.fill();

      // Articulated 2-Segment Plate Arm + Authentic Cruciform Steel Broadsword
      ctx.save();
      ctx.translate(2, -18);
      ctx.rotate(swordShoulderAngle);
      ctx.fillStyle = steelGrad;
      ctx.beginPath();
      ctx.roundRect(-2, -2.8, 13, 5.2, 2.2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(11, 0, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.translate(11, 0);
      ctx.rotate(swordElbowAngle);
      ctx.beginPath();
      ctx.roundRect(-1, -2.4, 12.5, 4.8, 2);
      ctx.fill();
      ctx.fillStyle = '#B8842E';
      ctx.beginPath();
      ctx.arc(9.5, 0, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3B2814';
      ctx.fillRect(10.5, -1.5, 5, 3);
      ctx.fillStyle = '#A88648';
      ctx.beginPath();
      ctx.moveTo(15, -8);
      ctx.quadraticCurveTo(17, 0, 15, 8);
      ctx.lineTo(17.2, 7);
      ctx.quadraticCurveTo(19, 0, 17.2, -7);
      ctx.closePath();
      ctx.fill();
      const bladeGrad = ctx.createLinearGradient(17, -2.5, 17, 2.5);
      bladeGrad.addColorStop(0, '#EFE6D0');
      bladeGrad.addColorStop(0.45, '#786956');
      bladeGrad.addColorStop(1, '#33291E');
      ctx.fillStyle = bladeGrad;
      ctx.beginPath();
      ctx.moveTo(17, -2.3);
      ctx.lineTo(52, -1.0);
      ctx.lineTo(58, 0);
      ctx.lineTo(52, 1.0);
      ctx.lineTo(17, 2.3);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(28, 18, 8, 0.55)';
      ctx.lineWidth = 0.85;
      ctx.beginPath();
      ctx.moveTo(18.5, 0);
      ctx.lineTo(44, 0);
      ctx.stroke();
      ctx.restore();

      // Battle-Scarred Iron-Rimmed Heater Shield
      ctx.save();
      ctx.translate(9 + shieldFwd * 4, -14 - shieldHeight * 5);
      ctx.rotate(-0.15 - shieldHeight * 0.16);
      ctx.fillStyle = isCrimson ? '#3C2214' : '#242A21';
      ctx.beginPath();
      ctx.moveTo(-6, -12);
      ctx.lineTo(7, -12);
      ctx.lineTo(6.5, 4);
      ctx.lineTo(0, 13.5);
      ctx.lineTo(-5.5, 4);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(182, 146, 86, 0.78)';
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.fillStyle = '#C9963A';
      ctx.beginPath();
      ctx.arc(0.5, -2, 2.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.restore();
      ctx.restore();
    };

    if (combatPhase === 0) {
      const footLift = Math.sin(smoothT * Math.PI) * 5;
      drawRealKnight(
        duelCenterX - 52 + smoothT * 18,
        1,
        0.25 + strikePeak * 0.35,
        smoothT * 7,
        footLift,
        strikePeak * 2.5,
        -0.88 + smoothT * 0.65,
        -0.18 + smoothT * 0.12,
        0.15,
        0.25,
        true,
      );
      drawRealKnight(
        duelCenterX + 50 - smoothT * 6,
        -1,
        -0.18 * strikePeak,
        -smoothT * 3,
        0,
        strikePeak * 2.0,
        -0.75 + strikePeak * 0.18,
        -0.65,
        0.65 * strikePeak,
        0.85 * strikePeak,
        false,
      );
    } else if (combatPhase === 1) {
      const bindJitter = Math.sin(clock * 32) * 0.05;
      const shove = Math.max(0, smoothT - 0.55) / 0.45;
      drawRealKnight(
        duelCenterX - 34 - shove * 18,
        1,
        0.42 - shove * 0.65,
        7 - shove * 7,
        shove * 4,
        2.5,
        -0.25 + bindJitter,
        -0.12,
        0.2,
        0.4,
        true,
      );
      drawRealKnight(
        duelCenterX + 44 - shove * 14,
        -1,
        0.25 + shove * 0.35,
        shove * 6,
        shove * 3.5,
        2.0,
        -0.55 - bindJitter,
        -0.42,
        0.4 + shove * 1.4,
        0.7,
        false,
      );
    } else {
      const footLift = Math.sin(smoothT * Math.PI) * 5;
      drawRealKnight(
        duelCenterX - 52 + smoothT * 6,
        1,
        -0.12 * strikePeak,
        -smoothT * 3,
        0,
        strikePeak * 3.2,
        -0.45 + strikePeak * 0.25,
        0.48,
        0.8 * strikePeak,
        0.25,
        true,
      );
      drawRealKnight(
        duelCenterX + 50 - smoothT * 18,
        -1,
        0.28 + strikePeak * 0.32,
        smoothT * 7,
        footLift,
        strikePeak * 2.5,
        -0.72 + smoothT * 0.78,
        -0.16,
        0.15,
        0.35,
        false,
      );
    }

    ctx.restore();
  };

  const drawEraAncientEgypt = (eraT: number, alpha: number) => {
    if (alpha <= 0.01) return;
    const groundY = height - 8;

    ctx.save();
    ctx.globalAlpha = alpha;

    // 1. Blazing Low Desert Sun & Atmospheric Golden Dust Haze
    const sunGrad = ctx.createRadialGradient(width * 0.72, groundY - 92, 10, width * 0.72, groundY - 92, 118);
    sunGrad.addColorStop(0, 'rgba(255, 232, 152, 0.58)');
    sunGrad.addColorStop(0.5, 'rgba(232, 162, 54, 0.24)');
    sunGrad.addColorStop(1, 'rgba(232, 162, 54, 0)');
    ctx.fillStyle = sunGrad;
    ctx.beginPath();
    ctx.arc(width * 0.72, groundY - 92, 118, 0, Math.PI * 2);
    ctx.fill();

    // 2. Distant Rolling Sun-Lit Sahara Dunes & Three 3D-Faceted Great Limestone Pyramids
    ctx.fillStyle = 'rgba(148, 102, 46, 0.24)';
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    ctx.quadraticCurveTo(width * 0.25, groundY - 28, width * 0.52, groundY - 10);
    ctx.quadraticCurveTo(width * 0.78, groundY - 34, width, groundY - 12);
    ctx.lineTo(width, groundY);
    ctx.closePath();
    ctx.fill();

    const drawRealPyramid = (px: number, bw: number, bh: number) => {
      const splitOffset = bw * 0.14;
      ctx.fillStyle = 'rgba(136, 94, 42, 0.44)';
      ctx.beginPath();
      ctx.moveTo(px - bw * 0.5, groundY);
      ctx.lineTo(px, groundY - bh);
      ctx.lineTo(px + splitOffset, groundY);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(72, 46, 18, 0.48)';
      ctx.beginPath();
      ctx.moveTo(px + splitOffset, groundY);
      ctx.lineTo(px, groundY - bh);
      ctx.lineTo(px + bw * 0.5, groundY);
      ctx.closePath();
      ctx.fill();
    };
    drawRealPyramid(width * 0.43, 195, 118);
    drawRealPyramid(width * 0.59, 155, 94);
    drawRealPyramid(width * 0.72, 105, 62);

    // 3. Distant Carved Sandstone Obelisk & Swaying Nile Date Palm Grove on Right Horizon
    const palmX = Math.max(width * 0.85, width - 190);
    ctx.fillStyle = 'rgba(78, 52, 22, 0.42)';
    ctx.beginPath();
    ctx.moveTo(palmX - 38, groundY);
    ctx.lineTo(palmX - 35, groundY - 76);
    ctx.lineTo(palmX - 31, groundY - 86);
    ctx.lineTo(palmX - 27, groundY - 76);
    ctx.lineTo(palmX - 24, groundY);
    ctx.closePath();
    ctx.fill();

    const drawPalm = (px: number, h: number, sway: number) => {
      ctx.save();
      ctx.translate(px, groundY - 4);
      ctx.strokeStyle = 'rgba(66, 44, 18, 0.52)';
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.moveTo(0, 6);
      ctx.quadraticCurveTo(sway * 0.4, -h * 0.5, sway, -h);
      ctx.stroke();
      ctx.fillStyle = 'rgba(66, 44, 18, 0.5)';
      for (let f = -2; f <= 2; f++) {
        const ang = f * 0.52 + sway * 0.02;
        ctx.beginPath();
        ctx.moveTo(sway, -h);
        ctx.quadraticCurveTo(sway + Math.sin(ang) * 14, -h - 7 + Math.abs(f) * 3, sway + Math.sin(ang) * 23, -h + 4 + Math.abs(f) * 4);
        ctx.quadraticCurveTo(sway + Math.sin(ang) * 9, -h + 1, sway, -h);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    };
    const breeze = Math.sin(clock * 2.1) * 2.5;
    drawPalm(palmX + 18, 58, breeze);
    drawPalm(palmX + 42, 44, -breeze * 0.7 + 3);

    // 4. Sculpted Wind-Rippled Sahara Desert Dunes & Sandstone Boulders Foreground
    const duneGrad = ctx.createLinearGradient(0, groundY - 10, 0, height);
    duneGrad.addColorStop(0, '#5E3D18');
    duneGrad.addColorStop(0.5, '#3E260D');
    duneGrad.addColorStop(1, '#221305');
    ctx.fillStyle = duneGrad;
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    for (let gx = 0; gx <= width + 60; gx += 60) {
      const wave = Math.sin(gx * 0.022) * 5.5 + Math.cos(gx * 0.055) * 2.5;
      ctx.lineTo(gx, groundY - wave);
    }
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fill();

    // Subtle windswept sunlit sand ripples & sandstone rocks along ground crust
    ctx.strokeStyle = 'rgba(218, 168, 86, 0.25)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(width * 0.28, groundY + 2);
    ctx.quadraticCurveTo(width * 0.48, groundY - 3, width * 0.68, groundY + 2);
    ctx.moveTo(width * 0.62, groundY + 4);
    ctx.quadraticCurveTo(width * 0.78, groundY, width * 0.92, groundY + 3);
    ctx.stroke();

    // 5. Grand Scale Paired Thoroughbred War Stallions + Bronze Pharaoh Chariot (reverted to previous horses/chariot while keeping new desert ground)
    const progress = eraT / ERA_DURATION;
    const cx = width + 180 - progress * (width + 460);
    const gallop = clock * 10.5;

    const drawRealThoroughbred = (
      hx: number,
      hy: number,
      phaseOffset: number,
      coatTop: string,
      coatBottom: string,
      scale: number,
    ) => {
      const g = gallop + phaseOffset;
      const bounce = Math.sin(g) * 2.8;
      ctx.save();
      ctx.translate(hx, hy + bounce);
      ctx.scale(scale, scale);

      const coatGrad = ctx.createLinearGradient(0, -56, 0, -14);
      coatGrad.addColorStop(0, coatTop);
      coatGrad.addColorStop(1, coatBottom);

      // Long flowing windswept horse tail
      const tailWave = Math.sin(g * 1.15) * 4.5;
      ctx.fillStyle = coatBottom;
      ctx.beginPath();
      ctx.moveTo(24, -33);
      ctx.bezierCurveTo(36, -34 + tailWave, 46, -24 + tailWave, 48, -10 + tailWave * 0.6);
      ctx.bezierCurveTo(41, -18 + tailWave * 0.4, 34, -26, 22, -28);
      ctx.closePath();
      ctx.fill();

      // 3-Segment Anatomical Equine Leg
      const drawEquineLeg = (
        hipX: number,
        hipY: number,
        upperLen: number,
        lowerLen: number,
        upperAngle: number,
        kneeBend: number,
        topThick: number,
      ) => {
        const kx = hipX + Math.sin(upperAngle) * upperLen;
        const ky = hipY + Math.cos(upperAngle) * upperLen;
        const fx = kx + Math.sin(upperAngle + kneeBend) * lowerLen;
        const fy = ky + Math.cos(upperAngle + kneeBend) * lowerLen;
        const hoofX = fx - 1.5;
        const hoofY = fy + 2.2;

        ctx.strokeStyle = coatBottom;
        ctx.lineCap = 'round';
        ctx.lineWidth = topThick;
        ctx.beginPath();
        ctx.moveTo(hipX, hipY);
        ctx.lineTo(kx, ky);
        ctx.stroke();

        ctx.lineWidth = topThick * 0.56;
        ctx.beginPath();
        ctx.moveTo(kx, ky);
        ctx.lineTo(fx, fy);
        ctx.stroke();

        ctx.fillStyle = '#120A04';
        ctx.beginPath();
        ctx.moveTo(fx - 1.8, fy);
        ctx.lineTo(fx + 1.8, fy);
        ctx.lineTo(hoofX + 2.6, hoofY);
        ctx.lineTo(hoofX - 2.6, hoofY);
        ctx.closePath();
        ctx.fill();
      };

      // Far Foreleg & Hindleg
      drawEquineLeg(19, -28, 15, 14, Math.sin(g + 1.9) * 0.62 + 0.16, 0.36, 5.2);
      drawEquineLeg(-16, -27, 14.5, 13.5, Math.sin(g + 0.55) * 0.72 - 0.18, -0.58, 4.4);

      // True Thoroughbred Equine Barrel
      ctx.fillStyle = coatGrad;
      ctx.beginPath();
      ctx.moveTo(-22, -32);
      ctx.quadraticCurveTo(-20, -42, -11, -41);
      ctx.quadraticCurveTo(3, -38, 14, -40);
      ctx.bezierCurveTo(24, -41, 29, -33, 25, -23);
      ctx.quadraticCurveTo(17, -21, 9, -24);
      ctx.quadraticCurveTo(-4, -22, -16, -22);
      ctx.quadraticCurveTo(-25, -24, -22, -32);
      ctx.closePath();
      ctx.fill();

      // Long Graceful Arched Equine Neck + Chiseled Head Profile
      ctx.beginPath();
      ctx.moveTo(-13, -39);
      ctx.quadraticCurveTo(-22, -52, -31, -56);
      ctx.lineTo(-33, -63);
      ctx.lineTo(-36, -57);
      ctx.lineTo(-47, -45);
      ctx.lineTo(-45, -41);
      ctx.lineTo(-38, -42);
      ctx.quadraticCurveTo(-29, -41, -22, -27);
      ctx.closePath();
      ctx.fill();

      // Sculpted Mane Crest + Egyptian Royal Headband Plume
      ctx.fillStyle = '#B8842E';
      ctx.beginPath();
      ctx.moveTo(-33, -58);
      ctx.quadraticCurveTo(-30, -68, -21, -63);
      ctx.quadraticCurveTo(-26, -59, -31, -55);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(209, 157, 66, 0.78)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(-36, -54);
      ctx.lineTo(-44, -43);
      ctx.stroke();

      // Near Muscular Foreleg & Hindleg
      drawEquineLeg(21, -27, 15.5, 14.5, Math.sin(g + 2.6) * 0.68 + 0.14, 0.42, 5.6);
      drawEquineLeg(-17, -26, 15, 14, Math.sin(g) * 0.78 - 0.22, -0.68, 4.8);

      ctx.restore();
    };

    ctx.save();
    ctx.translate(cx, groundY);
    ctx.scale(1.38, 1.38);

    // Chariot Draught Yoke Pole
    ctx.strokeStyle = '#734E1E';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(46, -15);
    ctx.quadraticCurveTo(10, -17, -20, -37);
    ctx.stroke();

    // Two Paired Thoroughbred War Stallions
    drawRealThoroughbred(-14, -1, 0.65, '#66431F', '#4A2F13', 0.96);
    drawRealThoroughbred(-2, 0, 0, '#2E1D0E', '#180E05', 1.0);

    // Ornate Bowed Bronze & Rawhide Chariot Cab + Quiver + Reinforced Trim
    ctx.fillStyle = '#2B1B0C';
    ctx.beginPath();
    ctx.moveTo(35, -14);
    ctx.lineTo(66, -14);
    ctx.quadraticCurveTo(64, -36, 48, -36);
    ctx.lineTo(36, -33);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#C9963A';
    ctx.lineWidth = 1.3;
    ctx.stroke();
    ctx.strokeStyle = '#8B5D22';
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.moveTo(42, -16);
    ctx.lineTo(54, -31);
    ctx.stroke();

    // Athletic Pharaoh Chariot Warrior holding Reins & Drawing Composite Bow
    ctx.fillStyle = '#24160A';
    ctx.beginPath();
    ctx.moveTo(45, -32);
    ctx.lineTo(48, -52);
    ctx.lineTo(56, -51);
    ctx.lineTo(55, -32);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#5E3818';
    ctx.beginPath();
    ctx.moveTo(55, -35);
    ctx.quadraticCurveTo(66, -34 + Math.sin(clock * 8) * 2.5, 70, -24);
    ctx.lineTo(55, -28);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#24160A';
    ctx.beginPath();
    ctx.ellipse(50, -56.5, 4.2, 5.2, -0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2D3A45';
    ctx.beginPath();
    ctx.arc(51.5, -58.5, 4.6, Math.PI * 0.9, Math.PI * 2.05);
    ctx.fill();

    ctx.strokeStyle = '#24160A';
    ctx.lineWidth = 2.8;
    ctx.beginPath();
    ctx.moveTo(47, -49);
    ctx.lineTo(34, -47);
    ctx.stroke();
    ctx.strokeStyle = '#D19D42';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(36, -47, 11, Math.PI * 0.58, Math.PI * 1.42);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(209, 157, 66, 0.72)';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(44, -44);
    ctx.lineTo(-34, -46);
    ctx.stroke();

    // Spinning 6-Spoked Bronze-Rimmed Chariot Wheel sitting cleanly on groundY
    const wAngle = -clock * 11;
    const wx = 49;
    const wy = -13.5;
    ctx.strokeStyle = '#201308';
    ctx.lineWidth = 3.0;
    ctx.beginPath();
    ctx.arc(wx, wy, 12.8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = '#C9963A';
    ctx.lineWidth = 1.25;
    for (let s = 0; s < 3; s++) {
      const a = wAngle + (s * Math.PI) / 3;
      ctx.beginPath();
      ctx.moveTo(wx - Math.cos(a) * 12, wy - Math.sin(a) * 12);
      ctx.lineTo(wx + Math.cos(a) * 12, wy + Math.sin(a) * 12);
      ctx.stroke();
    }
    ctx.fillStyle = '#D19D42';
    ctx.beginPath();
    ctx.arc(wx, wy, 2.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
    ctx.restore();
  };

  const drawEraPrehistoric = (eraT: number, alpha: number) => {
    if (alpha <= 0.01) return;
    const groundY = height - 8;

    const vx = width * 0.89;
    const stride = clock * 2.9;
    const txBase = width * 0.53 + (eraT / ERA_DURATION) * (width * 0.08);
    const triX = txBase + 225;

    // Interactive proximity reactions (cursor near T-Rex, Triceratops, or Volcano)
    const trexFocus = Math.max(0, 1 - Math.hypot(pointerX - (txBase + 25), pointerY - (groundY - 58)) / 185);
    const triFocus = Math.max(0, 1 - Math.hypot(pointerX - triX, pointerY - (groundY - 42)) / 165);
    const naturalRoarWave = Math.pow(Math.max(0, Math.sin(clock * 1.65)), 2.2);
    const activeRoar = Math.min(1, Math.max(naturalRoarWave, trexFocus * 1.15));
    const tremor = (activeRoar > 0.72 || volcanoSurge > 0.3) ? Math.sin(clock * 46) * (1.3 + volcanoSurge * 1.6) : 0;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(0, tremor);

    // Distant Volcanic Ridge Horizon + Prehistoric Cycads & Tree Ferns Silhouettes
    ctx.fillStyle = 'rgba(54, 32, 16, 0.36)';
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    ctx.quadraticCurveTo(width * 0.22, groundY - 26, width * 0.44, groundY - 10);
    ctx.quadraticCurveTo(width * 0.65, groundY - 32, width * 0.85, groundY - 8);
    ctx.lineTo(width, groundY - 18);
    ctx.lineTo(width, groundY);
    ctx.closePath();
    ctx.fill();

    // Swaying Prehistoric Tree Ferns & Cycad Palms along the horizon
    const drawCycad = (fx: number, h: number, sway: number) => {
      ctx.save();
      ctx.translate(fx, groundY - 6);
      ctx.strokeStyle = 'rgba(42, 24, 11, 0.56)';
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.moveTo(0, 8);
      ctx.quadraticCurveTo(sway * 0.4, -h * 0.5, sway, -h);
      ctx.stroke();
      ctx.fillStyle = 'rgba(42, 24, 11, 0.54)';
      for (let f = -2; f <= 2; f++) {
        const ang = f * 0.45 + sway * 0.02;
        ctx.beginPath();
        ctx.moveTo(sway, -h);
        ctx.quadraticCurveTo(
          sway + Math.sin(ang) * 14,
          -h - 8 + Math.abs(f) * 3,
          sway + Math.sin(ang) * 24,
          -h + 2 + Math.abs(f) * 4,
        );
        ctx.quadraticCurveTo(sway + Math.sin(ang) * 10, -h + 1, sway, -h);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    };
    const shockSway = Math.sin(clock * 4.2) * (2.5 + volcanoSurge * 5.0);
    drawCycad(width * 0.46, 38, shockSway * 0.7);
    drawCycad(width * 0.49, 26, shockSway * 0.9);
    drawCycad(width * 0.78, 34, -shockSway * 0.8);

    // Massive Craggy Stratovolcano on far-right flank with Molten Caldera & Explosive Magma Fire-Jet
    const volGrad = ctx.createLinearGradient(vx, groundY - 134, vx, groundY);
    volGrad.addColorStop(0, '#3D2010');
    volGrad.addColorStop(0.5, '#25140A');
    volGrad.addColorStop(1, '#140A04');
    ctx.fillStyle = volGrad;
    ctx.beginPath();
    ctx.moveTo(vx - 195, groundY);
    ctx.lineTo(vx - 128, groundY - 38);
    ctx.lineTo(vx - 70, groundY - 84);
    ctx.lineTo(vx - 35, groundY - 126);
    ctx.lineTo(vx - 14, groundY - 117);
    ctx.lineTo(vx + 6, groundY - 119);
    ctx.lineTo(vx + 33, groundY - 128);
    ctx.lineTo(vx + 88, groundY - 70);
    ctx.lineTo(vx + 170, groundY);
    ctx.closePath();
    ctx.fill();

    // Upward Incandescent Magma Fire-Jet Fountain bursting from the Caldera Throat
    const magmaPulse = 0.82 + 0.18 * Math.sin(clock * 8.4) + volcanoSurge * 0.5;
    const jetH = 38 + magmaPulse * 24 + volcanoSurge * 36;
    const jetGrad = ctx.createLinearGradient(vx, groundY - 120, vx, groundY - 120 - jetH);
    jetGrad.addColorStop(0, 'rgba(255, 248, 198, 0.95)');
    jetGrad.addColorStop(0.45, 'rgba(255, 134, 24, 0.72)');
    jetGrad.addColorStop(1, 'rgba(180, 40, 10, 0)');
    ctx.fillStyle = jetGrad;
    ctx.beginPath();
    ctx.moveTo(vx - 14, groundY - 118);
    ctx.quadraticCurveTo(vx - 8, groundY - 120 - jetH * 0.65, vx + Math.sin(clock * 14) * 5, groundY - 120 - jetH);
    ctx.quadraticCurveTo(vx + 10, groundY - 120 - jetH * 0.6, vx + 15, groundY - 118);
    ctx.closePath();
    ctx.fill();

    // Underlit Atmospheric Pyroclastic Glow around Crater & Ash Column
    const craterGlow = ctx.createRadialGradient(vx, groundY - 130, 8, vx, groundY - 160, 145);
    craterGlow.addColorStop(0, `rgba(255, 242, 168, ${Math.min(1, 0.88 * magmaPulse).toFixed(2)})`);
    craterGlow.addColorStop(0.34, `rgba(252, 114, 20, ${Math.min(1, 0.56 * magmaPulse).toFixed(2)})`);
    craterGlow.addColorStop(1, 'rgba(154, 34, 12, 0)');
    ctx.fillStyle = craterGlow;
    ctx.beginPath();
    ctx.arc(vx, groundY - 160, 145, 0, Math.PI * 2);
    ctx.fill();

    // Multi-pass Glowing Branching Lava Streams down Rocky Gullies
    const drawLavaStream = (points: Array<[number, number]>) => {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.strokeStyle = `rgba(235, 62, 16, ${(0.58 * magmaPulse).toFixed(2)})`;
      ctx.lineWidth = 6.5;
      ctx.stroke();
      ctx.strokeStyle = `rgba(255, 204, 82, ${Math.min(1, 0.92 * magmaPulse).toFixed(2)})`;
      ctx.lineWidth = 2.2;
      ctx.stroke();
      ctx.restore();
    };
    drawLavaStream([
      [vx - 14, groundY - 118],
      [vx - 26, groundY - 92],
      [vx - 44, groundY - 66],
      [vx - 58, groundY - 36],
      [vx - 82, groundY],
    ]);
    drawLavaStream([
      [vx + 12, groundY - 118],
      [vx + 22, groundY - 84],
      [vx + 46, groundY - 48],
      [vx + 64, groundY],
    ]);

    // Multi-Branch Jagged Volcanic Lightning inside the Ash Canopy
    if (Math.sin(clock * 10.5) > 0.88 || volcanoSurge > 0.55) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 246, 204, 0.88)';
      ctx.lineWidth = 1.7;
      ctx.beginPath();
      ctx.moveTo(vx + 10, groundY - 210);
      ctx.lineTo(vx - 10, groundY - 184);
      ctx.lineTo(vx + 8, groundY - 166);
      ctx.lineTo(vx - 6, groundY - 138);
      // Secondary fork
      ctx.moveTo(vx - 10, groundY - 184);
      ctx.lineTo(vx - 26, groundY - 170);
      ctx.stroke();
      ctx.restore();
    }

    // Craggy Basalt Ground Crust + Glowing Magma Fissures & Lava-Glow Reflection
    const crustGrad = ctx.createLinearGradient(0, groundY - 6, 0, height);
    crustGrad.addColorStop(0, '#331D0D');
    crustGrad.addColorStop(0.45, '#211207');
    crustGrad.addColorStop(1, '#120803');
    ctx.fillStyle = crustGrad;
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    for (let gx = 0; gx <= width + 40; gx += 48) {
      const rockRidge = Math.sin(gx * 0.045) * 4.5 + Math.cos(gx * 0.11) * 2.5;
      ctx.lineTo(gx, groundY - rockRidge);
    }
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fill();

    // Glowing Subterranean Basalt Cracks pulsing across the Volcanic Floor
    ctx.save();
    ctx.strokeStyle = `rgba(248, 128, 34, ${(0.52 + Math.sin(clock * 4.8) * 0.18).toFixed(2)})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(width * 0.52, groundY + 4);
    ctx.lineTo(width * 0.56, groundY + 1);
    ctx.lineTo(width * 0.61, groundY + 5);
    ctx.moveTo(width * 0.72, groundY + 3);
    ctx.lineTo(width * 0.78, groundY + 0);
    ctx.lineTo(width * 0.84, groundY + 5);
    ctx.stroke();
    ctx.restore();

    // Foreground Jagged Volcanic Basalt Boulders & Crags
    ctx.fillStyle = '#180D05';
    const drawBoulder = (bx: number, bw: number, bh: number) => {
      ctx.beginPath();
      ctx.moveTo(bx - bw * 0.5, height);
      ctx.lineTo(bx - bw * 0.3, groundY - bh);
      ctx.lineTo(bx + bw * 0.1, groundY - bh * 0.72);
      ctx.lineTo(bx + bw * 0.48, height);
      ctx.closePath();
      ctx.fill();
    };
    drawBoulder(width * 0.48, 36, 12);
    drawBoulder(width * 0.66, 28, 9);
    drawBoulder(width * 0.83, 44, 14);

    // GIANT REALISTIC PREDATORY T-REX (1.35x scale, weighted footstep bob, S-wave tail balance, lunging roar!)
    const stepBobY = -Math.abs(Math.sin(stride)) * 4.8;
    const lungeFwdX = activeRoar * 12;
    const torsoTilt = Math.sin(stride) * 0.045 + activeRoar * 0.085;
    ctx.save();
    ctx.translate(txBase + lungeFwdX * 0.35, groundY);
    ctx.scale(1.32, 1.32);

    ctx.fillStyle = 'rgba(18, 10, 4, 0.36)';
    ctx.beginPath();
    ctx.ellipse(2, 0, 48, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    const rexSkinGrad = ctx.createLinearGradient(-50, -96, 40, 0);
    rexSkinGrad.addColorStop(0, '#442A16');
    rexSkinGrad.addColorStop(0.45, '#2A180B');
    rexSkinGrad.addColorStop(1, '#140B04');

    // Authentic 3-segment digitigrade theropod leg with ankle bend & toe curl on lift!
    const drawTheropodLeg = (hipX: number, hipY: number, phase: number, colorFill: string) => {
      const swing = Math.sin(phase) * 9.5;
      const lift = Math.max(0, Math.cos(phase)) * 6.5;
      const kneeX = hipX + 10 + swing * 0.45;
      const kneeY = hipY + 18 - lift * 0.3;
      const ankleX = hipX - 4 + swing * 0.72;
      const ankleY = hipY + 33 - lift * 0.6;
      const footX = hipX + 6 + swing;
      const footY = -2 - lift;

      ctx.fillStyle = colorFill;
      ctx.beginPath();
      ctx.moveTo(hipX - 10, hipY - 4);
      ctx.quadraticCurveTo(hipX + 14, hipY + 2, kneeX + 6, kneeY);
      ctx.lineTo(ankleX + 4, ankleY);
      ctx.lineTo(footX + 3, footY);
      ctx.lineTo(footX + 14, -lift * 0.65); // curled clawed toes when lifted, flat on strike!
      ctx.lineTo(footX - 6, -lift);
      ctx.lineTo(ankleX - 3, ankleY);
      ctx.quadraticCurveTo(kneeX - 6, kneeY, hipX - 10, hipY - 4);
      ctx.closePath();
      ctx.fill();
    };

    // Far Leg
    drawTheropodLeg(-6, -46 + stepBobY * 0.5, stride + Math.PI, '#1A0E05');

    // Travelling S-Wave Tail + Heaving Ribcage & Spine + Lunging S-Neck
    ctx.save();
    ctx.translate(0, stepBobY);
    ctx.rotate(torsoTilt);

    const tailWaveMid = Math.sin(clock * 3.4 - 0.9) * 4.5;
    const tailWaveTip = Math.sin(clock * 3.4 - 1.8) * 6.5;
    ctx.fillStyle = rexSkinGrad;
    ctx.beginPath();
    ctx.moveTo(-104, -44 + tailWaveTip);
    ctx.bezierCurveTo(-72, -52 + tailWaveMid, -44, -60, -18, -66);
    ctx.bezierCurveTo(2 + lungeFwdX * 0.25, -74 - activeRoar * 4, 20 + lungeFwdX * 0.4, -78 - activeRoar * 5, 34 + lungeFwdX * 0.5, -80 - activeRoar * 6);
    ctx.lineTo(42 + lungeFwdX * 0.5, -62 - activeRoar * 4);
    ctx.bezierCurveTo(32 + lungeFwdX * 0.2, -40, 12, -32, -8, -36);
    ctx.bezierCurveTo(-42, -36 + tailWaveMid * 0.4, -74, -40 + tailWaveMid, -104, -44 + tailWaveTip);
    ctx.closePath();
    ctx.fill();

    // Warm volcanic orange rim-highlight along dorsal back ridge
    ctx.strokeStyle = `rgba(255, 138, 42, ${(0.38 * magmaPulse).toFixed(2)})`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-98, -45 + tailWaveTip * 0.9);
    ctx.bezierCurveTo(-60, -56 + tailWaveMid * 0.8, -18, -68, 34 + lungeFwdX * 0.5, -80 - activeRoar * 6);
    ctx.stroke();

    // Detailed Tyrannosaur Skull (Tilts & Thrusts aggressively during roar / hover!)
    ctx.save();
    ctx.translate(33 + lungeFwdX * 0.55, -74 - activeRoar * 6);
    const headPitch = trexFocus > 0.1
      ? Math.max(-0.32, Math.min(0.24, Math.atan2(pointerY - (groundY - 96), pointerX - (txBase + 60)) * 0.28))
      : -activeRoar * 0.22 + Math.sin(clock * 2.2) * 0.06;
    ctx.rotate(headPitch);

    ctx.fillStyle = rexSkinGrad;
    ctx.beginPath();
    ctx.moveTo(-6, -9);
    ctx.lineTo(8, -16);
    ctx.lineTo(18, -14);
    ctx.quadraticCurveTo(36, -11, 41, -4);
    ctx.quadraticCurveTo(39, 3, 30, 3);
    ctx.lineTo(2, 3);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#120802';
    ctx.beginPath();
    ctx.ellipse(10, -8, 3.8, 2.8, -0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FFAE2B';
    ctx.beginPath();
    ctx.arc(10.5, -8, 1.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#D9C39A';
    const fangSpecs = [
      [13, 3.2, 3.5],
      [18.5, 3.1, 4.4],
      [24, 3.0, 3.8],
      [29.5, 2.8, 4.2],
      [34.5, 2.5, 3.1],
    ];
    for (const [fx, fy, fl] of fangSpecs) {
      ctx.beginPath();
      ctx.moveTo(fx - 1.1, fy);
      ctx.quadraticCurveTo(fx - 0.3, fy + fl, fx - 1.4, fy + fl);
      ctx.quadraticCurveTo(fx + 0.8, fy + fl * 0.6, fx + 1.1, fy);
      ctx.closePath();
      ctx.fill();
    }

    ctx.save();
    ctx.translate(2, 2);
    ctx.rotate(0.06 + activeRoar * 0.46);
    if (activeRoar > 0.25) {
      ctx.fillStyle = '#521D12';
      ctx.beginPath();
      ctx.moveTo(0, -1);
      ctx.quadraticCurveTo(16, -5, 28, 0);
      ctx.lineTo(26, 2);
      ctx.lineTo(0, 2);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = '#1E1108';
    ctx.beginPath();
    ctx.moveTo(-2, -1);
    ctx.lineTo(35, 0.5);
    ctx.quadraticCurveTo(34, 7, 26, 7.5);
    ctx.lineTo(-4, 7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.restore();

    // Muscular Two-Clawed Forelimb
    ctx.fillStyle = '#1B1007';
    ctx.beginPath();
    ctx.moveTo(19, -51);
    ctx.lineTo(28, -45);
    ctx.lineTo(31, -39);
    ctx.lineTo(27, -38);
    ctx.lineTo(24, -43);
    ctx.lineTo(17, -47);
    ctx.closePath();
    ctx.fill();

    ctx.restore(); // end torso bob/tilt

    // Near Massive Digitigrade Leg
    drawTheropodLeg(-4, -46 + stepBobY * 0.5, stride, '#2A180B');
    ctx.restore();

    // GIANT ARMORED TRICERATOPS (Full Quadruped Walk Gait, Articulated Elbow/Knee Stride, Head-Hook & Tail Counterbalance!)
    const triPatrolX = Math.sin(clock * 0.85) * 24 - triFocus * 24;
    const triWalk = clock * (2.6 + triFocus * 2.2);
    const triStepBobY = -Math.abs(Math.sin(triWalk)) * 3.0;
    const breathHeave = Math.sin(clock * 2.1) * 1.6;
    const triPitch = Math.cos(clock * 0.85) * 0.035 - triFocus * 0.07;

    ctx.save();
    ctx.translate(triX + triPatrolX, groundY);
    ctx.scale(1.32, 1.32);

    ctx.fillStyle = 'rgba(18, 10, 4, 0.36)';
    ctx.beginPath();
    ctx.ellipse(2, 0, 44, 4.8, 0, 0, Math.PI * 2);
    ctx.fill();

    const triGrad = ctx.createLinearGradient(0, -56, 0, 0);
    triGrad.addColorStop(0, '#3D2714');
    triGrad.addColorStop(1, '#1A0F07');

    // Articulated 2-Segment Quadruped Leg (bowed elbow for front, angled thigh/hock for hind + hoof lift on swing)
    const drawQuadrupedLeg = (
      hipX: number,
      hipY: number,
      w: number,
      phase: number,
      isFront: boolean,
      darkFill: string,
    ) => {
      const swing = Math.sin(phase) * (isFront ? 6.5 : 7.5);
      const lift = Math.max(0, Math.cos(phase)) * 5.2;
      const jointX = hipX + (isFront ? 3.5 : -2.5) + swing * 0.45;
      const jointY = hipY * 0.52 - lift * 0.45;
      const footX = hipX + swing;
      const footY = -lift;

      ctx.fillStyle = darkFill;
      ctx.beginPath();
      ctx.moveTo(hipX - w * 0.52, hipY);
      ctx.quadraticCurveTo(jointX - w * 0.55, jointY, footX - w * 0.38, footY - 2);
      ctx.lineTo(footX - w * 0.58, footY); // flared front hoof toes
      ctx.lineTo(footX + w * 0.48, footY);
      ctx.lineTo(footX + w * 0.38, footY - 2);
      ctx.quadraticCurveTo(jointX + w * 0.48, jointY, hipX + w * 0.5, hipY);
      ctx.closePath();
      ctx.fill();
    };

    // Far Diagonal Pair (Far Front-Right + Far Hind-Right)
    drawQuadrupedLeg(-14, -22 + triStepBobY * 0.5, 8.8, triWalk + Math.PI, true, '#160D05');
    drawQuadrupedLeg(16, -24 + triStepBobY * 0.5, 9.8, triWalk, false, '#160D05');

    // Rolling/Heaving Torso + Multi-Segment S-Wave Tail
    ctx.save();
    ctx.translate(0, triStepBobY);
    ctx.rotate(triPitch);

    const triTailMid = Math.sin(clock * 2.6 - 0.8) * 3.0;
    const triTailTip = Math.sin(clock * 2.6 - 1.6) * 4.8;
    ctx.fillStyle = triGrad;
    ctx.beginPath();
    ctx.moveTo(58, -15 + triTailTip);
    ctx.quadraticCurveTo(38, -24 + triTailMid, 24, -36 - breathHeave * 0.5);
    ctx.bezierCurveTo(10, -44 - breathHeave, -8, -44 - breathHeave, -22, -38 - breathHeave * 0.6);
    ctx.lineTo(-26, -16);
    ctx.quadraticCurveTo(-2, -13, 22, -18);
    ctx.quadraticCurveTo(38, -16 + triTailMid * 0.5, 58, -15 + triTailTip);
    ctx.closePath();
    ctx.fill();

    // Warm volcanic orange rim-highlight along dorsal shoulder & tail spine
    ctx.strokeStyle = `rgba(255, 138, 42, ${(0.32 * magmaPulse).toFixed(2)})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(54, -15.5 + triTailTip * 0.9);
    ctx.quadraticCurveTo(36, -24.5 + triTailMid * 0.8, 24, -36 - breathHeave * 0.5);
    ctx.bezierCurveTo(10, -44 - breathHeave, -8, -44 - breathHeave, -22, -38 - breathHeave * 0.6);
    ctx.stroke();

    // Scalloped Bone Frill Skull, Deep Eye Socket & Curved Keratin Horns hooking dynamically!
    ctx.save();
    ctx.translate(-22, -29 - breathHeave * 0.5);
    const hornSweep = Math.sin(clock * 2.3) * 0.14 - triFocus * 0.24 - activeRoar * 0.14;
    ctx.rotate(hornSweep);
    ctx.fillStyle = triGrad;
    ctx.beginPath();
    ctx.moveTo(4, -6);
    ctx.quadraticCurveTo(14, -28, 4, -30);
    ctx.lineTo(0, -25);
    ctx.lineTo(-6, -27);
    ctx.lineTo(-10, -20);
    ctx.lineTo(-28, -4);
    ctx.lineTo(-22, 7);
    ctx.lineTo(2, 6);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = `rgba(255, 138, 42, ${(0.36 * magmaPulse).toFixed(2)})`;
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Deep eye socket + fierce amber eye glint
    ctx.fillStyle = '#120802';
    ctx.beginPath();
    ctx.arc(-11, -11, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#E89B2D';
    ctx.beginPath();
    ctx.arc(-11.4, -11.2, 0.9, 0, Math.PI * 2);
    ctx.fill();

    const hornGrad = ctx.createLinearGradient(-8, -14, -38, -26);
    hornGrad.addColorStop(0, '#5E4629');
    hornGrad.addColorStop(0.55, '#B89E72');
    hornGrad.addColorStop(1, '#E6D6B3');
    ctx.fillStyle = hornGrad;
    ctx.beginPath();
    ctx.moveTo(-10, -16);
    ctx.quadraticCurveTo(-24, -22, -37, -26);
    ctx.quadraticCurveTo(-22, -16, -11, -11);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-24, -6);
    ctx.quadraticCurveTo(-28, -14, -32, -15);
    ctx.quadraticCurveTo(-25, -8, -21, -4);
    ctx.closePath();
    ctx.fill();
    ctx.restore(); // end skull

    ctx.restore(); // end torso bob/pitch

    // Near Diagonal Pair (Near Front-Left + Near Hind-Left)
    drawQuadrupedLeg(-18, -22 + triStepBobY * 0.5, 9.6, triWalk, true, '#2B1B0D');
    drawQuadrupedLeg(12, -24 + triStepBobY * 0.5, 10.6, triWalk + Math.PI, false, '#2B1B0D');

    ctx.restore();

    // Distant Gliding Pteranodons high in upper smoky sky
    for (let p = 0; p < 3; p++) {
      const px = ((width * 0.24 + p * 220 + clock * (26 + p * 7)) % (width + 90)) - 45;
      const py = height * (0.14 + p * 0.07) + Math.sin(clock * 2.2 + p) * 7;
      const wing = Math.sin(clock * 5.5 + p * 1.4) * 6;
      ctx.fillStyle = 'rgba(46, 28, 12, 0.56)';
      ctx.beginPath();
      ctx.moveTo(px - 16, py + wing);
      ctx.quadraticCurveTo(px - 6, py - 5, px, py);
      ctx.quadraticCurveTo(px + 6, py - 5, px + 16, py + wing);
      ctx.quadraticCurveTo(px + 4, py + 2, px, py + 2);
      ctx.quadraticCurveTo(px - 4, py + 2, px - 16, py + wing);
      ctx.closePath();
      ctx.fill();
    }

    // Extinction Asteroid Fireball tearing diagonally across upper sky
    const mProg = (eraT * 0.42) % 1;
    const mx = width * 0.16 + mProg * (width * 0.72);
    const my = height * 0.08 + mProg * (height * 0.26);
    const meteorGrad = ctx.createLinearGradient(mx - 105, my - 40, mx, my);
    meteorGrad.addColorStop(0, 'rgba(255, 180, 62, 0)');
    meteorGrad.addColorStop(0.65, 'rgba(255, 128, 32, 0.52)');
    meteorGrad.addColorStop(1, 'rgba(255, 244, 198, 0.96)');
    ctx.strokeStyle = meteorGrad;
    ctx.lineWidth = 5.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(mx - 105, my - 40);
    ctx.lineTo(mx, my);
    ctx.stroke();
    ctx.fillStyle = '#FFF9DF';
    ctx.beginPath();
    ctx.arc(mx, my, 4.8, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  };

  const triggerHistoryCardsRewind = () => {
    const cards = Array.from(document.querySelectorAll('#view-history .gd-history-card')) as HTMLElement[];
    cards.forEach((card, idx) => {
      card.classList.remove('is-rewind-pulse');
      setTimeout(() => {
        if (!document.contains(card)) return;
        card.classList.add('is-rewind-pulse');
        setTimeout(() => card.classList.remove('is-rewind-pulse'), 720);
      }, idx * 95);
    });
  };

  const isRewindActive = () =>
    Boolean(document.querySelector('.gd-dashboard-app.gd-history-rewind-on'));

  const isHistoryVisible = () =>
    Boolean(document.querySelector('#view-history.active'));

  const step = (ts: number) => {
    if (!document.contains(canvas)) {
      rafId = null;
      return;
    }

    const dt = lastTs ? Math.min(0.04, (ts - lastTs) / 1000) : 0.016;
    lastTs = ts;
    clock += dt;

    const historyVisible = isHistoryVisible();
    let active = isRewindActive() && historyVisible;
    if (active) ensureHudMounted();
    if (!historyVisible) {
      if (lingerPages.length > 0) lingerPages.length = 0;
      if (eraPlumes.length > 0) eraPlumes.length = 0;
      if (eraSparks.length > 0) eraSparks.length = 0;
    }
    const TOTAL_CYCLE_DURATION = ERAS.length * ERA_DURATION;
    if (!active) {
      introRemaining = 0;
      hudEl.classList.remove('is-visible', 'is-rewinding');
    } else if (introRemaining > 0) {
      introRemaining = Math.max(0, introRemaining - dt);
      const introProgress = 1 - introRemaining / INTRO_DURATION;
      const yearNum = Math.round(2026 - introProgress * (2026 - 1885));
      if (hudYearEl && hudYearEl.textContent !== `${yearNum} AD`) {
        hudYearEl.textContent = `${yearNum} AD`;
      }
      if (hudTitleEl && hudTitleEl.textContent !== 'Rewinding') {
        hudTitleEl.textContent = 'Rewinding';
      }
      if (hudDescEl && hudDescEl.textContent !== 'Back through time') {
        hudDescEl.textContent = 'Back through time';
      }
      if (hudProgressEl) {
        hudProgressEl.style.strokeDashoffset = (PROGRESS_CIRCUMFERENCE * (1 - introProgress)).toFixed(2);
      }
      hudEl.classList.add('is-visible', 'is-rewinding');
    } else {
      journeyTime += dt;
      if (journeyTime >= TOTAL_CYCLE_DURATION) {
        // One full cycle through all eras complete — automatically close watch & return to present
        journeyTime = TOTAL_CYCLE_DURATION;
        active = false;
        introRemaining = 0;
        hudEl.classList.remove('is-visible', 'is-rewinding');
        if (typeof window !== 'undefined' && typeof CustomEvent === 'function') {
          window.dispatchEvent(new CustomEvent('gd-watch-toggle', { detail: { open: false } }));
        }
      } else {
        hudEl.classList.add('is-visible');
        const eraIdx = Math.floor(journeyTime / ERA_DURATION) % ERAS.length;
        const eraT = journeyTime % ERA_DURATION;
        const inTransition = journeyTime >= ERA_DURATION && eraT < TRANSITION_DUR;
        const eraProgress = Math.min(1, eraT / ERA_DURATION);

        hudEl.classList.toggle('is-rewinding', inTransition);
        if (hudProgressEl) {
          hudProgressEl.style.strokeDashoffset = (PROGRESS_CIRCUMFERENCE * (1 - eraProgress)).toFixed(2);
        }

        const era = ERAS[eraIdx];
        if (inTransition && eraT / TRANSITION_DUR < 0.86) {
          const prevIdx = (eraIdx + ERAS.length - 1) % ERAS.length;
          const years = [1885, 1420, -2500, -66000000];
          const y0 = years[prevIdx];
          const y1 = years[eraIdx];
          const u = eraT / (TRANSITION_DUR * 0.86);
          const eased = u * u * (3 - 2 * u);
          const interp =
            Math.abs(y1 - y0) > 100000
              ? Math.round(
                  y0 +
                    (y1 - y0) *
                      (y1 < y0 ? Math.pow(eased, 2.2) : 1 - Math.pow(1 - eased, 2.2))
                )
              : Math.round(y0 + (y1 - y0) * eased);
          let yearText: string;
          if (interp > 0) yearText = `${interp} AD`;
          else if (Math.abs(interp) >= 1000000) yearText = `${Math.max(1, Math.round(Math.abs(interp) / 1000000))}M BC`;
          else if (Math.abs(interp) >= 10000) yearText = `${Math.round(Math.abs(interp) / 1000)}K BC`;
          else yearText = `${Math.max(1, Math.abs(interp))} BC`;

          if (hudYearEl && hudYearEl.textContent !== yearText) hudYearEl.textContent = yearText;
          if (hudTitleEl && hudTitleEl.textContent !== era.title) hudTitleEl.textContent = era.title;
          const shiftDesc = `Shifting from ${ERAS[prevIdx].year}`;
          if (hudDescEl && hudDescEl.textContent !== shiftDesc) hudDescEl.textContent = shiftDesc;
        } else {
          if (hudYearEl && hudYearEl.textContent !== era.year) hudYearEl.textContent = era.year;
          if (hudTitleEl && hudTitleEl.textContent !== era.title) hudTitleEl.textContent = era.title;
          if (hudDescEl && hudDescEl.textContent !== era.desc) hudDescEl.textContent = era.desc;
        }
      }
    }
    if (wasRewindActive && !active && historyVisible) {
      spawnLingerPages();
    }
    wasRewindActive = active;

    const targetAlpha = active ? 1 : 0;
    rewindAlpha += (targetAlpha - rewindAlpha) * Math.min(1, dt * (active ? 4.2 : 2.5));

    const effectiveJourneyTime = Math.min(journeyTime, TOTAL_CYCLE_DURATION - 0.001);
    const currentEraIdx = Math.floor(effectiveJourneyTime / ERA_DURATION) % ERAS.length;
    const currentEraT = effectiveJourneyTime % ERA_DURATION;
    updateEraEmitters(dt, currentEraIdx, currentEraT, active && introRemaining <= 0.15);

    ctx.clearRect(0, 0, width, height);

    const isSwitchingEra =
      active && introRemaining <= 0.15 && journeyTime >= ERA_DURATION && currentEraT < TRANSITION_DUR;
    const transitionNorm = isSwitchingEra ? currentEraT / TRANSITION_DUR : 0;
    const transitionPulse = isSwitchingEra ? Math.sin(transitionNorm * Math.PI) : 0;

    if (rewindAlpha > 0.01 || eraPlumes.length > 0 || eraSparks.length > 0) {
      // 1. Rotating antique Roman-numeral clockwork rings (accelerate during epoch transitions)
      if (rewindAlpha > 0.01) {
        const ringSpinMult = introRemaining > 0 ? 3.5 : 1 + transitionPulse * 3.2;
        for (const ring of clockRings) {
          ring.angle += ring.spinSpeed * dt * ringSpinMult;
          drawRomanClockRing(ring, ring.alpha * rewindAlpha);
        }
      }

      // 2. Unified Continuous Multi-Era Cross-Dissolve (no distracting shimmer bar)
      const drawEraByIndex = (idx: number, t: number, a: number) => {
        if (a <= 0.01) return;
        if (idx === 0) drawEraSteamTrain(t, a);
        else if (idx === 1) drawEraMedievalDuel(t, a);
        else if (idx === 2) drawEraAncientEgypt(t, a);
        else drawEraPrehistoric(t, a);
      };

      if (active && introRemaining <= 0.15) {
        if (journeyTime < ERA_DURATION) {
          const firstFadeIn = Math.min(1, currentEraT / 0.9);
          drawEraByIndex(currentEraIdx, currentEraT, rewindAlpha * firstFadeIn);
        } else if (currentEraT < TRANSITION_DUR) {
          const prevIdx = (currentEraIdx + ERAS.length - 1) % ERAS.length;
          // Smooth S-curve equal-luminance cross-dissolve + gentle continuous world drift
          const ease = transitionNorm * transitionNorm * (3 - 2 * transitionNorm);
          const outAlpha = rewindAlpha * Math.pow(1 - ease, 0.85);
          const inAlpha = rewindAlpha * Math.pow(ease, 0.85);

          // Shared grounding sepia wash so bottom terrain merges seamlessly as one scene
          const horizonMist = ctx.createLinearGradient(0, height - 85, 0, height);
          horizonMist.addColorStop(0, 'rgba(222, 206, 174, 0)');
          horizonMist.addColorStop(0.75, `rgba(116, 90, 52, ${(transitionPulse * 0.16 * rewindAlpha).toFixed(3)})`);
          horizonMist.addColorStop(1, `rgba(48, 34, 18, ${(transitionPulse * 0.28 * rewindAlpha).toFixed(3)})`);
          ctx.fillStyle = horizonMist;
          ctx.fillRect(0, height - 85, width, 85);

          ctx.save();
          ctx.translate(-ease * 14, 0);
          drawEraByIndex(prevIdx, ERA_DURATION + currentEraT, outAlpha);
          ctx.restore();

          ctx.save();
          ctx.translate((1 - ease) * 14, 0);
          drawEraByIndex(currentEraIdx, currentEraT, inAlpha);
          ctx.restore();
        } else {
          drawEraByIndex(currentEraIdx, currentEraT, rewindAlpha);
        }
      }
      drawEraPlumesAndSparks(Math.max(rewindAlpha, active ? 1 : 0.65));

      // 2. Ascending golden-sepia memory sparks
      for (const s of sparks) {
        const speedScale = active ? 1 : 0.45;
        s.y += s.vy * speedScale * dt;
        const drawX = s.x + Math.sin(clock * s.driftFreq + s.phase) * s.driftAmp;

        if (s.y < -18) {
          s.y = height + 18;
          s.x = Math.random() * width;
        }

        const twinkle = 0.65 + 0.35 * Math.sin(clock * 3.1 + s.phase);
        const alpha = s.alpha * twinkle * rewindAlpha;
        if (alpha <= 0.01) continue;

        ctx.save();
        ctx.globalAlpha = alpha * 0.3;
        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.arc(drawX, s.y, s.radius * 2.2, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(drawX, s.y, s.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // 3. Fluttering vintage archival parchment pages
      for (const p of archivePages) {
        p.x += (p.vx + Math.sin(clock * 1.4 + p.phase) * 18) * dt;
        p.y += (p.vy + Math.cos(clock * 1.8 + p.phase) * 14) * dt;
        p.rot += p.rotSpeed * dt;
        p.tumble += p.tumbleSpeed * dt;

        if (p.x > width + 36) {
          p.x = -32;
          p.y = Math.random() * height;
        }
        if (p.y < -36) {
          p.y = height + 30;
          p.x = Math.random() * width;
        }

        drawArchivePage(p, p.alpha * rewindAlpha, 0);
      }
    }

    // 4. Lingering parchment pages floating down & settling at the bottom when returning to present
    for (let i = lingerPages.length - 1; i >= 0; i--) {
      const l = lingerPages[i];
      if (active) {
        l.settled = false;
        l.vy -= 120 * dt;
        l.vx += 95 * dt;
        l.x += l.vx * dt;
        l.y += l.vy * dt;
        l.rot += 2.2 * dt;
        l.tumble += 3.0 * dt;
        drawArchivePage(l, l.alpha, 0);
        if (l.y < -40 || l.x > width + 40) {
          lingerPages.splice(i, 1);
        }
        continue;
      }

      if (!l.settled) {
        l.vx *= Math.exp(-dt * 1.6);
        const swayAngle = clock * l.swayFreq + l.phase;
        l.x += (l.vx + Math.cos(swayAngle) * l.swayAmp) * dt;
        const minX = Math.min(300, width * 0.25);
        if (l.x > width - 36) l.x = width - 36;
        if (l.x < minX) l.x = minX;

        const fallRate = l.vy * (0.72 + 0.42 * Math.abs(Math.sin(swayAngle)));
        l.y += fallRate * dt;

        const dist = Math.max(0, l.targetY - l.y);
        const nearGround = Math.max(0, 1 - dist / 65);
        l.rot += (Math.cos(swayAngle) * 0.36 * (1 - nearGround) + l.restRot * nearGround - l.rot) * Math.min(1, dt * 6);
        if (nearGround > 0.65) {
          const flatTumble = Math.round(l.tumble / (Math.PI * 2)) * Math.PI * 2;
          l.tumble += (flatTumble - l.tumble) * Math.min(1, dt * 7);
        } else {
          l.tumble += l.tumbleSpeed * (1 - nearGround * 0.7) * dt;
        }

        if (l.y >= l.targetY) {
          l.y = l.targetY;
          l.settled = true;
          l.settledAge = 0;
          l.rot = l.restRot;
          l.tumble = Math.round(l.tumble / (Math.PI * 2)) * Math.PI * 2;
        }
        drawArchivePage(l, l.alpha, Math.max(0, 1 - dist / 80));
      } else {
        l.targetY = Math.min(l.targetY, height - 14);
        l.y = l.targetY;
        l.settledAge += dt;
        const fade = l.settledAge <= 9 ? 1 : Math.max(0, 1 - (l.settledAge - 9) / 2.5);
        drawArchivePage(l, l.alpha * fade, fade);
        if (l.settledAge >= 11.5) {
          lingerPages.splice(i, 1);
        }
      }
    }

    canvas.classList.toggle('is-pages-lingering', lingerPages.length > 0 && historyVisible);

    // Gentle nostalgic grandfather-clock sway on Decision History's hanging wooden greeting board
    const boardEl = document.querySelector('#view-history .gd-overview-greeting-card .gd-wood-board') as HTMLElement | null;
    if (boardEl) {
      const targetSwing = active ? Math.sin(clock * 1.25) * 1.8 : 0;
      boardVel += ((targetSwing - boardAngle) * 20 - boardVel * 3.6) * dt;
      boardAngle += boardVel * dt;
      if (active || Math.abs(boardAngle) > 0.03 || Math.abs(boardVel) > 0.04) {
        boardEl.style.transformOrigin = '50% -26px';
        boardEl.style.transform = `rotate(${boardAngle.toFixed(2)}deg)`;
      } else {
        boardAngle = 0;
        boardVel = 0;
        boardEl.style.transform = '';
      }
    }

    if (
      active ||
      rewindAlpha > 0.015 ||
      eraPlumes.length > 0 ||
      eraSparks.length > 0 ||
      lingerPages.length > 0 ||
      Math.abs(boardAngle) > 0.04 ||
      Math.abs(boardVel) > 0.05
    ) {
      rafId = requestAnimationFrame(step);
    } else {
      ctx.clearRect(0, 0, width, height);
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

  window.addEventListener('gd-watch-toggle', (ev: Event) => {
    const custom = ev as CustomEvent<{ open?: boolean }>;
    if (custom?.detail?.open) {
      introRemaining = INTRO_DURATION;
      journeyTime = 0;
      ensureHudMounted();
      triggerHistoryCardsRewind();
    } else {
      introRemaining = 0;
      hudEl.classList.remove('is-visible', 'is-rewinding');
    }
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
        if (isRewindActive()) ensureRunning();
      });
      obs.observe(appEl, { attributes: true, attributeFilter: ['class'] });
      if (isRewindActive()) ensureRunning();
    });
  }

  return canvas;
}

/**
 * Synthesizes crisp mechanical brass clockwork escapement & ratchet clicks.
 */
function playClockworkMechanismSound(isEngage: boolean): void {
  try {
    const ctx = ensureUnlockedBirdAudioCtx();
    if (!ctx) return;

    const triggerTicks = () => {
      if (ctx.state !== 'running') return;
      const now = ctx.currentTime;
      const steps = isEngage
        ? [
            { delay: 0, freq: 1920, dur: 0.045, peak: 0.028 },
            { delay: 0.045, freq: 2480, dur: 0.045, peak: 0.026 },
            { delay: 0.09, freq: 3120, dur: 0.065, peak: 0.024 },
            { delay: 0.145, freq: 1480, dur: 0.18, peak: 0.018 },
          ]
        : [
            { delay: 0, freq: 2240, dur: 0.045, peak: 0.024 },
            { delay: 0.055, freq: 1420, dur: 0.09, peak: 0.02 },
          ];

      for (const s of steps) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = s.dur > 0.12 ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(s.freq, now + s.delay);
        osc.frequency.exponentialRampToValueAtTime(s.freq * 0.86, now + s.delay + s.dur);
        gain.gain.setValueAtTime(0.0001, now + s.delay);
        gain.gain.linearRampToValueAtTime(s.peak, now + s.delay + 0.0025);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + s.delay + s.dur);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + s.delay);
        osc.stop(now + s.delay + s.dur + 0.015);
      }
    };

    if (ctx.state === 'running') {
      triggerTicks();
    } else if (ctx.state === 'suspended') {
      void ctx.resume().then(triggerTicks).catch(() => {});
    }
  } catch {
    // Ignore audio errors cleanly
  }
}

let sharedWorkshopOpen = false;

/**
 * Generates an SVG spur gear path centered at (cx, cy) with involute-style teeth
 * and pierced interior watchmaker spokes.
 */
function buildHorologicalGearPath(
  cx: number,
  cy: number,
  rOuter: number,
  rRoot: number,
  teeth: number,
): string {
  const step = (Math.PI * 2) / teeth;
  const parts: string[] = [];
  for (let i = 0; i < teeth; i += 1) {
    const a0 = i * step;
    const a1 = a0 + step * 0.22;
    const a2 = a0 + step * 0.34;
    const a3 = a0 + step * 0.66;
    const a4 = a0 + step * 0.78;
    const p = (r: number, a: number) => `${(cx + Math.cos(a) * r).toFixed(2)} ${(cy + Math.sin(a) * r).toFixed(2)}`;
    parts.push(`${i === 0 ? 'M' : 'L'}${p(rRoot, a0)} L${p(rRoot, a1)} L${p(rOuter, a2)} L${p(rOuter, a3)} L${p(rRoot, a4)}`);
  }
  return `${parts.join(' ')} Z`;
}

/**
 * Meshed Brass Clockwork Escapement beside the Settings heading.
 * - Hover gives the geared wheels crisp horological torque.
 * - Click toggles the Settings Workshop Calibration bar (.gd-settings-workshop-on)
 *   with meshed opposing gear ratios and ticking anchor escapement motion.
 */
export function createSettingsClockworkProp(): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `gd-prop-btn gd-prop-settings-clockwork${sharedWorkshopOpen ? ' is-open' : ''}`;
  btn.setAttribute('aria-label', 'Toggle Portal Calibration Controls');
  btn.setAttribute('aria-pressed', sharedWorkshopOpen ? 'true' : 'false');
  btn.title = sharedWorkshopOpen
    ? 'Click to close calibration controls'
    : 'Click to open portal calibration controls';
  btn.tabIndex = -1;

  const mainGearPath = buildHorologicalGearPath(35, 55, 17.5, 14.1, 14);
  const pinionGearPath = buildHorologicalGearPath(54.5, 40.5, 10.6, 8.1, 10);
  const crownGearPath = buildHorologicalGearPath(19.5, 36.5, 9.6, 7.3, 9);

  const buildSpokes = (cx: number, cy: number, rIn: number, rOut: number, count: number) =>
    Array.from({ length: count }, (_, idx) => {
      const a = (idx * Math.PI * 2) / count;
      return `<line x1="${(cx + Math.cos(a) * rIn).toFixed(2)}" y1="${(cy + Math.sin(a) * rIn).toFixed(2)}" x2="${(cx + Math.cos(a) * rOut).toFixed(2)}" y2="${(cy + Math.sin(a) * rOut).toFixed(2)}" stroke="#6A4712" stroke-width="1.5" stroke-linecap="round"/>`;
    }).join('');

  btn.innerHTML = `
    <span class="gd-clockwork-note" aria-hidden="true">${sharedWorkshopOpen ? 'Close controls' : 'Calibrate'}</span>
    <span class="gd-clockwork-aura" aria-hidden="true"></span>
    <svg class="gd-prop-svg" width="76" height="92" viewBox="0 0 76 92" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="gd-cw-brass" x1="8%" y1="6%" x2="92%" y2="94%">
          <stop offset="0%" stop-color="#FFF0AD"/>
          <stop offset="32%" stop-color="#DFAB4B"/>
          <stop offset="72%" stop-color="#9A681B"/>
          <stop offset="100%" stop-color="#53350B"/>
        </linearGradient>
        <linearGradient id="gd-cw-steel" x1="10%" y1="10%" x2="90%" y2="90%">
          <stop offset="0%" stop-color="#8CB2D4"/>
          <stop offset="45%" stop-color="#456A8F"/>
          <stop offset="100%" stop-color="#22374D"/>
        </linearGradient>
        <linearGradient id="gd-cw-copper" x1="15%" y1="10%" x2="85%" y2="90%">
          <stop offset="0%" stop-color="#F6CE8F"/>
          <stop offset="50%" stop-color="#BA7A3B"/>
          <stop offset="100%" stop-color="#6B3D14"/>
        </linearGradient>
        <radialGradient id="gd-cw-plate" cx="44%" cy="38%" r="68%">
          <stop offset="0%" stop-color="#4A3923"/>
          <stop offset="68%" stop-color="#2E2214"/>
          <stop offset="100%" stop-color="#19120A"/>
        </radialGradient>
      </defs>

      <!-- Resting floor shadow -->
      <ellipse cx="38" cy="86" rx="22" ry="2.8" fill="rgba(26, 20, 12, 0.16)"/>

      <!-- Top watchmaker suspension ring -->
      <circle cx="38" cy="11" r="5.5" stroke="#4D320C" stroke-width="2.6" fill="none"/>
      <circle cx="38" cy="11" r="5.5" stroke="url(#gd-cw-brass)" stroke-width="1.6" fill="none"/>
      <rect x="35.2" y="15.5" width="5.6" height="4.8" rx="1" fill="url(#gd-cw-brass)" stroke="#4A300B" stroke-width="0.75"/>

      <!-- Forged dark-bronze horological frame plate & brass corner rivets -->
      <path d="M13 30 C13 21.5, 22 18.5, 38 18.5 C54 18.5, 63 21.5, 63 30 L64 62 C64 73.5, 53 80, 38 80 C23 80, 12 73.5, 12 62 Z" fill="url(#gd-cw-plate)" stroke="url(#gd-cw-brass)" stroke-width="1.4"/>
      <path d="M16 32 C16 24.5, 24 21.5, 38 21.5 C52 21.5, 60 24.5, 60 32 L60.5 60.5 C60.5 70, 51 76.5, 38 76.5 C25 76.5, 15.5 70, 15.5 60.5 Z" fill="none" stroke="rgba(242, 204, 118, 0.28)" stroke-width="0.75"/>
      <circle cx="20" cy="25.5" r="1.4" fill="#DFAB4B"/>
      <circle cx="56" cy="25.5" r="1.4" fill="#DFAB4B"/>
      <circle cx="19" cy="70.5" r="1.4" fill="#DFAB4B"/>
      <circle cx="57" cy="70.5" r="1.4" fill="#DFAB4B"/>

      <!-- Gear 3: Burnished Copper-Brass Winding Crown Wheel (9T, ratio +1.556x) -->
      <g class="gd-cw-gear-crown" style="transform-origin: 19.5px 36.5px;">
        <path d="${crownGearPath}" fill="url(#gd-cw-copper)" stroke="#47270A" stroke-width="0.75" stroke-linejoin="round"/>
        <circle cx="19.5" cy="36.5" r="5.2" fill="#2A1E12" stroke="#D9A35E" stroke-width="0.7"/>
        ${buildSpokes(19.5, 36.5, 1.5, 5.2, 4)}
        <circle cx="19.5" cy="36.5" r="1.8" fill="#F2D084" stroke="#47270A" stroke-width="0.6"/>
      </g>

      <!-- Gear 2: Heat-Blued Steel Escape Pinion (10T, ratio -1.4x) -->
      <g class="gd-cw-gear-pinion" style="transform-origin: 54.5px 40.5px;">
        <path d="${pinionGearPath}" fill="url(#gd-cw-steel)" stroke="#162434" stroke-width="0.75" stroke-linejoin="round"/>
        <circle cx="54.5" cy="40.5" r="5.9" fill="#1F2B38" stroke="#7EA4C8" stroke-width="0.7"/>
        ${buildSpokes(54.5, 40.5, 1.8, 5.9, 4)}
        <circle cx="54.5" cy="40.5" r="2.1" fill="#F2CE74" stroke="#452E0B" stroke-width="0.65"/>
        <circle cx="54.5" cy="40.5" r="0.9" fill="#9E2424"/>
      </g>

      <!-- Gear 1: Main Great Brass Escape Wheel (14T, ratio 1.0x) -->
      <g class="gd-cw-gear-main" style="transform-origin: 35px 55px;">
        <path d="${mainGearPath}" fill="url(#gd-cw-brass)" stroke="#452D09" stroke-width="0.85" stroke-linejoin="round"/>
        <circle cx="35" cy="55" r="11.2" fill="#22190F" stroke="rgba(255, 240, 176, 0.55)" stroke-width="0.8"/>
        ${buildSpokes(35, 55, 3.2, 11.2, 5)}
        <circle cx="35" cy="55" r="3.8" fill="url(#gd-cw-brass)" stroke="#452D09" stroke-width="0.75"/>
        <circle cx="35" cy="55" r="1.65" fill="#A82424" stroke="#FFF2BA" stroke-width="0.45"/>
      </g>

      <!-- Pivoting Steel Anchor Escapement Lever -->
      <g class="gd-cw-anchor" style="transform-origin: 38px 27px;">
        <path d="M29 36 L36.4 26.2 L39.6 26.2 L47 36 L44.5 37.8 L38 29.5 L31.5 37.8 Z" fill="url(#gd-cw-steel)" stroke="#14202C" stroke-width="0.75" stroke-linejoin="round"/>
        <circle cx="38" cy="27" r="2.2" fill="#F3D27E" stroke="#472E0A" stroke-width="0.65"/>
      </g>
    </svg>
  `;

  const mainGearEl = btn.querySelector('.gd-cw-gear-main') as SVGGElement | null;
  const pinionGearEl = btn.querySelector('.gd-cw-gear-pinion') as SVGGElement | null;
  const crownGearEl = btn.querySelector('.gd-cw-gear-crown') as SVGGElement | null;
  const anchorEl = btn.querySelector('.gd-cw-anchor') as SVGGElement | null;
  const noteEl = btn.querySelector('.gd-clockwork-note') as HTMLElement | null;

  let mainAngle = 0;
  let gearVel = 0;
  let anchorPhase = 0;
  let lastTs = 0;
  let rafId: number | null = null;

  const syncWorkshopClass = (open: boolean) => {
    if (btn?.classList) {
      if (open) btn.classList.add('is-open');
      else btn.classList.remove('is-open');
    }
    btn.setAttribute('aria-pressed', open ? 'true' : 'false');
    btn.title = open ? 'Click to close calibration controls' : 'Click to open portal calibration controls';
    if (noteEl) {
      noteEl.textContent = open ? 'Close controls' : 'Calibrate';
    }
    if (typeof document !== 'undefined') {
      const appEl = document.querySelector('.gd-dashboard-app');
      const viewEl = typeof btn.closest === 'function' ? btn.closest('#view-settings') : null;
      if (appEl?.classList) {
        const isSettingsMounted = Boolean(viewEl && document.contains(viewEl));
        if (open && isSettingsMounted) appEl.classList.add('gd-settings-workshop-on');
        else appEl.classList.remove('gd-settings-workshop-on');
      }
    }
  };

  const applyTransforms = (anchorDeg = 0) => {
    if (mainGearEl) mainGearEl.style.transform = `rotate(${mainAngle.toFixed(2)}deg)`;
    if (pinionGearEl) pinionGearEl.style.transform = `rotate(${(-mainAngle * 1.4).toFixed(2)}deg)`;
    if (crownGearEl) crownGearEl.style.transform = `rotate(${(mainAngle * 1.556).toFixed(2)}deg)`;
    if (anchorEl) anchorEl.style.transform = `rotate(${anchorDeg.toFixed(2)}deg)`;
  };

  const step = (ts: number) => {
    if (typeof document !== 'undefined' && !document.contains(btn)) {
      rafId = null;
      return;
    }

    const dt = lastTs ? Math.min(0.04, (ts - lastTs) / 1000) : 0.016;
    lastTs = ts;

    const targetCruise = sharedWorkshopOpen ? 34 : 0;
    gearVel += (targetCruise - gearVel) * Math.min(1, dt * (sharedWorkshopOpen ? 3.8 : 2.8));
    mainAngle = (mainAngle + gearVel * dt) % 3600;

    let anchorDeg = 0;
    if (sharedWorkshopOpen || Math.abs(gearVel) > 1.5) {
      anchorPhase += dt * (sharedWorkshopOpen ? 10.5 : 8.5);
      const energy = sharedWorkshopOpen ? 1 : Math.min(1, Math.abs(gearVel) / 60);
      anchorDeg = Math.sin(anchorPhase) * 8.5 * energy;
    }

    applyTransforms(anchorDeg);

    if (sharedWorkshopOpen || Math.abs(gearVel) > 0.45) {
      rafId = requestAnimationFrame(step);
    } else {
      gearVel = 0;
      applyTransforms(0);
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

  applyTransforms(0);
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => syncWorkshopClass(sharedWorkshopOpen));
    if (sharedWorkshopOpen) ensureRunning();
  }

  btn.addEventListener('mouseenter', () => {
    gearVel += 72;
    ensureRunning();
  });

  btn.addEventListener('click', () => {
    sharedWorkshopOpen = !sharedWorkshopOpen;
    gearVel += sharedWorkshopOpen ? 135 : -85;
    playClockworkMechanismSound(sharedWorkshopOpen);
    syncWorkshopClass(sharedWorkshopOpen);
    if (typeof window !== 'undefined' && typeof CustomEvent === 'function') {
      window.dispatchEvent(new CustomEvent('gd-workshop-toggle', { detail: { open: sharedWorkshopOpen } }));
    }
    ensureRunning();
  });

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    const onSync = (ev: Event) => {
      if (typeof document !== 'undefined' && !document.contains(btn)) {
        window.removeEventListener('gd-workshop-toggle', onSync);
        return;
      }
      const nextOpen = (ev as CustomEvent<{ open?: boolean }>).detail?.open;
      if (typeof nextOpen === 'boolean' && nextOpen !== sharedWorkshopOpen) {
        sharedWorkshopOpen = nextOpen;
        syncWorkshopClass(sharedWorkshopOpen);
        ensureRunning();
      }
    };
    window.addEventListener('gd-workshop-toggle', onSync);
  }

  return btn;
}

