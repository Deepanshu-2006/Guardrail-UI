import os
import subprocess
from PIL import Image

ICONS_DIR = os.path.join(os.path.dirname(__file__), 'icons')
os.makedirs(ICONS_DIR, exist_ok=True)

# Exact Guardrail Brand Logo (Deep Olive #273121 + Warm Ivory #EDE6D6)
brand_svg = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="512" height="512">
  <!-- Deep Olive Brand Base (#273121) with Apple Squircle Radius -->
  <rect x="2" y="2" width="96" height="96" rx="22" fill="#273121"/>
  <rect x="2" y="2" width="96" height="96" rx="22" fill="none" stroke="rgba(237, 230, 214, 0.15)" stroke-width="1.5"/>

  <!-- Top Protective Guardrail Bracket (#EDE6D6) -->
  <path d="M 16 38 V 26 C 16 19 21 14 28 14 H 72 C 79 14 84 19 84 26 V 38" 
        stroke="#EDE6D6" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>

  <!-- Bottom Protective Guardrail Bracket (#EDE6D6) -->
  <path d="M 16 62 V 74 C 16 81 21 86 28 86 H 72 C 79 86 84 81 84 74 V 62" 
        stroke="#EDE6D6" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>

  <!-- Protected Core Pill Button (#EDE6D6) -->
  <rect x="22" y="34" width="56" height="32" rx="16" fill="#EDE6D6"/>

  <!-- Intercepted Safety Mark (x) (#273121) -->
  <path d="M 43 45 L 53 55 M 53 45 L 43 55" 
        stroke="#273121" stroke-width="4.5" stroke-linecap="round"/>

  <!-- Pointer Cursor arriving at boundary (#273121 fill, #EDE6D6 stroke) -->
  <path d="M 64 45 L 82 63 L 73.5 65.5 L 78.5 76 L 73.5 78.5 L 68.5 68 L 61.5 74 Z" 
        fill="#273121" stroke="#EDE6D6" stroke-width="3" stroke-linejoin="round"/>
</svg>"""

tmp_svg = os.path.join(ICONS_DIR, 'tmp-brand.svg')
tmp_512 = os.path.join(ICONS_DIR, 'tmp-brand-512.png')

with open(tmp_svg, 'w') as f:
    f.write(brand_svg)

subprocess.run(['sips', '-s', 'format', 'png', tmp_svg, '--out', tmp_512], check=True)

img_512 = Image.open(tmp_512)

sizes = {
    'icon-192.png': (192, 192),
    'icon-128.png': (128, 128),
    'icon-48.png': (48, 48),
    'icon-16.png': (16, 16),
}

for filename, size in sizes.items():
    resized = img_512.resize(size, Image.Resampling.LANCZOS)
    target_path = os.path.join(ICONS_DIR, filename)
    resized.save(target_path, 'PNG', optimize=True)
    print(f"Generated {filename} ({size[0]}x{size[1]})")

# Clean up
for p in [tmp_svg, tmp_512, os.path.join(ICONS_DIR, 'alert-preview.png')]:
    if os.path.exists(p):
        os.remove(p)

print("Exact brand icons successfully generated!")
