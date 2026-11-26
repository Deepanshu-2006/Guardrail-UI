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
 * Builds a realistic weathered forged-iron Y-chain and bracket assembly
 * suspending the aged wooden board from the top of the viewport.
 */
function buildWeatheredChainSvg(): string {
  const renderArm = (x1: number, y1: number, x2: number, y2: number): string => {
    const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
    const count = 11;
    const parts: string[] = [];
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / (count + 0.15);
      const cx = (x1 + (x2 - x1) * t).toFixed(1);
      const cy = (y1 + (y2 - y1) * t).toFixed(1);
      if (i % 2 === 0) {
        parts.push(
          `<g transform="translate(${cx},${cy}) rotate(${angle.toFixed(1)})">
            <rect x="-8" y="-3.6" width="16" height="7.2" rx="3.6" fill="none" stroke="#3B3935" stroke-width="2.4"/>
            <rect x="-8" y="-3.6" width="16" height="7.2" rx="3.6" fill="none" stroke="#76726A" stroke-width="0.8" opacity="0.55"/>
          </g>`
        );
      } else {
        parts.push(
          `<g transform="translate(${cx},${cy}) rotate(${angle.toFixed(1)})">
            <rect x="-7.5" y="-1.7" width="15" height="3.4" rx="1.7" fill="#46433E" stroke="#262421" stroke-width="0.9"/>
            <line x1="-4.5" y1="-0.6" x2="4" y2="-0.6" stroke="#858077" stroke-width="0.7" stroke-linecap="round" opacity="0.6"/>
          </g>`
        );
      }
    }
    return parts.join('');
  };

  return `
    <svg viewBox="0 0 560 128" fill="none" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMax meet">
      <!-- Top forged ceiling bracket -->
      <rect x="262" y="-1" width="36" height="9" rx="2" fill="#3D3A36" stroke="#23211E" stroke-width="1"/>
      <line x1="265" y1="2.5" x2="295" y2="2.5" stroke="#6E6A63" stroke-width="0.8" opacity="0.55"/>
      <circle cx="269" cy="4" r="1.4" fill="#23211E"/>
      <circle cx="291" cy="4" r="1.4" fill="#23211E"/>

      <!-- Vertical top forged links down to junction ring -->
      <g>
        <rect x="276.6" y="7" width="6.8" height="14" rx="3.4" fill="none" stroke="#3B3935" stroke-width="2.3"/>
        <rect x="276.6" y="7" width="6.8" height="14" rx="3.4" fill="none" stroke="#76726A" stroke-width="0.75" opacity="0.55"/>
        <rect x="278.4" y="18.5" width="3.2" height="13" rx="1.6" fill="#46433E" stroke="#262421" stroke-width="0.9"/>
        <rect x="276.6" y="28.5" width="6.8" height="13" rx="3.4" fill="none" stroke="#3B3935" stroke-width="2.3"/>
      </g>

      <!-- Twin diagonal weathered iron chains -->
      ${renderArm(280, 44, 104, 114.5)}
      ${renderArm(280, 44, 456, 121.5)}

      <!-- Central forged iron ring -->
      <circle cx="280" cy="44" r="7.6" fill="none" stroke="#3B3935" stroke-width="2.8"/>
      <circle cx="280" cy="44" r="7.6" fill="none" stroke="#7D786E" stroke-width="0.8" opacity="0.55"/>

      <!-- Left & right forged iron strap brackets anchored into tilted plank top -->
      <g>
        <circle cx="104" cy="114.5" r="5.5" fill="none" stroke="#4D4841" stroke-width="2.4"/>
        <path d="M97 115.5 H111 V125 H97 Z" fill="#3B3833" stroke="#22201D" stroke-width="1"/>
        <circle cx="104" cy="120.5" r="1.4" fill="#1F1D1A"/>
      </g>
      <g>
        <circle cx="456" cy="121.5" r="5.5" fill="none" stroke="#4D4841" stroke-width="2.4"/>
        <path d="M449 122.5 H463 V132 H449 Z" fill="#3B3833" stroke="#22201D" stroke-width="1"/>
        <circle cx="456" cy="127.5" r="1.4" fill="#1F1D1A"/>
      </g>
    </svg>
  `;
}

/**
 * Builds a weathered, slightly broken 3-plank timber board with chipped corners,
 * hairline wood splits, subtle natural grain, and forged iron nails.
 */
function buildBrokenWoodBoardSvg(): string {
  return `
    <svg viewBox="0 0 600 184" fill="none" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
      <defs>
        <linearGradient id="gd-plank-a" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#A78A68"/>
          <stop offset="100%" stop-color="#8B7051"/>
        </linearGradient>
        <linearGradient id="gd-plank-b" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#9A7E5D"/>
          <stop offset="100%" stop-color="#7F6447"/>
        </linearGradient>
        <linearGradient id="gd-plank-c" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#8F7353"/>
          <stop offset="100%" stop-color="#745A3F"/>
        </linearGradient>
        <clipPath id="gd-broken-board-shape">
          <!-- Weathered horizontal plank silhouette with chipped top-right notch, left gouge, and broken bottom-left corner -->
          <path d="
            M 6 6
            L 210 5 L 216 9 L 224 5
            L 516 5 L 525 14 L 539 10 L 551 5 L 593 6
            L 596 42 L 592 48 L 596 56 L 595 62
            L 599 65 L 597 104 L 593 111 L 598 118 L 595 125
            L 597 174 L 589 178 L 434 179 L 427 173 L 421 179
            L 84 179 L 74 171 L 63 177 L 52 169 L 36 178 L 7 177
            L 4 128 L 8 124 L 4 119
            L 5 95 L 11 89 L 5 82 L 4 64
            L 7 61 L 4 56 Z
          "/>
        </clipPath>
      </defs>

      <g clip-path="url(#gd-broken-board-shape)">
        <!-- 3 weathered horizontal planks -->
        <rect x="0" y="0" width="600" height="63" fill="url(#gd-plank-a)"/>
        <rect x="0" y="63" width="600" height="62" fill="url(#gd-plank-b)"/>
        <rect x="0" y="125" width="600" height="60" fill="url(#gd-plank-c)"/>

        <!-- Subtle worn bevel highlights & dark underside depth -->
        <path d="M0 7 H600" stroke="#C5AB89" stroke-width="1.6" opacity="0.45"/>
        <path d="M0 176 H600" stroke="#44301E" stroke-width="3" opacity="0.42"/>

        <!-- Plank separation grooves -->
        <path d="M0 63 Q180 62 380 63.5 T600 62.5" stroke="#3B2A1A" stroke-width="2" opacity="0.62"/>
        <path d="M0 65 Q180 64 380 65.5 T600 64.5" stroke="#BFA380" stroke-width="1" opacity="0.28"/>
        <path d="M0 125 Q210 126 420 124.5 T600 125.5" stroke="#3B2A1A" stroke-width="2" opacity="0.62"/>
        <path d="M0 127 Q210 128 420 126.5 T600 127.5" stroke="#BFA380" stroke-width="1" opacity="0.28"/>

        <!-- Subtle aged wood grain fibers (natural, restrained) -->
        <g stroke="#4E3824" stroke-linecap="round" opacity="0.2">
          <path d="M18 14 Q145 12 290 15 T510 13" stroke-width="1.1"/>
          <path d="M35 28 Q190 31 360 27 T580 30" stroke-width="0.9"/>
          <path d="M16 47 Q130 45 275 48 T565 46" stroke-width="1"/>
          <path d="M24 76 Q170 73 330 77 T575 74" stroke-width="1"/>
          <path d="M18 106 Q160 109 340 105 T582 108" stroke-width="0.9"/>
          <path d="M22 141 Q150 139 305 142 T560 140" stroke-width="1.1"/>
          <path d="M40 158 Q200 161 380 156 T570 159" stroke-width="0.9"/>
        </g>

        <!-- Weathered cracks & splinter fissures -->
        <!-- Crack from top-right chipped notch -->
        <path d="M532 11 L524 22 L528 29 L518 39" stroke="#2D2014" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" opacity="0.72"/>
        <path d="M533 11 L525 22" stroke="#C5AB89" stroke-width="0.8" opacity="0.35"/>
        <!-- Crack from bottom-left broken corner -->
        <path d="M52 169 L60 155 L56 146 L65 137" stroke="#2D2014" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" opacity="0.78"/>
        <path d="M53.5 169 L61.5 155" stroke="#BD9F7B" stroke-width="0.8" opacity="0.32"/>
        <!-- Small bottom-right notch split -->
        <path d="M427 173 L431 160 L426 151" stroke="#2D2014" stroke-width="1.5" stroke-linecap="round" opacity="0.65"/>
        <!-- Left edge minor split -->
        <path d="M11 89 L25 91 L34 88" stroke="#2D2014" stroke-width="1.4" stroke-linecap="round" opacity="0.58"/>

        <!-- Outer dark weathered timber border -->
        <path d="
          M 6 6
          L 210 5 L 216 9 L 224 5
          L 516 5 L 525 14 L 539 10 L 551 5 L 593 6
          L 596 42 L 592 48 L 596 56 L 595 62
          L 599 65 L 597 104 L 593 111 L 598 118 L 595 125
          L 597 174 L 589 178 L 434 179 L 427 173 L 421 179
          L 84 179 L 74 171 L 63 177 L 52 169 L 36 178 L 7 177
          L 4 128 L 8 124 L 4 119
          L 5 95 L 11 89 L 5 82 L 4 64
          L 7 61 L 4 56 Z
        " stroke="#362617" stroke-width="2.2" fill="none"/>
      </g>

      <!-- Matte dark forged nails holding the planks -->
      <g fill="#2F2B26" stroke="#1E1B18" stroke-width="0.8">
        <rect x="13" y="13" width="4.2" height="4.2" rx="1"/>
        <rect x="582" y="13" width="4.2" height="4.2" rx="1"/>
        <rect x="13" y="164" width="4.2" height="4.2" rx="1"/>
        <rect x="582" y="164" width="4.2" height="4.2" rx="1"/>
      </g>
    </svg>
  `;
}

/**
 * Creates the weathered, slightly broken hanging wooden-board pixel scenery +
 * time + greeting element displayed on the right side of desktop page headers.
 */
export function createMergedGreetingWidget(now: Date = new Date()): HTMLElement {
  const scenery = getRealTimeScenery(now);
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const greetingCard = document.createElement('div');
  greetingCard.className = `gd-overview-greeting-card phase-${scenery.phase} ${scenery.isDarkScene ? 'is-dark' : 'is-light'}`;

  const hanger = document.createElement('div');
  hanger.className = 'gd-wood-hanger';
  hanger.setAttribute('aria-hidden', 'true');
  hanger.innerHTML = buildWeatheredChainSvg();

  const board = document.createElement('div');
  board.className = 'gd-wood-board';

  const grain = document.createElement('div');
  grain.className = 'gd-wood-grain';
  grain.setAttribute('aria-hidden', 'true');
  grain.innerHTML = buildBrokenWoodBoardSvg();

  const windowEl = document.createElement('div');
  windowEl.className = 'gd-wood-board-window';

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

  windowEl.appendChild(sceneArt);
  windowEl.appendChild(sceneScrim);
  windowEl.appendChild(cardContent);

  board.appendChild(grain);
  board.appendChild(windowEl);

  greetingCard.appendChild(hanger);
  greetingCard.appendChild(board);

  return greetingCard;
}

/**
 * Creates the full-viewport ambient animated pixel diorama:
 * 5-layer GPU parallax world spanning 4 seamlessly connected biomes across screens:
 *   0 (History)  -> Sandstone Viaduct Aqueduct, Bell Clocktower Citadel & Moving Tram
 *   1 (Wards)    -> Misty Hearth Village, Lit Timber Cottages, Chimney Smoke & Docked Boat
 *   2 (Settings) -> Alpine Observatory Ridge, Spinning Windmill & Glass Conservatory
 *   3 (Queue)    -> Twin Waterfall Gorge, Mirror Lake, Arched Footbridge, Lantern & Sailboat
 */
export function createAmbientBackdrop(phase: SceneryPhase, extraClass: string = ''): HTMLElement {
  const layer = document.createElement('div');
  layer.className = `gd-m-ambient phase-${phase}${extraClass ? ` ${extraClass}` : ''}`;
  layer.setAttribute('aria-hidden', 'true');

  const isNight = phase === 'night';
  const isEvening = phase === 'evening';

  const beamWrap = document.createElement('div');
  beamWrap.className = 'gd-m-beam-wrap';
  const beam = document.createElement('div');
  beam.className = 'gd-m-beam';
  beamWrap.appendChild(beam);
  layer.appendChild(beamWrap);

  // 1. Slow parallax Sky Theater (solar/moon halo, layered lit clouds, birds/stars, shooting star, hot air balloon & lanterns)
  const sky = document.createElement('div');
  sky.className = 'gd-m-bg-sky';
  const pCloud = (x: number, y: number, w: number) => `
    <g>
      <rect x="${x + 3}" y="${y}" width="${w - 6}" height="2" fill="var(--sc-cloud-hi)" opacity="0.9"/>
      <rect x="${x + 1}" y="${y + 2}" width="${w - 2}" height="2" fill="var(--sc-cloud-hi)" opacity="0.84"/>
      <rect x="${x}" y="${y + 4}" width="${w}" height="2" fill="var(--sc-cloud-mid)" opacity="0.74"/>
      <rect x="${x + 2}" y="${y + 6}" width="${w - 4}" height="1" fill="var(--sc-cloud-sh)" opacity="0.58"/>
    </g>
  `;
  const celestialBlock = isNight
    ? `
      <!-- Crescent Moon with luminous halo above Mirror Lake -->
      <g opacity="0.94">
        <rect x="276" y="8" width="18" height="15" fill="var(--sc-sun)" opacity="0.12"/>
        <rect x="279" y="10" width="12" height="11" fill="var(--sc-sun)" opacity="0.22"/>
        <rect x="284" y="11" width="6" height="2" fill="var(--sc-sun)"/>
        <rect x="282" y="13" width="4" height="2" fill="var(--sc-sun)"/>
        <rect x="281" y="15" width="3" height="3" fill="var(--sc-sun)"/>
        <rect x="282" y="18" width="4" height="2" fill="var(--sc-sun)"/>
        <rect x="284" y="20" width="6" height="2" fill="var(--sc-sun)"/>
      </g>
      <g class="gd-px-bg-twinkle-a" fill="var(--sc-sun)">
        <rect x="28" y="10" width="1" height="3"/><rect x="27" y="11" width="3" height="1"/>
        <rect x="92" y="7" width="1" height="3"/><rect x="91" y="8" width="3" height="1"/>
        <rect x="164" y="12" width="1" height="3"/><rect x="163" y="13" width="3" height="1"/>
        <rect x="228" y="8" width="1" height="3"/><rect x="227" y="9" width="3" height="1"/>
        <rect x="308" y="9" width="1" height="3"/><rect x="307" y="10" width="3" height="1"/>
      </g>
      <g class="gd-px-bg-twinkle-b" fill="var(--sc-glow)">
        <rect x="56" y="16" width="1" height="1"/><rect x="128" y="14" width="1" height="1"/>
        <rect x="196" y="17" width="1" height="1"/><rect x="256" y="15" width="1" height="1"/>
        <rect x="334" y="14" width="1" height="1"/>
      </g>
      <rect x="242" y="12" width="10" height="1" fill="var(--sc-sun)" class="gd-px-bg-shooting" opacity="0.72"/>
    `
    : `
      <!-- Radiant Layered Sun with warm atmospheric rings -->
      <g>
        <rect x="${isEvening ? 268 : 276}" y="${isEvening ? 22 : 8}" width="26" height="18" fill="var(--sc-sun)" opacity="0.14"/>
        <rect x="${isEvening ? 272 : 280}" y="${isEvening ? 24 : 10}" width="18" height="14" fill="var(--sc-sun)" opacity="0.24"/>
        <rect x="${isEvening ? 276 : 284}" y="${isEvening ? 26 : 12}" width="10" height="10" fill="var(--sc-sun)" opacity="0.72"/>
        <rect x="${isEvening ? 278 : 286}" y="${isEvening ? 27 : 13}" width="6" height="6" fill="var(--sc-glow)" opacity="0.92"/>
      </g>
      <!-- High gliding flock silhouettes -->
      <g class="gd-px-bg-birds" fill="var(--sc-hill-dark)" opacity="0.55">
        <rect x="44" y="18" width="1" height="1"/><rect x="45" y="19" width="2" height="1"/><rect x="47" y="18" width="1" height="1"/>
        <rect x="51" y="15" width="1" height="1"/><rect x="52" y="16" width="2" height="1"/><rect x="54" y="15" width="1" height="1"/>
        <rect x="150" y="14" width="1" height="1"/><rect x="151" y="15" width="2" height="1"/><rect x="153" y="14" width="1" height="1"/>
        <rect x="244" y="17" width="1" height="1"/><rect x="245" y="18" width="2" height="1"/><rect x="247" y="17" width="1" height="1"/>
      </g>
    `;

  sky.innerHTML = `<svg viewBox="0 0 360 72" preserveAspectRatio="xMidYMin slice" shape-rendering="crispEdges">
    ${celestialBlock}
    ${pCloud(18, 24, 24)}
    ${pCloud(86, 16, 20)}
    ${pCloud(146, 28, 28)}
    ${pCloud(212, 18, 22)}
    ${pCloud(296, 26, 24)}
    <!-- Tiny floating hot-air balloon drifting gently over the Wards-Settings ridge -->
    <g class="gd-px-bg-balloon">
      <rect x="134" y="20" width="4" height="1" fill="var(--sc-roof)"/>
      <rect x="133" y="21" width="6" height="3" fill="var(--sc-roof)"/>
      <rect x="134" y="22" width="4" height="1" fill="var(--sc-glow)"/>
      <rect x="134" y="24" width="4" height="1" fill="var(--sc-stone-shade)"/>
      <rect x="135" y="25" width="2" height="1" fill="var(--sc-wood)"/>
      <rect x="135" y="27" width="2" height="1" fill="var(--sc-wood)"/>
    </g>
    <!-- Glowing sky lanterns rising softly over Wards -->
    <g class="gd-px-bg-sky-lanterns">
      <rect x="108" y="34" width="2" height="3" fill="var(--sc-glow)" opacity="0.78"/>
      <rect x="116" y="42" width="2" height="2" fill="var(--sc-sun)" opacity="0.68"/>
      <rect x="124" y="29" width="2" height="3" fill="var(--sc-glow)" opacity="0.74"/>
    </g>
  </svg>`;
  layer.appendChild(sky);

  const cloudSvg = `<svg viewBox="0 0 24 8" shape-rendering="crispEdges"><rect x="6" y="0" width="10" height="2" fill="currentColor"/><rect x="3" y="2" width="17" height="2" fill="currentColor"/><rect x="0" y="4" width="24" height="2" fill="currentColor"/><rect x="2" y="6" width="19" height="2" fill="currentColor" opacity="0.65"/></svg>`;
  [
    { cls: 'c1', top: '17%', w: 96 },
    { cls: 'c2', top: '44%', w: 74 },
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
    { x: 12, y: 22, s: 5, dur: 11, del: -1, dx: 14, dy: -28 },
    { x: 42, y: 58, s: 6, dur: 13, del: -4, dx: -12, dy: -26 },
    { x: 64, y: 34, s: 5, dur: 10, del: -2, dx: 16, dy: -22 },
    { x: 86, y: 66, s: 7, dur: 14, del: -6, dx: -14, dy: -32 },
    { x: 24, y: 74, s: 6, dur: 12, del: -5, dx: 12, dy: -24 },
    { x: 76, y: 78, s: 6, dur: 11, del: -8, dx: -10, dy: -26 },
    { x: 106, y: 62, s: 6, dur: 13, del: -3, dx: 14, dy: -30 },
    { x: 124, y: 72, s: 7, dur: 12, del: -7, dx: -12, dy: -24 },
  ];

  motes.forEach((m, idx) => {
    const el = document.createElement('span');
    el.className = `gd-m-mote ${idx % 2 === 0 ? 'alt' : ''}`;
    el.style.cssText = `left:${m.x}%;top:${m.y}%;width:${m.s}px;height:${m.s}px;--dur:${m.dur}s;--del:${m.del}s;--dx:${m.dx}px;--dy:${m.dy}px;`;
    moteLayer.appendChild(el);
  });
  layer.appendChild(moteLayer);

  // 2. Far multi-toned alpine peaks + canyon cliff + waterfall cascade (slower parallax)
  const far = document.createElement('div');
  far.className = 'gd-m-bg-far';
  far.innerHTML = `<svg viewBox="0 0 480 86" preserveAspectRatio="none" shape-rendering="crispEdges">
    <!-- Far mountain range silhouette with sunlit ridges & shadow faces -->
    <path d="M0 54 H20 V42 H38 V28 H58 V36 H76 V48 H98 V34 H122 V20 H148 V30 H170 V44 H196 V32 H222 V18 H248 V28 H274 V42 H302 V26 H328 V14 H356 V26 H380 V40 H406 V24 H432 V16 H456 V28 H480 V86 H0 Z" fill="var(--sc-far-mid)"/>
    <!-- Sunlit mountain snow/limestone caps -->
    <path d="M38 28 H58 V34 H46 V32 H38 Z M122 20 H148 V28 H134 V24 H122 Z M222 18 H248 V25 H232 V22 H222 Z M328 14 H356 V23 H342 V19 H328 Z M432 16 H456 V24 H444 V20 H432 Z" fill="var(--sc-far-hi)"/>
    <!-- Cool shadow faces -->
    <path d="M52 34 H58 V56 H46 V42 Z M142 26 H148 V58 H134 V38 Z M242 24 H248 V54 H232 V36 Z M348 20 H356 V56 H340 V34 Z M448 22 H456 V56 H442 V36 Z" fill="var(--sc-far-sh)" opacity="0.65"/>
    <!-- Suspended Alpine Gondola cable stretching across Observatory & Peaks -->
    <line x1="210" y1="24" x2="318" y2="34" stroke="var(--sc-hill-dark)" stroke-width="0.7" opacity="0.45"/>
    <g class="gd-px-bg-gondola">
      <rect x="260" y="28" width="1" height="2" fill="var(--sc-hill-dark)"/>
      <rect x="258" y="30" width="5" height="4" fill="var(--sc-roof)"/>
      <rect x="259" y="31" width="3" height="1" fill="var(--sc-glow)"/>
    </g>
    <!-- Far Cathedral Falls spilling down into the Queue gorge -->
    <rect x="422" y="24" width="6" height="44" fill="var(--sc-water-hi)" opacity="0.65"/>
    <rect x="424" y="26" width="2" height="42" fill="#FAF6ED" opacity="0.72" class="gd-px-bg-waterfall"/>
    <!-- Mid-valley atmospheric mist shelf -->
    <rect x="0" y="56" width="480" height="30" fill="var(--sc-far-mist)" opacity="0.55"/>
  </svg>`;
  layer.appendChild(far);

  // Rich pixel tree helper with 2-tone lit crown + shaded base
  const pine = (x: number, y: number, scale: number = 1) => {
    if (scale >= 2) {
      return `
        <rect x="${x}" y="${y - 3}" width="2" height="4" fill="var(--sc-wood)"/>
        <rect x="${x - 4}" y="${y - 6}" width="10" height="3" fill="var(--sc-hill-dark)"/>
        <rect x="${x - 3}" y="${y - 10}" width="8" height="4" fill="var(--sc-hill-mid)"/>
        <rect x="${x - 2}" y="${y - 13}" width="6" height="3" fill="var(--sc-hill-light)"/>
        <rect x="${x - 1}" y="${y - 15}" width="4" height="2" fill="var(--sc-hill-light)"/>
      `;
    }
    return `
      <rect x="${x}" y="${y - 2}" width="1" height="3" fill="var(--sc-wood)"/>
      <rect x="${x - 2}" y="${y - 5}" width="5" height="3" fill="var(--sc-hill-dark)"/>
      <rect x="${x - 1}" y="${y - 8}" width="3" height="3" fill="var(--sc-hill-mid)"/>
      <rect x="${x}" y="${y - 9}" width="1" height="1" fill="var(--sc-hill-light)"/>
    `;
  };

  // 3. Mid-World 4-Biome Panorama (`width: 400%`, exact 1-screen = 160 SVG units per stop)
  const horizon = document.createElement('div');
  horizon.className = 'gd-m-bg-horizon';
  horizon.innerHTML = `<svg viewBox="0 0 640 112" preserveAspectRatio="none" shape-rendering="crispEdges">
    <!-- Layered Continuous Hills spanning 0..640 -->
    <path d="M0 58 H36 V48 H74 V42 H112 V50 H156 V56 H196 V46 H244 V40 H288 V48 H332 V54 H374 V44 H420 V38 H468 V48 H506 V58 H558 V50 H604 V44 H640 V112 H0 Z" fill="var(--sc-hill-mid)"/>
    <path d="M0 68 H44 V60 H92 V56 H148 V64 H202 V58 H260 V54 H316 V62 H372 V56 H430 V52 H486 V62 H534 V68 H588 V60 H640 V112 H0 Z" fill="var(--sc-hill-dark)"/>
    <!-- Continuous winding river / lake floor across the lower valley -->
    <rect x="0" y="78" width="640" height="16" fill="var(--sc-water-deep)"/>
    <rect x="0" y="78" width="640" height="4" fill="var(--sc-water-hi)" opacity="0.72"/>
    <g class="gd-px-water-shimmer" fill="#FAF6ED" opacity="0.38">
      <rect x="34" y="81" width="16" height="1"/><rect x="112" y="84" width="22" height="1"/>
      <rect x="206" y="81" width="18" height="1"/><rect x="292" y="85" width="16" height="1"/>
      <rect x="366" y="82" width="20" height="1"/><rect x="448" y="84" width="16" height="1"/>
      <rect x="526" y="81" width="24" height="1"/><rect x="582" y="85" width="18" height="1"/>
    </g>
    <!-- Far shoreline ground rising cleanly behind bottom dock -->
    <path d="M0 90 H640 V112 H0 Z" fill="var(--sc-fore)"/>

    <!-- BIOME 0 (HISTORY · x = 0..160): Canyon Citadel, Bell Tower & Viaduct Tram -->
    <g class="gd-px-zone-history">
      <rect x="10" y="54" width="142" height="6" fill="var(--sc-stone-light)"/>
      <rect x="10" y="59" width="142" height="2" fill="var(--sc-stone-shade)"/>
      <rect x="16" y="60" width="8" height="20" fill="var(--sc-stone-light)"/>
      <rect x="40" y="60" width="8" height="20" fill="var(--sc-stone-light)"/>
      <rect x="64" y="60" width="8" height="20" fill="var(--sc-stone-light)"/>
      <rect x="88" y="60" width="8" height="20" fill="var(--sc-stone-light)"/>
      <rect x="112" y="60" width="8" height="20" fill="var(--sc-stone-light)"/>
      <rect x="136" y="60" width="8" height="20" fill="var(--sc-stone-light)"/>
      <rect x="24" y="60" width="16" height="3" fill="var(--sc-stone-shade)"/>
      <rect x="48" y="60" width="16" height="3" fill="var(--sc-stone-shade)"/>
      <rect x="96" y="60" width="16" height="3" fill="var(--sc-stone-shade)"/>
      <rect x="120" y="60" width="16" height="3" fill="var(--sc-stone-shade)"/>
      <rect x="66" y="22" width="18" height="34" fill="var(--sc-stone-light)"/>
      <rect x="78" y="22" width="6" height="34" fill="var(--sc-stone-shade)"/>
      <rect x="64" y="18" width="22" height="4" fill="var(--sc-roof)"/>
      <rect x="67" y="14" width="16" height="4" fill="var(--sc-roof)"/>
      <rect x="71" y="9" width="8" height="5" fill="var(--sc-roof)"/>
      <rect x="74" y="5" width="2" height="4" fill="var(--sc-stone-shade)"/>
      <rect x="71" y="27" width="6" height="6" fill="var(--sc-glow)" class="gd-px-lantern-glow"/>
      <rect x="73" y="28" width="2" height="4" fill="var(--sc-hill-dark)"/>
      <rect x="71" y="39" width="4" height="7" fill="var(--sc-glow)" opacity="0.85"/>
      <rect x="84" y="34" width="22" height="20" fill="var(--sc-stone-light)"/>
      <rect x="84" y="31" width="24" height="3" fill="var(--sc-roof)"/>
      <rect x="88" y="39" width="4" height="5" fill="var(--sc-glow)" opacity="0.88"/>
      <rect x="96" y="39" width="4" height="5" fill="var(--sc-glow)" opacity="0.88"/>
      <g class="gd-px-bg-tram">
        <rect x="18" y="48" width="22" height="6" fill="var(--sc-roof)"/>
        <rect x="20" y="47" width="18" height="1" fill="var(--sc-stone-light)"/>
        <rect x="21" y="50" width="3" height="2" fill="var(--sc-glow)"/>
        <rect x="26" y="50" width="3" height="2" fill="var(--sc-glow)"/>
        <rect x="31" y="50" width="3" height="2" fill="var(--sc-glow)"/>
        <rect x="36" y="50" width="2" height="2" fill="var(--sc-glow)"/>
      </g>
      ${pine(12, 54, 2)}${pine(56, 53, 1)}${pine(114, 52, 2)}${pine(142, 53, 1)}
    </g>

    <!-- BIOME 1 (WARDS · x = 160..320): Timber Hearth Cottages, Lantern Harbor & Rising Smoke -->
    <g class="gd-px-zone-wards">
      <rect x="172" y="68" width="136" height="10" fill="var(--sc-stone-shade)" opacity="0.85"/>
      <rect x="172" y="66" width="136" height="2" fill="var(--sc-stone-light)"/>
      <rect x="190" y="42" width="32" height="24" fill="var(--sc-stone-light)"/>
      <rect x="214" y="42" width="8" height="24" fill="var(--sc-stone-shade)"/>
      <rect x="186" y="38" width="40" height="4" fill="var(--sc-roof)"/>
      <rect x="190" y="33" width="32" height="5" fill="var(--sc-roof)"/>
      <rect x="196" y="29" width="20" height="4" fill="var(--sc-roof)"/>
      <rect x="212" y="25" width="4" height="6" fill="var(--sc-stone-shade)"/>
      <g class="gd-px-bg-smoke" fill="#FAF6ED">
        <rect x="213" y="20" width="3" height="3" opacity="0.5"/>
        <rect x="216" y="14" width="4" height="3" opacity="0.34"/>
        <rect x="220" y="8" width="5" height="3" opacity="0.18"/>
      </g>
      <rect x="195" y="47" width="6" height="6" fill="var(--sc-glow)" class="gd-px-lantern-glow"/>
      <rect x="206" y="47" width="6" height="6" fill="var(--sc-glow)" opacity="0.92"/>
      <rect x="201" y="57" width="5" height="9" fill="var(--sc-wood)"/>
      <rect x="238" y="46" width="26" height="20" fill="var(--sc-stone-light)"/>
      <rect x="234" y="42" width="34" height="4" fill="var(--sc-roof)"/>
      <rect x="239" y="37" width="24" height="5" fill="var(--sc-roof)"/>
      <rect x="244" y="50" width="5" height="5" fill="var(--sc-glow)" opacity="0.92"/>
      <rect x="253" y="50" width="5" height="5" fill="var(--sc-glow)" opacity="0.88"/>
      <rect x="274" y="52" width="20" height="16" fill="var(--sc-wood)"/>
      <rect x="272" y="48" width="24" height="4" fill="var(--sc-roof)"/>
      <rect x="280" y="55" width="6" height="5" fill="var(--sc-glow)" class="gd-px-lantern-glow"/>
      <rect x="266" y="75" width="22" height="3" fill="var(--sc-wood)"/>
      <g class="gd-px-bg-boat">
        <rect x="240" y="78" width="16" height="3" fill="var(--sc-wood)"/>
        <rect x="243" y="81" width="10" height="2" fill="var(--sc-stone-shade)"/>
        <rect x="246" y="75" width="2" height="3" fill="var(--sc-glow)"/>
      </g>
      ${pine(174, 64, 2)}${pine(182, 64, 1)}${pine(230, 64, 2)}${pine(302, 64, 2)}${pine(312, 62, 1)}
    </g>

    <!-- BIOME 2 (SETTINGS · x = 320..480): Clockwork Windmill Ridge & Glass Conservatory Dome -->
    <g class="gd-px-zone-settings">
      <rect x="336" y="64" width="128" height="14" fill="var(--sc-stone-shade)" opacity="0.72"/>
      <rect x="336" y="62" width="128" height="2" fill="var(--sc-stone-light)"/>
      <rect x="366" y="28" width="16" height="34" fill="var(--sc-stone-light)"/>
      <rect x="377" y="28" width="5" height="34" fill="var(--sc-stone-shade)"/>
      <rect x="368" y="22" width="12" height="6" fill="var(--sc-roof)"/>
      <rect x="371" y="18" width="6" height="4" fill="var(--sc-roof)"/>
      <rect x="372" y="42" width="4" height="6" fill="var(--sc-glow)" opacity="0.9"/>
      <rect x="372" y="54" width="4" height="8" fill="var(--sc-wood)"/>
      <g class="gd-px-windmill-blades" style="transform-origin: 374px 29px">
        <rect x="373" y="10" width="2" height="38" fill="var(--sc-wood)"/>
        <rect x="355" y="28" width="38" height="2" fill="var(--sc-wood)"/>
        <rect x="375" y="12" width="5" height="12" fill="var(--sc-stone-light)" opacity="0.92"/>
        <rect x="368" y="34" width="5" height="12" fill="var(--sc-stone-light)" opacity="0.92"/>
        <rect x="379" y="30" width="12" height="5" fill="var(--sc-stone-light)" opacity="0.92"/>
        <rect x="357" y="23" width="12" height="5" fill="var(--sc-stone-light)" opacity="0.92"/>
        <rect x="372" y="27" width="4" height="4" fill="var(--sc-glow)"/>
      </g>
      <rect x="404" y="44" width="34" height="18" fill="var(--sc-stone-light)"/>
      <rect x="408" y="34" width="26" height="10" fill="var(--sc-water-hi)" opacity="0.72"/>
      <rect x="412" y="29" width="18" height="5" fill="var(--sc-water-hi)" opacity="0.78"/>
      <rect x="418" y="26" width="6" height="3" fill="var(--sc-hill-dark)"/>
      <rect x="409" y="47" width="5" height="9" fill="var(--sc-glow)" opacity="0.88"/>
      <rect x="418" y="47" width="6" height="9" fill="var(--sc-glow)" opacity="0.92"/>
      <rect x="428" y="47" width="5" height="9" fill="var(--sc-glow)" opacity="0.88"/>
      <rect x="416" y="36" width="10" height="6" fill="var(--sc-glow)" opacity="0.38"/>
      ${pine(344, 60, 2)}${pine(356, 61, 1)}${pine(394, 60, 1)}${pine(448, 60, 2)}${pine(462, 62, 1)}
    </g>

    <!-- BIOME 3 (QUEUE / HOME · x = 480..640): Twin Falls, Sanctuary Bridge, Lantern & Mirror Sailboat -->
    <g class="gd-px-zone-queue">
      <rect x="572" y="44" width="12" height="35" fill="var(--sc-water-hi)" opacity="0.85"/>
      <rect x="575" y="44" width="3" height="35" fill="#FAF6ED" opacity="0.78" class="gd-px-bg-waterfall"/>
      <rect x="580" y="46" width="2" height="33" fill="#FAF6ED" opacity="0.58"/>
      <rect x="568" y="76" width="20" height="3" fill="#FAF6ED" opacity="0.72" class="gd-px-water-shimmer"/>
      <rect x="500" y="50" width="24" height="16" fill="var(--sc-wood)"/>
      <rect x="496" y="46" width="32" height="4" fill="var(--sc-roof)"/>
      <rect x="502" y="41" width="20" height="5" fill="var(--sc-roof)"/>
      <rect x="507" y="54" width="10" height="7" fill="var(--sc-glow)" class="gd-px-lantern-glow"/>
      <rect x="526" y="66" width="42" height="4" fill="var(--sc-wood)"/>
      <rect x="534" y="61" width="26" height="5" fill="var(--sc-wood)"/>
      <rect x="530" y="70" width="3" height="10" fill="var(--sc-wood)"/>
      <rect x="560" y="70" width="3" height="10" fill="var(--sc-wood)"/>
      <rect x="522" y="54" width="2" height="22" fill="var(--sc-hill-dark)"/>
      <rect x="522" y="54" width="5" height="2" fill="var(--sc-hill-dark)"/>
      <rect x="525" y="56" width="3" height="4" fill="var(--sc-glow)" class="gd-px-lantern-glow"/>
      <rect x="525" y="80" width="3" height="8" fill="var(--sc-glow)" opacity="0.28" class="gd-px-water-shimmer"/>
      <g class="gd-px-bg-sailboat">
        <rect x="586" y="77" width="18" height="3" fill="var(--sc-wood)"/>
        <rect x="589" y="80" width="12" height="2" fill="var(--sc-stone-shade)"/>
        <rect x="594" y="62" width="1" height="15" fill="var(--sc-hill-dark)"/>
        <rect x="595" y="63" width="6" height="11" fill="#FAF6ED" opacity="0.92"/>
        <rect x="595" y="66" width="8" height="7" fill="var(--sc-glow)" opacity="0.65"/>
      </g>
      ${pine(488, 66, 2)}${pine(494, 65, 1)}${pine(554, 62, 1)}${pine(608, 63, 2)}${pine(620, 62, 2)}${pine(632, 64, 1)}
    </g>
  </svg>`;
  layer.appendChild(horizon);

  // 4. Foreground Framing Foliage & Riverbank Silhouettes (fastest parallax)
  const fore = document.createElement('div');
  fore.className = 'gd-m-bg-fore';
  fore.innerHTML = `<svg viewBox="0 0 640 32" preserveAspectRatio="none" shape-rendering="crispEdges">
    <path d="M0 20 H34 V16 H72 V22 H120 V17 H168 V21 H218 V16 H268 V22 H316 V17 H368 V21 H420 V16 H472 V22 H524 V17 H578 V21 H616 V16 H640 V32 H0 Z" fill="var(--sc-fore)"/>
    <rect x="14" y="4" width="3" height="18" fill="var(--sc-fore)"/><rect x="8" y="9" width="15" height="5" fill="var(--sc-fore)"/><rect x="11" y="4" width="9" height="5" fill="var(--sc-fore)"/>
    <rect x="156" y="6" width="3" height="16" fill="var(--sc-fore)"/><rect x="150" y="10" width="15" height="5" fill="var(--sc-fore)"/><rect x="153" y="5" width="9" height="5" fill="var(--sc-fore)"/>
    <rect x="314" y="5" width="3" height="17" fill="var(--sc-fore)"/><rect x="308" y="9" width="15" height="5" fill="var(--sc-fore)"/><rect x="311" y="4" width="9" height="5" fill="var(--sc-fore)"/>
    <rect x="472" y="6" width="3" height="16" fill="var(--sc-fore)"/><rect x="466" y="10" width="15" height="5" fill="var(--sc-fore)"/><rect x="469" y="5" width="9" height="5" fill="var(--sc-fore)"/>
    <rect x="618" y="4" width="3" height="18" fill="var(--sc-fore)"/><rect x="612" y="9" width="15" height="5" fill="var(--sc-fore)"/><rect x="615" y="4" width="9" height="5" fill="var(--sc-fore)"/>
    <rect x="46" y="19" width="2" height="2" fill="var(--sc-glow)" opacity="0.8"/>
    <rect x="92" y="18" width="2" height="2" fill="var(--sc-roof)" opacity="0.72"/>
    <rect x="234" y="18" width="2" height="2" fill="var(--sc-glow)" opacity="0.8"/>
    <rect x="394" y="19" width="2" height="2" fill="var(--sc-roof)" opacity="0.72"/>
    <rect x="548" y="18" width="2" height="2" fill="var(--sc-glow)" opacity="0.85"/>
  </svg>`;
  layer.appendChild(fore);

  // Soft parchment readability veil so upper lists & cards stay crisp while lower diorama shines
  const veil = document.createElement('div');
  veil.className = 'gd-m-ambient-veil';
  layer.appendChild(veil);

  return layer;
}
