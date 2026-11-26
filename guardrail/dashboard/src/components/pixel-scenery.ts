/**
 * Guardrail Pixel Scenery Generator
 *
 * Crisp, integer-grid pixel-art landscapes (96x34 virtual pixels) that shift
 * with real local time: morning, afternoon, evening, and night.
 */

export type SceneryPhase = 'morning' | 'afternoon' | 'evening' | 'night';

export interface SceneryMeta {
  phase: SceneryPhase;
  greeting: string;
  isDarkScene: boolean;
  svg: string;
}

function rect(x: number, y: number, w: number, h: number, fill: string): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
}

function pixelPine(
  x: number,
  baseY: number,
  height: number,
  fill: string,
  trunkFill: string,
  swayVariant: 'a' | 'b' = 'a'
): string {
  const canopy: string[] = [];
  const layers = Math.max(2, Math.floor((height - 2) / 2));
  for (let i = 0; i < layers; i++) {
    const w = 1 + i * 2;
    const lx = x - i;
    const ly = baseY - height + i * 2;
    canopy.push(rect(lx, ly, w, 2, fill));
  }
  return [
    rect(x, baseY - 2, 1, 2, trunkFill),
    `<g class="gd-px-pine-sway-${swayVariant}" style="transform-origin:${x}px ${baseY - 2}px">`,
    ...canopy,
    `</g>`,
  ].join('');
}

function pixelCloud(x: number, y: number, light: string, shade: string): string {
  return [
    rect(x + 2, y, 6, 1, light),
    rect(x + 1, y + 1, 9, 1, light),
    rect(x, y + 2, 11, 1, light),
    rect(x + 1, y + 3, 9, 1, shade),
  ].join('');
}

function buildMorningSvg(): string {
  const sky = [
    rect(0, 0, 96, 7, '#C5D3C2'),
    rect(0, 7, 96, 7, '#DBE0C8'),
    rect(0, 14, 96, 7, '#EDE0C2'),
    rect(0, 21, 96, 13, '#F2D59F'),
  ].join('');

  const sun = [
    `<g class="gd-px-sun-core">`,
    rect(72, 14, 6, 1, '#F7D47A'),
    rect(70, 15, 10, 2, '#F5C45E'),
    rect(69, 17, 12, 4, '#EAA844'),
    `</g>`,
    `<g class="gd-px-sun-rays-a">`,
    rect(74, 11, 2, 1, '#F7D47A'),
    rect(66, 16, 2, 1, '#F7D47A'),
    rect(82, 16, 2, 1, '#F7D47A'),
    `</g>`,
    `<g class="gd-px-sun-rays-b">`,
    rect(68, 13, 1, 1, '#F7D47A'),
    rect(81, 13, 1, 1, '#F7D47A'),
    `</g>`,
  ].join('');

  const clouds = [
    `<g class="gd-px-cloud-a">${pixelCloud(46, 5, '#FAF6EC', '#E3DEC8')}</g>`,
    `<g class="gd-px-cloud-b">${pixelCloud(64, 8, '#FAF6EC', '#E5DEC7')}</g>`,
  ].join('');

  const birds = [
    `<g class="gd-px-bird-a">`,
    `<g class="gd-px-wing-up">`,
    rect(57, 13, 1, 1, '#3B4834'),
    rect(59, 13, 1, 1, '#3B4834'),
    rect(58, 14, 1, 1, '#3B4834'),
    `</g>`,
    `<g class="gd-px-wing-down">`,
    rect(57, 14, 1, 1, '#3B4834'),
    rect(58, 13, 1, 1, '#3B4834'),
    rect(59, 14, 1, 1, '#3B4834'),
    `</g>`,
    `</g>`,
    `<g class="gd-px-bird-b">`,
    `<g class="gd-px-wing-up">`,
    rect(62, 11, 1, 1, '#3B4834'),
    rect(64, 11, 1, 1, '#3B4834'),
    rect(63, 12, 1, 1, '#3B4834'),
    `</g>`,
    `<g class="gd-px-wing-down">`,
    rect(62, 12, 1, 1, '#3B4834'),
    rect(63, 11, 1, 1, '#3B4834'),
    rect(64, 12, 1, 1, '#3B4834'),
    `</g>`,
    `</g>`,
  ].join('');

  const farHills = [
    rect(0, 24, 96, 10, '#859674'),
    rect(12, 22, 26, 2, '#859674'),
    rect(18, 20, 14, 2, '#859674'),
    rect(50, 21, 24, 3, '#859674'),
    rect(56, 19, 12, 2, '#859674'),
    rect(80, 22, 16, 2, '#859674'),
  ].join('');

  const mist = [
    `<g class="gd-px-mist">`,
    rect(4, 24, 24, 1, '#FAF6EC'),
    rect(10, 23, 14, 1, '#FAF6EC'),
    rect(48, 24, 22, 1, '#FAF6EC'),
    rect(54, 23, 12, 1, '#FAF6EC'),
    `</g>`,
  ].join('');

  const midHills = [
    rect(0, 27, 96, 7, '#4F6144'),
    rect(0, 25, 32, 2, '#4F6144'),
    rect(6, 24, 16, 1, '#4F6144'),
    rect(60, 25, 36, 2, '#4F6144'),
    rect(68, 24, 20, 1, '#4F6144'),
  ].join('');

  const foreGround = [
    rect(0, 30, 96, 4, '#2A3723'),
    rect(64, 29, 32, 1, '#2A3723'),
    pixelPine(68, 30, 7, '#1F2B19', '#161F12', 'a'),
    pixelPine(75, 30, 9, '#23301D', '#161F12', 'b'),
    pixelPine(83, 30, 6, '#1F2B19', '#161F12', 'a'),
    pixelPine(90, 30, 8, '#23301D', '#161F12', 'b'),
  ].join('');

  return `<svg viewBox="0 0 96 34" preserveAspectRatio="xMidYMid slice" shape-rendering="crispEdges" aria-hidden="true">${sky}${sun}${clouds}${birds}${farHills}${mist}${midHills}${foreGround}</svg>`;
}

function buildAfternoonSvg(): string {
  const sky = [
    rect(0, 0, 96, 8, '#94B0A4'),
    rect(0, 8, 96, 8, '#AFC4B5'),
    rect(0, 16, 96, 8, '#CBDBC8'),
    rect(0, 24, 96, 10, '#E3E3CE'),
  ].join('');

  const sun = [
    `<g class="gd-px-sun-core">`,
    rect(76, 4, 4, 1, '#F5D46B'),
    rect(75, 5, 6, 4, '#F0C24D'),
    rect(76, 9, 4, 1, '#F5D46B'),
    `</g>`,
    `<g class="gd-px-sun-rays-a">`,
    rect(77, 2, 2, 1, '#F5D46B'),
    rect(73, 6, 1, 2, '#F5D46B'),
    rect(82, 6, 1, 2, '#F5D46B'),
    `</g>`,
  ].join('');

  const clouds = [
    `<g class="gd-px-cloud-a">${pixelCloud(44, 6, '#FAF8F1', '#DCE3D5')}</g>`,
    `<g class="gd-px-cloud-b">${pixelCloud(60, 11, '#FAF8F1', '#DCE3D5')}</g>`,
    `<g class="gd-px-cloud-c">${pixelCloud(82, 13, '#FAF8F1', '#DCE3D5')}</g>`,
  ].join('');

  const afternoonLife = [
    `<g class="gd-px-bird-c">`,
    `<g class="gd-px-wing-up">`,
    rect(53, 9, 1, 1, '#445939'),
    rect(55, 9, 1, 1, '#445939'),
    rect(54, 10, 1, 1, '#445939'),
    `</g>`,
    `<g class="gd-px-wing-down">`,
    rect(53, 10, 1, 1, '#445939'),
    rect(54, 9, 1, 1, '#445939'),
    rect(55, 10, 1, 1, '#445939'),
    `</g>`,
    `</g>`,
    `<g class="gd-px-mote-a">${rect(58, 22, 1, 1, '#FAF8F1')}</g>`,
    `<g class="gd-px-mote-b">${rect(72, 24, 1, 1, '#F5D46B')}</g>`,
    `<g class="gd-px-mote-c">${rect(84, 21, 1, 1, '#FAF8F1')}</g>`,
  ].join('');

  const farHills = [
    rect(0, 24, 96, 10, '#6B825D'),
    rect(16, 22, 24, 2, '#6B825D'),
    rect(22, 20, 12, 2, '#6B825D'),
    rect(54, 21, 26, 3, '#6B825D'),
    rect(60, 19, 14, 2, '#6B825D'),
  ].join('');

  const midHills = [
    rect(0, 27, 96, 7, '#445939'),
    rect(0, 25, 28, 2, '#445939'),
    rect(62, 25, 34, 2, '#445939'),
  ].join('');

  const foreGround = [
    rect(0, 30, 96, 4, '#24321E'),
    rect(66, 29, 30, 1, '#24321E'),
    pixelPine(70, 30, 8, '#1B2716', '#131C0F', 'a'),
    pixelPine(78, 30, 6, '#212F1B', '#131C0F', 'b'),
    pixelPine(86, 30, 9, '#1B2716', '#131C0F', 'a'),
  ].join('');

  return `<svg viewBox="0 0 96 34" preserveAspectRatio="xMidYMid slice" shape-rendering="crispEdges" aria-hidden="true">${sky}${sun}${clouds}${afternoonLife}${farHills}${midHills}${foreGround}</svg>`;
}

function buildEveningSvg(): string {
  const sky = [
    rect(0, 0, 96, 6, '#39323E'),
    rect(0, 6, 96, 6, '#6A4446'),
    rect(0, 12, 96, 6, '#A65B46'),
    rect(0, 18, 96, 6, '#D6894F'),
    rect(0, 24, 96, 10, '#E9B76B'),
  ].join('');

  const sun = [
    `<g class="gd-px-horizon-glow">`,
    rect(58, 21, 34, 2, '#F0B34D'),
    rect(64, 19, 22, 2, '#F6D16D'),
    `</g>`,
    `<g class="gd-px-sun-core">`,
    rect(72, 17, 6, 1, '#F6D16D'),
    rect(70, 18, 10, 5, '#F0B34D'),
    `</g>`,
  ].join('');

  const clouds = [
    `<g class="gd-px-cloud-a">${pixelCloud(48, 7, '#8E5854', '#603B3D')}</g>`,
    `<g class="gd-px-cloud-b">${pixelCloud(66, 10, '#C27453', '#8E5144')}</g>`,
  ].join('');

  const farHills = [
    rect(0, 23, 96, 11, '#362F31'),
    rect(14, 21, 24, 2, '#362F31'),
    rect(52, 20, 26, 3, '#362F31'),
    rect(60, 18, 10, 2, '#362F31'),
  ].join('');

  const foreGround = [
    rect(0, 28, 96, 6, '#1B2219'),
    rect(58, 26, 38, 2, '#1B2219'),
    rect(66, 25, 22, 1, '#1B2219'),
    pixelPine(64, 27, 7, '#121811', '#0D120C', 'a'),
    pixelPine(79, 27, 8, '#121811', '#0D120C', 'b'),
    pixelPine(88, 27, 6, '#121811', '#0D120C', 'a'),
    // tiny warm cabin silhouette, chimney smoke & lit window
    rect(71, 24, 5, 3, '#141913'),
    rect(70, 23, 7, 1, '#0E120D'),
    `<g class="gd-px-smoke-1">${rect(74, 21, 1, 1, '#C27453')}</g>`,
    `<g class="gd-px-smoke-2">${rect(74, 21, 1, 1, '#D6894F')}</g>`,
    `<g class="gd-px-smoke-3">${rect(74, 21, 1, 1, '#8E5854')}</g>`,
    `<g class="gd-px-window-halo">${rect(72, 24, 4, 3, '#F6BF58')}</g>`,
    `<g class="gd-px-window">${rect(73, 25, 2, 1, '#F6BF58')}</g>`,
  ].join('');

  return `<svg viewBox="0 0 96 34" preserveAspectRatio="xMidYMid slice" shape-rendering="crispEdges" aria-hidden="true">${sky}${sun}${clouds}${farHills}${foreGround}</svg>`;
}

function buildNightSvg(): string {
  const sky = [
    rect(0, 0, 96, 8, '#111815'),
    rect(0, 8, 96, 8, '#17211C'),
    rect(0, 16, 96, 8, '#1E2B24'),
    rect(0, 24, 96, 10, '#25352C'),
  ].join('');

  const stars = [
    `<g class="gd-px-star-a">`,
    // twinkling 1x1 stars
    rect(46, 4, 1, 1, '#EDE6D6'),
    rect(61, 3, 1, 1, '#EDE6D6'),
    rect(72, 6, 1, 1, '#EDE6D6'),
    rect(90, 13, 1, 1, '#EDE6D6'),
    // 3x3 cross star
    rect(49, 11, 3, 1, '#EDE6D6'),
    rect(50, 10, 1, 3, '#EDE6D6'),
    `</g>`,
    `<g class="gd-px-star-b">`,
    rect(53, 8, 1, 1, '#9EB09E'),
    rect(66, 11, 1, 1, '#9EB09E'),
    rect(87, 5, 1, 1, '#9EB09E'),
    rect(57, 14, 1, 1, '#9EB09E'),
    // 3x3 cross star 2
    rect(84, 10, 3, 1, '#D5DEC9'),
    rect(85, 9, 1, 3, '#D5DEC9'),
    `</g>`,
    `<g class="gd-px-shooting-star">`,
    rect(52, 5, 2, 1, '#EDE6D6'),
    rect(54, 5, 1, 1, '#F7D47A'),
    `</g>`,
  ].join('');

  const moon = [
    `<g class="gd-px-moon">`,
    rect(77, 4, 4, 1, '#F3EBD6'),
    rect(76, 5, 3, 1, '#F3EBD6'),
    rect(76, 6, 2, 3, '#F3EBD6'),
    rect(76, 9, 3, 1, '#F3EBD6'),
    rect(77, 10, 4, 1, '#D8CEB4'),
    `</g>`,
  ].join('');

  const farHills = [
    rect(0, 23, 96, 11, '#18221C'),
    rect(12, 21, 26, 2, '#18221C'),
    rect(50, 20, 28, 3, '#18221C'),
    rect(58, 18, 12, 2, '#18221C'),
  ].join('');

  const foreGround = [
    rect(0, 28, 96, 6, '#0E1511'),
    rect(58, 26, 38, 2, '#0E1511'),
    rect(68, 25, 22, 1, '#0E1511'),
    pixelPine(63, 27, 7, '#090E0B', '#070A08', 'a'),
    pixelPine(77, 27, 9, '#090E0B', '#070A08', 'b'),
    pixelPine(86, 27, 6, '#090E0B', '#070A08', 'a'),
    pixelPine(91, 27, 8, '#090E0B', '#070A08', 'b'),
    // tiny warm cabin window glow & chimney smoke
    rect(69, 24, 5, 3, '#131A15'),
    rect(68, 23, 7, 1, '#0A0F0C'),
    `<g class="gd-px-smoke-1">${rect(72, 21, 1, 1, '#9EB09E')}</g>`,
    `<g class="gd-px-smoke-2">${rect(72, 21, 1, 1, '#D5DEC9')}</g>`,
    `<g class="gd-px-smoke-3">${rect(72, 21, 1, 1, '#9EB09E')}</g>`,
    `<g class="gd-px-window-halo">${rect(70, 24, 4, 3, '#EBB04E')}</g>`,
    `<g class="gd-px-window">${rect(71, 25, 2, 1, '#EBB04E')}</g>`,
    // forest fireflies
    `<g class="gd-px-firefly-1">${rect(60, 26, 1, 1, '#EBB04E')}</g>`,
    `<g class="gd-px-firefly-2">${rect(75, 25, 1, 1, '#D5DEC9')}</g>`,
    `<g class="gd-px-firefly-3">${rect(84, 26, 1, 1, '#EBB04E')}</g>`,
  ].join('');

  return `<svg viewBox="0 0 96 34" preserveAspectRatio="xMidYMid slice" shape-rendering="crispEdges" aria-hidden="true">${sky}${stars}${moon}${farHills}${foreGround}</svg>`;
}

export function getRealTimeScenery(now: Date = new Date()): SceneryMeta {
  const hr = now.getHours();
  if (hr >= 5 && hr < 12) {
    return {
      phase: 'morning',
      greeting: 'Good morning',
      isDarkScene: false,
      svg: buildMorningSvg(),
    };
  }
  if (hr >= 12 && hr < 17) {
    return {
      phase: 'afternoon',
      greeting: 'Good afternoon',
      isDarkScene: false,
      svg: buildAfternoonSvg(),
    };
  }
  if (hr >= 17 && hr < 21) {
    return {
      phase: 'evening',
      greeting: 'Good evening',
      isDarkScene: true,
      svg: buildEveningSvg(),
    };
  }
  return {
    phase: 'night',
    greeting: 'Good night',
    isDarkScene: true,
    svg: buildNightSvg(),
  };
}

/**
 * Creates the borderless, background-merged pixel scenery + time + greeting
 * element displayed on the right side of desktop page headers.
 */
export function createMergedGreetingWidget(now: Date = new Date()): HTMLElement {
  const scenery = getRealTimeScenery(now);
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const greetingCard = document.createElement('div');
  greetingCard.className = `gd-overview-greeting-card phase-${scenery.phase} ${scenery.isDarkScene ? 'is-dark' : 'is-light'}`;

  const sceneArt = document.createElement('div');
  sceneArt.className = 'gd-overview-scenery-art';
  sceneArt.setAttribute('aria-hidden', 'true');
  sceneArt.innerHTML = scenery.svg;

  const sceneScrim = document.createElement('div');
  sceneScrim.className = 'gd-overview-scenery-scrim';
  sceneScrim.setAttribute('aria-hidden', 'true');

  const cardContent = document.createElement('div');
  cardContent.className = 'gd-overview-greeting-card-content';

  const timeChip = document.createElement('div');
  timeChip.className = 'gd-px-time-badge';
  const pulseDot = document.createElement('span');
  pulseDot.className = 'gd-px-clock-dot';
  pulseDot.setAttribute('aria-hidden', 'true');
  const timeText = document.createElement('span');
  timeText.textContent = timeStr;
  timeChip.appendChild(pulseDot);
  timeChip.appendChild(timeText);

  const greetingText = document.createElement('div');
  greetingText.className = 'gd-px-greeting-text';
  greetingText.textContent = scenery.greeting;

  cardContent.appendChild(timeChip);
  cardContent.appendChild(greetingText);

  greetingCard.appendChild(sceneArt);
  greetingCard.appendChild(sceneScrim);
  greetingCard.appendChild(cardContent);

  return greetingCard;
}

/**
 * Creates the full-viewport ambient animated pixel backdrop:
 * multi-plane parallax sky, distant peaks, a continuous 4-zone panoramic world
 * (History watchtower -> Wards hearth village -> Settings windmill -> Queue lakeside sanctuary),
 * foreground meadow silhouettes, drifting clouds, and floating motes.
 */
export function createAmbientBackdrop(phase: SceneryPhase, extraClass: string = ''): HTMLElement {
  const layer = document.createElement('div');
  layer.className = `gd-m-ambient phase-${phase}${extraClass ? ` ${extraClass}` : ''}`;
  layer.setAttribute('aria-hidden', 'true');

  const beamWrap = document.createElement('div');
  beamWrap.className = 'gd-m-beam-wrap';
  const beam = document.createElement('div');
  beam.className = 'gd-m-beam';
  beamWrap.appendChild(beam);
  layer.appendChild(beamWrap);

  // 1. Slow parallax sky layer (celestial body, stars/birds, distant high cloud wisps)
  const sky = document.createElement('div');
  sky.className = 'gd-m-bg-sky';
  const isNight = phase === 'night';
  const isEvening = phase === 'evening';
  const celestialSvg = isNight
    ? `
      <!-- Crescent moon on the right/Queue sky + twinkling 4-pt pixel stars across panes -->
      <g class="gd-px-bg-celestial" fill="currentColor">
        <rect x="148" y="8" width="5" height="2" opacity="0.72"/>
        <rect x="146" y="10" width="4" height="2" opacity="0.72"/>
        <rect x="145" y="12" width="3" height="4" opacity="0.72"/>
        <rect x="146" y="16" width="4" height="2" opacity="0.72"/>
        <rect x="148" y="18" width="5" height="2" opacity="0.72"/>
      </g>
      <g class="gd-px-bg-twinkle-a" fill="currentColor">
        <rect x="20" y="9" width="1" height="3"/><rect x="19" y="10" width="3" height="1"/>
        <rect x="74" y="7" width="1" height="3"/><rect x="73" y="8" width="3" height="1"/>
        <rect x="122" y="11" width="1" height="3"/><rect x="121" y="12" width="3" height="1"/>
      </g>
      <g class="gd-px-bg-twinkle-b" fill="currentColor">
        <rect x="48" y="14" width="1" height="1"/>
        <rect x="98" y="12" width="1" height="1"/>
        <rect x="166" y="14" width="1" height="1"/>
      </g>
    `
    : `
      <!-- Subtle solar halo + high soaring pixel birds -->
      <g class="gd-px-bg-celestial" fill="currentColor">
        <rect x="${isEvening ? 136 : 144}" y="${isEvening ? 18 : 9}" width="8" height="2" opacity="0.28"/>
        <rect x="${isEvening ? 134 : 142}" y="${isEvening ? 20 : 11}" width="12" height="5" opacity="0.34"/>
        <rect x="${isEvening ? 136 : 144}" y="${isEvening ? 25 : 16}" width="8" height="2" opacity="0.24"/>
      </g>
      <g class="gd-px-bg-birds" fill="currentColor" opacity="0.45">
        <rect x="34" y="14" width="1" height="1"/><rect x="35" y="15" width="1" height="1"/><rect x="36" y="14" width="1" height="1"/>
        <rect x="40" y="12" width="1" height="1"/><rect x="41" y="13" width="1" height="1"/><rect x="42" y="12" width="1" height="1"/>
        <rect x="108" y="15" width="1" height="1"/><rect x="109" y="16" width="1" height="1"/><rect x="110" y="15" width="1" height="1"/>
        <rect x="114" y="13" width="1" height="1"/><rect x="115" y="14" width="1" height="1"/><rect x="116" y="13" width="1" height="1"/>
      </g>
    `;
  sky.innerHTML = `<svg viewBox="0 0 180 42" preserveAspectRatio="xMidYMin slice" shape-rendering="crispEdges">
    ${celestialSvg}
    <g fill="currentColor" opacity="0.28">
      <rect x="14" y="20" width="10" height="2"/><rect x="10" y="22" width="18" height="2"/>
      <rect x="64" y="16" width="8" height="2"/><rect x="61" y="18" width="14" height="2"/>
      <rect x="116" y="21" width="9" height="2"/><rect x="113" y="23" width="15" height="2"/>
    </g>
  </svg>`;
  layer.appendChild(sky);

  const cloudSvg = `<svg viewBox="0 0 24 8" shape-rendering="crispEdges"><rect x="6" y="0" width="10" height="2" fill="currentColor"/><rect x="3" y="2" width="17" height="2" fill="currentColor"/><rect x="0" y="4" width="24" height="2" fill="currentColor"/><rect x="2" y="6" width="19" height="2" fill="currentColor" opacity="0.65"/></svg>`;
  [
    { cls: 'c1', top: '16%', w: 92 },
    { cls: 'c2', top: '48%', w: 72 },
    { cls: 'c3', top: '74%', w: 98 },
  ].forEach((c) => {
    const cloud = document.createElement('div');
    cloud.className = `gd-m-bg-cloud ${c.cls}`;
    cloud.style.top = c.top;
    cloud.style.width = `${c.w}px`;
    cloud.innerHTML = cloudSvg;
    layer.appendChild(cloud);
  });

  const moteLayer = document.createElement('div');
  moteLayer.className = 'gd-m-mote-layer';
  const motes = [
    { x: 8, y: 15, s: 6, dur: 10, del: -1, dx: 16, dy: -32 },
    { x: 86, y: 21, s: 7, dur: 12, del: -4, dx: -14, dy: -28 },
    { x: 14, y: 46, s: 6, dur: 13, del: -6, dx: 18, dy: -26 },
    { x: 90, y: 52, s: 8, dur: 11, del: -2, dx: -16, dy: -30 },
    { x: 10, y: 74, s: 7, dur: 14, del: -5, dx: 14, dy: -34 },
    { x: 46, y: 80, s: 6, dur: 11, del: -8, dx: -10, dy: -26 },
    { x: 84, y: 81, s: 8, dur: 13, del: -3, dx: 12, dy: -30 },
    { x: 26, y: 86, s: 6, dur: 12, del: -7, dx: 16, dy: -24 },
    { x: 68, y: 73, s: 7, dur: 15, del: -4, dx: -14, dy: -28 },
  ];

  motes.forEach((m, idx) => {
    const el = document.createElement('span');
    el.className = `gd-m-mote ${idx % 2 === 0 ? 'alt' : ''}`;
    el.style.cssText = `left:${m.x}%;top:${m.y}%;width:${m.s}px;height:${m.s}px;--dur:${m.dur}s;--del:${m.del}s;--dx:${m.dx}px;--dy:${m.dy}px;`;
    moteLayer.appendChild(el);
  });
  layer.appendChild(moteLayer);

  // 2. Far mountain silhouette ridge (slower parallax depth behind the valley)
  const far = document.createElement('div');
  far.className = 'gd-m-bg-far';
  far.innerHTML = `<svg viewBox="0 0 320 42" preserveAspectRatio="none" shape-rendering="crispEdges">
    <path d="M0 30 H18 V24 H34 V18 H52 V22 H72 V27 H96 V20 H114 V14 H134 V19 H154 V25 H178 V18 H196 V12 H214 V17 H234 V24 H256 V19 H274 V14 H292 V21 H320 V42 H0 Z" fill="currentColor" opacity="0.48"/>
    <path d="M10 34 H44 V31 H84 V28 H138 V32 H190 V27 H242 V31 H304 V34 H320 V42 H0 Z" fill="currentColor" opacity="0.28"/>
  </svg>`;
  layer.appendChild(far);

  // 3. Mid valley continuous panoramic world (History -> Wards -> Settings -> Queue)
  const tree = (x: number, y: number, h: number) => {
    const trunk = `<rect x="${x}" y="${y}" width="1" height="2" fill="currentColor"/>`;
    if (h >= 5) {
      return `${trunk}<rect x="${x - 2}" y="${y - 2}" width="5" height="2" fill="currentColor"/><rect x="${x - 1}" y="${y - 4}" width="3" height="2" fill="currentColor"/><rect x="${x}" y="${y - 5}" width="1" height="1" fill="currentColor"/>`;
    }
    return `${trunk}<rect x="${x - 1}" y="${y - 2}" width="3" height="2" fill="currentColor"/><rect x="${x}" y="${y - 3}" width="1" height="1" fill="currentColor"/>`;
  };

  const horizon = document.createElement('div');
  horizon.className = 'gd-m-bg-horizon';
  horizon.innerHTML = `<svg viewBox="0 0 360 36" preserveAspectRatio="none" shape-rendering="crispEdges">
    <!-- Continuous rolling valley floor elevated clearly above the floating dock -->
    <path d="M0 20 H22 V17 H42 V15 H72 V18 H96 V16 H126 V19 H162 V15 H192 V18 H234 V16 H264 V20 H316 V17 H342 V19 H360 V36 H0 Z" fill="currentColor" opacity="0.58"/>
    <path d="M0 24 H266 V25 H324 V24 H360 V36 H0 Z" fill="currentColor" opacity="0.82"/>

    <!-- ZONE 0 (History): Old Stone Watchtower, Bell Spire & Archive Bridge -->
    <g class="gd-px-zone-history">
      <rect x="28" y="9" width="8" height="11" fill="currentColor"/>
      <rect x="27" y="7" width="10" height="2" fill="currentColor"/>
      <rect x="29" y="5" width="6" height="2" fill="currentColor"/>
      <rect x="31" y="3" width="2" height="2" fill="currentColor"/>
      <rect x="36" y="13" width="11" height="7" fill="currentColor" opacity="0.9"/>
      <rect x="35" y="12" width="13" height="1" fill="currentColor"/>
      <rect x="31" y="10" width="2" height="2" class="gd-m-bg-accent" opacity="0.85"/>
      <rect x="40" y="15" width="2" height="2" class="gd-m-bg-accent" opacity="0.65"/>
      ${tree(14, 18, 5)}${tree(21, 17, 4)}${tree(53, 17, 5)}${tree(61, 18, 4)}${tree(72, 16, 5)}
    </g>

    <!-- ZONE 1 (Wards): Cozy Hearth Cottages + Chimney Smoke -->
    <g class="gd-px-zone-wards">
      <!-- Cottage A -->
      <rect x="118" y="13" width="12" height="7" fill="currentColor"/>
      <rect x="116" y="12" width="16" height="1" fill="currentColor"/>
      <rect x="118" y="10" width="12" height="2" fill="currentColor"/>
      <rect x="121" y="8" width="6" height="2" fill="currentColor"/>
      <rect x="126" y="7" width="2" height="2" fill="currentColor"/>
      <g class="gd-px-bg-smoke" fill="currentColor" opacity="0.45">
        <rect x="126" y="4" width="2" height="2"/>
        <rect x="128" y="1" width="2" height="2"/>
      </g>
      <!-- Cottage B -->
      <rect x="136" y="14" width="10" height="6" fill="currentColor" opacity="0.92"/>
      <rect x="135" y="13" width="12" height="1" fill="currentColor"/>
      <rect x="137" y="11" width="8" height="2" fill="currentColor"/>
      <!-- Warm glowing windows -->
      <rect x="121" y="15" width="2" height="2" class="gd-m-bg-accent" opacity="0.92"/>
      <rect x="126" y="15" width="2" height="2" class="gd-m-bg-accent" opacity="0.92"/>
      <rect x="140" y="16" width="2" height="2" class="gd-m-bg-accent" opacity="0.88"/>
      <!-- Garden fence -->
      <rect x="108" y="18" width="8" height="1" fill="currentColor" opacity="0.75"/>
      <rect x="148" y="18" width="10" height="1" fill="currentColor" opacity="0.75"/>
      ${tree(102, 17, 5)}${tree(156, 16, 5)}${tree(166, 17, 4)}
    </g>

    <!-- ZONE 2 (Settings): Hilltop Windmill & Observatory Terrace -->
    <g class="gd-px-zone-settings">
      <rect x="200" y="9" width="6" height="11" fill="currentColor"/>
      <rect x="201" y="7" width="4" height="2" fill="currentColor"/>
      <rect x="202" y="8" width="2" height="2" class="gd-m-bg-accent" opacity="0.82"/>
      <!-- Rotating pixel windmill sails -->
      <g class="gd-px-windmill-blades" style="transform-origin: 203px 9px" fill="currentColor" opacity="0.88">
        <rect x="202" y="2" width="2" height="6"/>
        <rect x="202" y="10" width="2" height="6"/>
        <rect x="196" y="8" width="6" height="2"/>
        <rect x="204" y="8" width="6" height="2"/>
      </g>
      <!-- Observatory / Terrace Wall -->
      <rect x="212" y="15" width="11" height="5" fill="currentColor" opacity="0.85"/>
      <rect x="214" y="12" width="7" height="3" fill="currentColor" opacity="0.85"/>
      <rect x="216" y="11" width="3" height="1" fill="currentColor"/>
      ${tree(186, 17, 4)}${tree(193, 17, 5)}${tree(231, 16, 5)}${tree(242, 18, 4)}
    </g>

    <!-- ZONE 3 (Queue / Home): Peaceful Lakeside Pier, Bridge & Warm Signal Lantern -->
    <g class="gd-px-zone-queue">
      <!-- Calm water inlet visible above the dock -->
      <rect x="268" y="21" width="54" height="4" class="gd-m-bg-water" opacity="0.62"/>
      <g class="gd-px-water-shimmer" fill="#FAF6ED" opacity="0.44">
        <rect x="278" y="22" width="7" height="1"/>
        <rect x="294" y="23" width="9" height="1"/>
        <rect x="309" y="22" width="6" height="1"/>
      </g>
      <!-- Arched footbridge over cove -->
      <rect x="280" y="18" width="24" height="2" fill="currentColor"/>
      <rect x="284" y="16" width="16" height="2" fill="currentColor"/>
      <rect x="282" y="20" width="2" height="2" fill="currentColor"/>
      <rect x="300" y="20" width="2" height="2" fill="currentColor"/>
      <!-- Lantern post at pier -->
      <rect x="273" y="12" width="1" height="8" fill="currentColor"/>
      <rect x="273" y="12" width="3" height="1" fill="currentColor"/>
      <rect x="275" y="13" width="2" height="2" class="gd-m-bg-accent gd-px-lantern-glow"/>
      ${tree(258, 17, 5)}${tree(265, 18, 4)}${tree(320, 18, 5)}${tree(330, 17, 5)}${tree(342, 18, 4)}${tree(351, 16, 5)}
    </g>
  </svg>`;
  layer.appendChild(horizon);

  // 4. Foreground silhouette strip (fastest parallax plane near the bottom dock)
  const fore = document.createElement('div');
  fore.className = 'gd-m-bg-fore';
  fore.innerHTML = `<svg viewBox="0 0 400 18" preserveAspectRatio="none" shape-rendering="crispEdges">
    <path d="M0 13 H28 V11 H54 V14 H92 V11 H128 V13 H168 V10 H206 V13 H246 V11 H284 V14 H322 V10 H364 V13 H400 V18 H0 Z" fill="currentColor" opacity="0.88"/>
    <rect x="18" y="6" width="2" height="7" fill="currentColor"/><rect x="15" y="8" width="8" height="2" fill="currentColor"/><rect x="17" y="5" width="4" height="3" fill="currentColor"/>
    <rect x="96" y="7" width="2" height="6" fill="currentColor"/><rect x="93" y="9" width="8" height="2" fill="currentColor"/><rect x="95" y="6" width="4" height="3" fill="currentColor"/>
    <rect x="174" y="5" width="2" height="7" fill="currentColor"/><rect x="171" y="7" width="8" height="2" fill="currentColor"/><rect x="173" y="4" width="4" height="3" fill="currentColor"/>
    <rect x="256" y="6" width="2" height="6" fill="currentColor"/><rect x="253" y="8" width="8" height="2" fill="currentColor"/><rect x="255" y="5" width="4" height="3" fill="currentColor"/>
    <rect x="336" y="5" width="2" height="7" fill="currentColor"/><rect x="333" y="7" width="8" height="2" fill="currentColor"/><rect x="335" y="4" width="4" height="3" fill="currentColor"/>
    <!-- Subtle foreground meadow wildflower pixels -->
    <rect x="44" y="12" width="1" height="1" class="gd-m-bg-accent" opacity="0.75"/>
    <rect x="142" y="12" width="1" height="1" class="gd-m-bg-accent" opacity="0.75"/>
    <rect x="226" y="12" width="1" height="1" class="gd-m-bg-accent" opacity="0.75"/>
    <rect x="304" y="13" width="1" height="1" class="gd-m-bg-accent" opacity="0.75"/>
  </svg>`;
  layer.appendChild(fore);

  return layer;
}
