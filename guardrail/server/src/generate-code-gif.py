#!/usr/bin/env python3
"""
Generate an animated GIF of a cryptographic pairing code rising character by character from the bottom
inside segmented rounded boxes separated by dashes (e.g. [ GR ] - [ INV ] - [ U6GA ] - [ 4WZY ]).
Matches the exact font (Menlo Bold 700), colors, and cubic-bezier easing from Guardrail.
Plays once when the user opens the email and settles permanently on the final frame (no infinite repeating).
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
    code_str = code_str.strip() or 'GR-INV-U6GA-4WZY'
    
    if '-' in code_str:
        segments = [s.strip() for s in code_str.split('-') if s.strip()]
    else:
        chunk_size = 4 if len(code_str) >= 8 else 3
        segments = [code_str[i:i+chunk_size] for i in range(0, len(code_str), chunk_size)]
        
    if not segments:
        segments = ['GR', 'INV', 'U6GA', '4WZY']

    # 2x supersampling for subpixel anti-aliasing (2x of Retina = 4x total)
    w_out, h_out = 520, 76
    scale = 2
    w_render = w_out * scale
    h_render = h_out * scale

    # Font: Menlo Bold (700) matching --gd-font-mono in extension popup
    font_candidates = [
        ('/System/Library/Fonts/Menlo.ttc', 1), # macOS Menlo Bold
        ('/System/Library/Fonts/SFCompactMono.ttf', 0),
        ('/System/Library/Fonts/Monaco.ttf', 0),
        ('/Library/Fonts/Courier New Bold.ttf', 0),
    ]

    font_render = None
    for fpath, findex in font_candidates:
        if os.path.exists(fpath):
            try:
                font_render = ImageFont.truetype(fpath, 34 * scale, index=findex)
                break
            except Exception:
                continue

    if font_render is None:
        font_render = ImageFont.load_default()

    # Guardrail palette
    bg_canvas = (237, 230, 214)     # #EDE6D6 (canvas tone)
    box_bg = (250, 246, 237)        # #FAF6ED (card tone)
    box_border = (205, 196, 176)    # #CDC4B0 (subtle warm border)
    text_color = (39, 49, 33)       # #273121 (var(--gd-deep-olive))
    dash_color = (130, 140, 120)    # #828C78 (muted dash)

    dummy = Image.new('RGB', (10, 10))
    d_draw = ImageDraw.Draw(dummy)
    sample_bbox = d_draw.textbbox((0, 0), 'G', font=font_render)
    char_w = sample_bbox[2] - sample_bbox[0]
    char_h = sample_bbox[3] - sample_bbox[1]
    spacing = 3 * scale

    seg_widths = []
    for s in segments:
        sw = len(s) * (char_w + spacing) - spacing + 24 * scale
        seg_widths.append(sw)

    gap = 24 * scale
    total_content_w = sum(seg_widths) + (len(segments) - 1) * gap
    start_x = (w_render - total_content_w) // 2
    box_h = 56 * scale
    box_y = (h_render - box_h) // 2

    # Base static image with canvas, boxes, and hyphens
    base_img = Image.new('RGB', (w_render, h_render), bg_canvas)
    base_draw = ImageDraw.Draw(base_img)

    cur_x = start_x
    boxes = []
    char_items = []

    for seg_idx, s in enumerate(segments):
        sw = seg_widths[seg_idx]
        box_rect = [cur_x, box_y, cur_x + sw, box_y + box_h]
        boxes.append(box_rect)
        base_draw.rounded_rectangle(box_rect, radius=10 * scale, fill=box_bg, outline=box_border, width=2 * scale)

        text_w = len(s) * (char_w + spacing) - spacing
        tx = cur_x + (sw - text_w) // 2
        ty = box_y + (box_h - char_h) // 2 - sample_bbox[1]

        for ch_idx, ch in enumerate(s):
            char_items.append({
                'char': ch,
                'target_x': tx + ch_idx * (char_w + spacing),
                'target_y': ty,
                'box_idx': seg_idx,
                'box_rect': box_rect,
            })

        cur_x += sw
        if seg_idx < len(segments) - 1:
            dash_x = cur_x + gap // 2 - 6 * scale
            dash_y = box_y + box_h // 2
            base_draw.line([(dash_x, dash_y), (dash_x + 12 * scale, dash_y)], fill=dash_color, width=3 * scale)
            cur_x += gap

    # Animation timeline:
    # 30 fps (dt = 0.033s), smooth character stagger
    dt = 0.033
    step = 0.045
    char_dur = 0.38
    initial_pause = 0.04

    total_time = initial_pause + len(char_items) * step + char_dur
    num_frames = int(round(total_time / dt))

    rendered_frames = []

    for f_idx in range(num_frames):
        t_curr = f_idx * dt
        f_img = base_img.copy()

        for b_idx, box_rect in enumerate(boxes):
            b_w = box_rect[2] - box_rect[0]
            b_h = box_rect[3] - box_rect[1]

            box_chars = [c for c in char_items if c['box_idx'] == b_idx]
            box_char_img = Image.new('RGB', (b_w, b_h), box_bg)
            box_char_draw = ImageDraw.Draw(box_char_img)

            any_drawn = False
            for c in box_chars:
                idx = char_items.index(c)
                t_start = initial_pause + idx * step
                t_char = t_curr - t_start

                rel_x = c['target_x'] - box_rect[0]
                rel_y = c['target_y'] - box_rect[1]

                if t_char < 0:
                    continue
                elif t_char >= char_dur:
                    box_char_draw.text((rel_x, rel_y), c['char'], fill=text_color, font=font_render)
                    any_drawn = True
                else:
                    tau = t_char / char_dur
                    p = cubic_bezier_y(tau)
                    max_offset = int(round(box_h * 1.10))
                    y_off = max_offset * (1.0 - p)
                    alpha = min(1.0, tau / 0.50)

                    col = (
                        int(box_bg[0] + (text_color[0] - box_bg[0]) * alpha),
                        int(box_bg[1] + (text_color[1] - box_bg[1]) * alpha),
                        int(box_bg[2] + (text_color[2] - box_bg[2]) * alpha),
                    )
                    box_char_draw.text((rel_x, int(round(rel_y + y_off))), c['char'], fill=col, font=font_render)
                    any_drawn = True

            if any_drawn:
                mask = Image.new('L', (b_w, b_h), 0)
                mask_draw = ImageDraw.Draw(mask)
                mask_draw.rounded_rectangle([2*scale, 2*scale, b_w - 2*scale, b_h - 2*scale], radius=8*scale, fill=255)
                f_img.paste(box_char_img, (box_rect[0], box_rect[1]), mask)

        # Supersampled downscaling for ultra-smooth subpixel edges
        down_f = f_img.resize((w_out, h_out), Image.Resampling.LANCZOS)
        rendered_frames.append(down_f)

    # Global palette shared across ALL frames to guarantee 0% flicker/jitter
    comp = Image.new('RGB', (w_out * 3, h_out))
    comp.paste(rendered_frames[0], (0, 0))
    comp.paste(rendered_frames[len(rendered_frames)//2], (w_out, 0))
    comp.paste(rendered_frames[-1], (w_out * 2, 0))
    master_palette = comp.quantize(colors=128, method=Image.Quantize.MAXCOVERAGE)

    # Quantize every frame with the fixed global palette
    p_frames = [f.quantize(palette=master_palette, dither=Image.Dither.NONE) for f in rendered_frames]

    # Save WITHOUT loop parameter so animation plays ONCE and stops on final frame
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    durations = [33] * len(p_frames)
    durations[-1] = 100

    p_frames[0].save(
        output_path,
        save_all=True,
        append_images=p_frames[1:],
        duration=durations,
        optimize=False
    )

    meta = {
        'width': w_out,
        'height': h_out,
        'cssWidth': w_out // 2,
        'cssHeight': h_out // 2,
        'sizeBytes': os.path.getsize(output_path),
        'frames': len(p_frames),
    }
    print(json.dumps(meta))

if __name__ == '__main__':
    code = sys.argv[1] if len(sys.argv) > 1 else 'GR-INV-U6GA-4WZY'
    out = sys.argv[2] if len(sys.argv) > 2 else '/tmp/test_segmented_code.gif'
    generate_pairing_code_gif(code, out)
