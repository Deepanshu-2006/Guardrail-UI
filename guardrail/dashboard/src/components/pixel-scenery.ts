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

function pixelPine(x: number, baseY: number, height: number, fill: string, trunkFill: string): string {
  const parts: string[] = [];
  parts.push(rect(x, baseY - 2, 1, 2, trunkFill));
  const layers = Math.max(2, Math.floor((height - 2) / 2));
  for (let i = 0; i < layers; i++) {
    const w = 1 + i * 2;
    const lx = x - i;
    const ly = baseY - height + i * 2;
    parts.push(rect(lx, ly, w, 2, fill));
  }
  return parts.join('');
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
    rect(72, 14, 6, 1, '#F7D47A'),
    rect(70, 15, 10, 2, '#F5C45E'),
    rect(69, 17, 12, 4, '#EAA844'),
    // stepped rays
    rect(74, 11, 2, 1, '#F7D47A'),
    rect(66, 16, 2, 1, '#F7D47A'),
    rect(82, 16, 2, 1, '#F7D47A'),
    rect(68, 13, 1, 1, '#F7D47A'),
    rect(81, 13, 1, 1, '#F7D47A'),
  ].join('');

  const clouds = [
    pixelCloud(46, 5, '#FAF6EC', '#E3DEC8'),
    pixelCloud(64, 8, '#FAF6EC', '#E5DEC7'),
  ].join('');

  const birds = [
    rect(57, 13, 1, 1, '#3B4834'),
    rect(59, 13, 1, 1, '#3B4834'),
    rect(58, 14, 1, 1, '#3B4834'),
    rect(62, 11, 1, 1, '#3B4834'),
    rect(64, 11, 1, 1, '#3B4834'),
    rect(63, 12, 1, 1, '#3B4834'),
  ].join('');

  const farHills = [
    rect(0, 24, 96, 10, '#859674'),
    rect(12, 22, 26, 2, '#859674'),
    rect(18, 20, 14, 2, '#859674'),
    rect(50, 21, 24, 3, '#859674'),
    rect(56, 19, 12, 2, '#859674'),
    rect(80, 22, 16, 2, '#859674'),
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
    pixelPine(68, 30, 7, '#1F2B19', '#161F12'),
    pixelPine(75, 30, 9, '#23301D', '#161F12'),
    pixelPine(83, 30, 6, '#1F2B19', '#161F12'),
    pixelPine(90, 30, 8, '#23301D', '#161F12'),
  ].join('');

  return `<svg viewBox="0 0 96 34" preserveAspectRatio="xMidYMid slice" shape-rendering="crispEdges" aria-hidden="true">${sky}${sun}${clouds}${birds}${farHills}${midHills}${foreGround}</svg>`;
}

function buildAfternoonSvg(): string {
  const sky = [
    rect(0, 0, 96, 8, '#94B0A4'),
    rect(0, 8, 96, 8, '#AFC4B5'),
    rect(0, 16, 96, 8, '#CBDBC8'),
    rect(0, 24, 96, 10, '#E3E3CE'),
  ].join('');

  const sun = [
    rect(76, 4, 4, 1, '#F5D46B'),
    rect(75, 5, 6, 4, '#F0C24D'),
    rect(76, 9, 4, 1, '#F5D46B'),
  ].join('');

  const clouds = [
    pixelCloud(44, 6, '#FAF8F1', '#DCE3D5'),
    pixelCloud(60, 11, '#FAF8F1', '#DCE3D5'),
    pixelCloud(82, 13, '#FAF8F1', '#DCE3D5'),
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
    pixelPine(70, 30, 8, '#1B2716', '#131C0F'),
    pixelPine(78, 30, 6, '#212F1B', '#131C0F'),
    pixelPine(86, 30, 9, '#1B2716', '#131C0F'),
  ].join('');

  return `<svg viewBox="0 0 96 34" preserveAspectRatio="xMidYMid slice" shape-rendering="crispEdges" aria-hidden="true">${sky}${sun}${clouds}${farHills}${midHills}${foreGround}</svg>`;
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
    rect(72, 17, 6, 1, '#F6D16D'),
    rect(70, 18, 10, 5, '#F0B34D'),
  ].join('');

  const clouds = [
    pixelCloud(48, 7, '#8E5854', '#603B3D'),
    pixelCloud(66, 10, '#C27453', '#8E5144'),
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
    pixelPine(64, 27, 7, '#121811', '#0D120C'),
    pixelPine(79, 27, 8, '#121811', '#0D120C'),
    pixelPine(88, 27, 6, '#121811', '#0D120C'),
    // tiny warm cabin silhouette & lit window
    rect(71, 24, 5, 3, '#141913'),
    rect(70, 23, 7, 1, '#0E120D'),
    rect(73, 25, 2, 1, '#F6BF58'),
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
    // twinkling 1x1 stars
    rect(46, 4, 1, 1, '#EDE6D6'),
    rect(53, 8, 1, 1, '#9EB09E'),
    rect(61, 3, 1, 1, '#EDE6D6'),
    rect(66, 11, 1, 1, '#9EB09E'),
    rect(72, 6, 1, 1, '#EDE6D6'),
    rect(87, 5, 1, 1, '#9EB09E'),
    rect(90, 13, 1, 1, '#EDE6D6'),
    rect(57, 14, 1, 1, '#9EB09E'),
    // 3x3 cross star
    rect(49, 11, 3, 1, '#EDE6D6'),
    rect(50, 10, 1, 3, '#EDE6D6'),
    // 3x3 cross star 2
    rect(84, 10, 3, 1, '#D5DEC9'),
    rect(85, 9, 1, 3, '#D5DEC9'),
  ].join('');

  const moon = [
    rect(77, 4, 4, 1, '#F3EBD6'),
    rect(76, 5, 3, 1, '#F3EBD6'),
    rect(76, 6, 2, 3, '#F3EBD6'),
    rect(76, 9, 3, 1, '#F3EBD6'),
    rect(77, 10, 4, 1, '#D8CEB4'),
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
    pixelPine(63, 27, 7, '#090E0B', '#070A08'),
    pixelPine(77, 27, 9, '#090E0B', '#070A08'),
    pixelPine(86, 27, 6, '#090E0B', '#070A08'),
    pixelPine(91, 27, 8, '#090E0B', '#070A08'),
    // tiny warm cabin window glow
    rect(69, 24, 5, 3, '#131A15'),
    rect(68, 23, 7, 1, '#0A0F0C'),
    rect(71, 25, 2, 1, '#EBB04E'),
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
