#!/usr/bin/env python3
"""
Generate an animated GIF of a cryptographic pairing code rising character by character from the bottom.
Matches the exact font, font-weight (700 Bold), letter-spacing (0.06em), and cubic-bezier animation
from the Guardrail Chrome extension popup.
Designed for 100% email client compatibility (Gmail, Apple Mail, Outlook).
"""
import sys
import os
import json
from PIL import Image, ImageDraw, ImageFont

def cubic_bezier_y(t, p1x=0.16, p1y=1.0, p2x=0.3, p2y=1.0):
    """Solve cubic-bezier(0.16, 1, 0.3, 1) curve for given progress t in [0, 1]."""
    s = t
    for _ in range(8):
        bx = 3*(1-s)**2 * s * p1x + 3*(1-s) * s**2 * p2x + s**3
        dbx = 3*(1-s)**2 * p1x + 6*(1-s)*s*(p2x - p1x) + 3*s**2 * (1 - p2x)
        diff = bx - t
        if abs(diff) < 1e-5:
            break
        if abs(dbx) > 1e-5:
            s -= diff / dbx
    s = max(0.0, min(1.0, s))
    return 3*(1-s)**2 * s * p1y + 3*(1-s) * s**2 * p2y + s**3

def generate_pairing_code_gif(code_str: str, output_path: str):
    # Ensure code string is clean
    code_str = code_str.strip() or 'GR-INV-U6GA-4WZY'
    chars = list(code_str)
    n = len(chars)

    # Font: Menlo Bold (700) matching --gd-font-mono in extension popup
    font_size = 44  # 2x Retina resolution (renders at ~22px CSS size)
    font_candidates = [
        ('/System/Library/Fonts/Menlo.ttc', 1), # Menlo Bold
        ('/System/Library/Fonts/SFCompactMono.ttf', 0),
        ('/System/Library/Fonts/Monaco.ttf', 0),
        ('/Library/Fonts/Courier New Bold.ttf', 0),
    ]

    font = None
    for fpath, findex in font_candidates:
        if os.path.exists(fpath):
            try:
                font = ImageFont.truetype(fpath, font_size, index=findex)
                break
            except Exception:
                continue

    if font is None:
        font = ImageFont.load_default()

    # Calculate metrics
    dummy = Image.new('RGB', (10, 10))
    d_draw = ImageDraw.Draw(dummy)
    sample_bbox = d_draw.textbbox((0, 0), 'G', font=font)
    char_w = sample_bbox[2] - sample_bbox[0]
    char_h = sample_bbox[3] - sample_bbox[1]
    
    # Letter spacing matching popup: letter-spacing: 0.06em
    letter_spacing = max(2, int(round(font_size * 0.06)))
    slot_w = char_w + letter_spacing
    total_text_w = n * slot_w - letter_spacing

    # Slot height corresponds to 1.3em in CSS (.code-char-wrapper { height: 1.3em; })
    slot_h = int(round(font_size * 1.30))

    # Canvas dimensions (2x Retina)
    width = total_text_w + 48
    height = slot_h + 20
    bg_color = (237, 230, 214)     # #EDE6D6 (Guardrail canvas tone)
    text_color = (39, 49, 33)      # #273121 (var(--gd-deep-olive))

    start_x = (width - total_text_w) // 2
    y_top = (height - slot_h) // 2
    # Baseline vertically centered inside slot
    target_y = y_top + (slot_h - char_h) // 2 - sample_bbox[1]

    # Animation timing exactly matching popup.css:
    # animation: gdCharFromBottom 0.40s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    # step: 40ms stagger per character
    step = 0.040        # 40ms stagger per character
    char_duration = 0.40 # 0.40s duration per character
    dt = 0.040          # 25 fps
    initial_pause = 0.08 # 80ms initial pause

    total_anim_time = initial_pause + (n - 1) * step + char_duration
    num_frames = int(round(total_anim_time / dt))

    frames = []
    durations = []

    for frame_idx in range(num_frames):
        t_curr = frame_idx * dt
        img = Image.new('RGB', (width, height), bg_color)
        draw = ImageDraw.Draw(img)

        for i, ch in enumerate(chars):
            t_start = initial_pause + i * step
            t_char = t_curr - t_start
            x = start_x + i * slot_w

            if t_char < 0:
                continue
            elif t_char >= char_duration:
                # Fully landed in slot
                draw.text((x, target_y), ch, fill=text_color, font=font)
            else:
                tau = t_char / char_duration
                progress = cubic_bezier_y(tau)

                # translateY(120%) from bottom of slot
                max_offset = int(round(slot_h * 1.20))
                y_offset = int(round(max_offset * (1.0 - progress)))

                # Opacity: 0% -> 0.0, 60% -> 1.0 (matching @keyframes gdCharFromBottom)
                alpha = min(1.0, tau / 0.60)
                col = (
                    int(bg_color[0] + (text_color[0] - bg_color[0]) * alpha),
                    int(bg_color[1] + (text_color[1] - bg_color[1]) * alpha),
                    int(bg_color[2] + (text_color[2] - bg_color[2]) * alpha),
                )

                # Slot-clipped drawing (overflow: hidden; height: 1.3em)
                char_img = Image.new('RGB', (slot_w, slot_h), bg_color)
                char_draw = ImageDraw.Draw(char_img)
                rel_target_y = target_y - y_top + y_offset
                char_draw.text((0, rel_target_y), ch, fill=col, font=font)
                img.paste(char_img, (x, y_top))

        frames.append(img)
        durations.append(40)

    # Final hold frame: hold complete code in place for 3.5 seconds
    durations[-1] = 3500

    # Save optimized animated GIF
    p_frames = [f.quantize(colors=64, method=Image.Resampling.LANCZOS) for f in frames]
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    p_frames[0].save(
        output_path,
        save_all=True,
        append_images=p_frames[1:],
        duration=durations,
        loop=0,
        optimize=True
    )
    
    meta = {
        'width': width,
        'height': height,
        'cssWidth': width // 2,
        'cssHeight': height // 2,
        'sizeBytes': os.path.getsize(output_path),
        'frames': len(frames),
    }
    print(json.dumps(meta))

if __name__ == '__main__':
    code = sys.argv[1] if len(sys.argv) > 1 else 'GR-INV-U6GA-4WZY'
    out = sys.argv[2] if len(sys.argv) > 2 else '/tmp/test_code.gif'
    generate_pairing_code_gif(code, out)
