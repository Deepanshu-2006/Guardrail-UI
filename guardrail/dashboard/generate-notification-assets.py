import os
import subprocess
from PIL import Image

ICONS_DIR = os.path.join(os.path.dirname(__file__), 'icons')
os.makedirs(ICONS_DIR, exist_ok=True)

# 1. Generate High-Res 512x512 Icon SVG
svg_icon = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <!-- Background Gradient: Deep Forest Olive to Obsidian -->
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#24301F"/>
      <stop offset="100%" stop-color="#141B11"/>
    </linearGradient>

    <!-- Sleek Glass Edge Highlight -->
    <linearGradient id="rimGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="rgba(255, 255, 255, 0.32)"/>
      <stop offset="50%" stop-color="rgba(255, 255, 255, 0.08)"/>
      <stop offset="100%" stop-color="rgba(0, 0, 0, 0.5)"/>
    </linearGradient>

    <!-- Inner Core Pill Gradient -->
    <linearGradient id="pillGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#2D3B26"/>
      <stop offset="100%" stop-color="#1B2317"/>
    </linearGradient>

    <!-- Subtle Radial Glow behind emblem -->
    <radialGradient id="haloGrad" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="rgba(74, 222, 128, 0.16)"/>
      <stop offset="100%" stop-color="rgba(74, 222, 128, 0)"/>
    </radialGradient>
  </defs>

  <!-- Squircle Base with smooth corners -->
  <rect x="20" y="20" width="472" height="472" rx="112" fill="url(#bgGrad)"/>
  <rect x="20" y="20" width="472" height="472" rx="112" fill="url(#haloGrad)"/>
  <rect x="20" y="20" width="472" height="472" rx="112" fill="none" stroke="url(#rimGrad)" stroke-width="5"/>

  <!-- Top Protective Guardrail Bracket -->
  <path d="M 104 200 V 142 C 104 112 128 88 158 88 H 354 C 384 88 408 112 408 142 V 200" 
        stroke="#FAF6ED" stroke-width="26" stroke-linecap="round" stroke-linejoin="round" fill="none"/>

  <!-- Bottom Protective Guardrail Bracket -->
  <path d="M 104 312 V 370 C 104 400 128 424 158 424 H 354 C 384 424 408 400 408 370 V 312" 
        stroke="#FAF6ED" stroke-width="26" stroke-linecap="round" stroke-linejoin="round" fill="none"/>

  <!-- Core Security Shield / Staging Pill -->
  <rect x="136" y="184" width="240" height="144" rx="72" fill="url(#pillGrad)" stroke="#FAF6ED" stroke-width="9"/>

  <!-- Intercepted Safety Symbol (x) with rounded caps -->
  <path d="M 226 230 L 270 274 M 270 230 L 226 274" 
        stroke="#FAF6ED" stroke-width="20" stroke-linecap="round"/>

  <!-- Pointer Cursor arriving at boundary with emerald indicator -->
  <path d="M 328 232 L 418 322 L 376 334 L 400 386 L 376 398 L 352 346 L 318 376 Z" 
        fill="#FAF6ED" stroke="#141B11" stroke-width="12" stroke-linejoin="round"/>
  <circle cx="338" cy="242" r="9" fill="#4ADE80"/>
</svg>"""

tmp_svg = os.path.join(ICONS_DIR, 'tmp-icon.svg')
tmp_512 = os.path.join(ICONS_DIR, 'tmp-icon-512.png')

with open(tmp_svg, 'w') as f:
    f.write(svg_icon)

subprocess.run(['sips', '-s', 'format', 'png', tmp_svg, '--out', tmp_512], check=True)

img_512 = Image.open(tmp_512)

# Generate multi-scale notification icons
sizes = {
    'icon-128.png': (128, 128),
    'icon-192.png': (192, 192),
    'icon-48.png': (48, 48),
    'icon-16.png': (16, 16),
}

for filename, size in sizes.items():
    resized = img_512.resize(size, Image.Resampling.LANCZOS)
    target_path = os.path.join(ICONS_DIR, filename)
    resized.save(target_path, 'PNG', optimize=True)
    print(f"Generated {filename} ({size[0]}x{size[1]})")

# 2. Generate Rich Alert Preview Banner (640x320)
svg_banner = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 320" width="640" height="320">
  <defs>
    <linearGradient id="cardBg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1F2A1B"/>
      <stop offset="50%" stop-color="#161E13"/>
      <stop offset="100%" stop-color="#0E140C"/>
    </linearGradient>
    <linearGradient id="cardBorder" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="rgba(255, 255, 255, 0.22)"/>
      <stop offset="100%" stop-color="rgba(74, 222, 128, 0.15)"/>
    </linearGradient>
    <radialGradient id="glow" cx="20%" cy="30%" r="60%">
      <stop offset="0%" stop-color="rgba(74, 222, 128, 0.14)"/>
      <stop offset="100%" stop-color="rgba(0, 0, 0, 0)"/>
    </radialGradient>
  </defs>

  <!-- Background -->
  <rect x="0" y="0" width="640" height="320" rx="24" fill="url(#cardBg)"/>
  <rect x="0" y="0" width="640" height="320" rx="24" fill="url(#glow)"/>
  <rect x="1.5" y="1.5" width="637" height="317" rx="22.5" fill="none" stroke="url(#cardBorder)" stroke-width="3"/>

  <!-- Brand Eyebrow -->
  <text x="50" y="70" font-family="-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Space Grotesk', sans-serif" font-size="13" font-weight="700" letter-spacing="2.5" fill="#86EFAC">GUARDRAIL SECURITY • STAGING INTERCEPTION</text>

  <!-- Alert Title -->
  <text x="50" y="125" font-family="-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Space Grotesk', sans-serif" font-size="28" font-weight="800" fill="#FAF6ED" letter-spacing="-0.5">High-Risk Browser Action Held</text>

  <!-- Description Body -->
  <text x="50" y="175" font-family="-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif" font-size="16" fill="#D6CEBE" font-weight="500">Ward Alice paused on a high-risk financial transfer.</text>
  <text x="50" y="202" font-family="-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif" font-size="14.5" fill="#A89E8D">Separation of Duties active • Zero remote control • Consent required.</text>

  <!-- Status Chip -->
  <g transform="translate(50, 240)">
    <rect width="180" height="38" rx="19" fill="rgba(74, 222, 128, 0.15)" stroke="rgba(74, 222, 128, 0.35)" stroke-width="1.5"/>
    <circle cx="22" cy="19" r="5" fill="#4ADE80"/>
    <text x="36" y="24" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="13" font-weight="700" fill="#86EFAC" letter-spacing="0.5">AWAITING DECISION</text>
  </g>

  <!-- Mini Emblem on Right -->
  <g transform="translate(480, 80) scale(0.24)">
    <rect x="20" y="20" width="472" height="472" rx="112" fill="#24301F" stroke="#FAF6ED" stroke-width="8"/>
    <path d="M 104 200 V 142 C 104 112 128 88 158 88 H 354 C 384 88 408 112 408 142 V 200" stroke="#FAF6ED" stroke-width="26" stroke-linecap="round" fill="none"/>
    <path d="M 104 312 V 370 C 104 400 128 424 158 424 H 354 C 384 424 408 400 408 370 V 312" stroke="#FAF6ED" stroke-width="26" stroke-linecap="round" fill="none"/>
    <rect x="136" y="184" width="240" height="144" rx="72" fill="#1B2317" stroke="#FAF6ED" stroke-width="9"/>
    <path d="M 226 230 L 270 274 M 270 230 L 226 274" stroke="#FAF6ED" stroke-width="20" stroke-linecap="round"/>
  </g>
</svg>"""

tmp_banner_svg = os.path.join(ICONS_DIR, 'tmp-banner.svg')
banner_path = os.path.join(ICONS_DIR, 'alert-preview.png')

with open(tmp_banner_svg, 'w') as f:
    f.write(svg_banner)

subprocess.run(['sips', '-s', 'format', 'png', tmp_banner_svg, '--out', banner_path], check=True)
print("Generated alert-preview.png (640x320)")

# Cleanup temporary SVGs
for p in [tmp_svg, tmp_512, tmp_banner_svg]:
    if os.path.exists(p):
        os.remove(p)

print("All notification visual assets successfully generated!")
