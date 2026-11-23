#!/usr/bin/env python3
"""
Generate an animated GIF of a QR code with the exact optical scanner and viewfinder animation
from the Guardrail Chrome extension popup.
- Optical viewfinder reticles locking into place
- Staggered snap-in for the 3 corner finder targets
- Green luminous optical laser sweep with data matrix reveal wipe
- Ready confirmation pulse
- Settle permanently on the scannable final frame (plays once, no infinite loop)
"""
import sys
import os
import subprocess
import json
from PIL import Image, ImageDraw

def cubic_bezier_y(t, p1x=0.16, p1y=1.0, p2x=0.3, p2y=1.0):
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

def gd_eye_snap(tau):
    if tau <= 0.70:
        p = tau / 0.70
        return 0.4 + (1.08 - 0.4) * cubic_bezier_y(p)
    else:
        p = (tau - 0.70) / 0.30
        return 1.08 + (1.0 - 1.08) * p

def generate_qr_gif(url: str, output_path: str):
    url = url.strip() or 'https://guardrail.app'

    # Resolve qrcode library path (prefer lightweight core to avoid loading heavy pngjs)
    ext_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../extension/node_modules/qrcode'))
    if not os.path.exists(ext_dir):
        ext_dir = os.path.abspath(os.path.join(os.getcwd(), 'guardrail/extension/node_modules/qrcode'))

    core_js = os.path.join(ext_dir, 'lib/core/qrcode.js')
    target_require = core_js if os.path.exists(core_js) else ext_dir

    cmd = ['node', '-e', f"""
const QRCode = require('{target_require}');
const qr = QRCode.create('{url}', {{ errorCorrectionLevel: 'M' }});
const matrix = [];
for (let r = 0; r < qr.modules.size; r++) {{
  const row = [];
  for (let c = 0; c < qr.modules.size; c++) {{
    row.push(qr.modules.get(r, c) ? 1 : 0);
  }}
  matrix.push(row);
}}
console.log(JSON.stringify(matrix));
"""]

    try:
        matrix = json.loads(subprocess.check_output(cmd).decode('utf-8'))
    except Exception as e:
        print(f"Error generating QR matrix: {e}", file=sys.stderr)
        return

    qr_size = len(matrix)

    # 2x Retina dimensions: 280x280 (140x140 in CSS)
    W = 280
    H = 280

    bg_card = (250, 246, 237)       # #FAF6ED
    border_box = (205, 196, 176)    # #CDC4B0
    dark_mod = (39, 49, 33)         # #273121
    green_reticle = (85, 119, 63)   # #55773F
    laser_core = (226, 247, 202)    # #E2F7CA
    laser_glow = (132, 175, 96)     # #84AF60

    qr_margin = 22
    matrix_w = W - 2 * qr_margin
    mod_size = matrix_w / qr_size

    tl_mods = []
    tr_mods = []
    bl_mods = []
    data_mods = []

    for r in range(qr_size):
        for c in range(qr_size):
            if matrix[r][c]:
                x0 = qr_margin + c * mod_size
                y0 = qr_margin + r * mod_size
                x1 = x0 + mod_size + 0.5
                y1 = y0 + mod_size + 0.5
                item = (r, c, x0, y0, x1, y1)

                if r < 7 and c < 7:
                    tl_mods.append(item)
                elif r < 7 and c >= qr_size - 7:
                    tr_mods.append(item)
                elif r >= qr_size - 7 and c < 7:
                    bl_mods.append(item)
                else:
                    data_mods.append(item)

    tl_center = (qr_margin + 3.5 * mod_size, qr_margin + 3.5 * mod_size)
    tr_center = (qr_margin + (qr_size - 3.5) * mod_size, qr_margin + 3.5 * mod_size)
    bl_center = (qr_margin + 3.5 * mod_size, qr_margin + (qr_size - 3.5) * mod_size)

    def draw_reticles(draw, cur_scale, alpha):
        col = (
            int(bg_card[0] + (green_reticle[0] - bg_card[0]) * alpha),
            int(bg_card[1] + (green_reticle[1] - bg_card[1]) * alpha),
            int(bg_card[2] + (green_reticle[2] - bg_card[2]) * alpha),
        )
        arm = int(round(18 * cur_scale))
        thick = 4
        inset = 8
        draw.line([(inset, inset), (inset + arm, inset)], fill=col, width=thick)
        draw.line([(inset, inset), (inset, inset + arm)], fill=col, width=thick)
        draw.line([(W - inset, inset), (W - inset - arm, inset)], fill=col, width=thick)
        draw.line([(W - inset, inset), (W - inset, inset + arm)], fill=col, width=thick)
        draw.line([(inset, H - inset), (inset + arm, H - inset)], fill=col, width=thick)
        draw.line([(inset, H - inset), (inset, H - inset - arm)], fill=col, width=thick)
        draw.line([(W - inset, H - inset), (W - inset - arm, H - inset)], fill=col, width=thick)
        draw.line([(W - inset, H - inset), (W - inset, H - inset - arm)], fill=col, width=thick)

    def draw_eye(draw, eye_mods, center, cur_scale, alpha):
        col = (
            int(bg_card[0] + (dark_mod[0] - bg_card[0]) * alpha),
            int(bg_card[1] + (dark_mod[1] - bg_card[1]) * alpha),
            int(bg_card[2] + (dark_mod[2] - bg_card[2]) * alpha),
        )
        cx, cy = center
        for (r, c, x0, y0, x1, y1) in eye_mods:
            sx0 = cx + (x0 - cx) * cur_scale
            sy0 = cy + (y0 - cy) * cur_scale
            sx1 = cx + (x1 - cx) * cur_scale
            sy1 = cy + (y1 - cy) * cur_scale
            draw.rectangle([sx0, sy0, sx1, sy1], fill=col)

    dt = 0.033 # 30 fps
    num_frames = 44 # ~1.45s

    frames = []

    for f_idx in range(num_frames):
        t = f_idx * dt
        img = Image.new('RGB', (W, H), bg_card)
        draw = ImageDraw.Draw(img)

        draw.rounded_rectangle([2, 2, W - 2, H - 2], radius=16, outline=border_box, width=2)

        # 1. Viewfinders
        if t < 0.25:
            p_ret = t / 0.25
            scale_ret = 1.45 - 0.45 * cubic_bezier_y(p_ret)
            alpha_ret = p_ret * 0.9
            draw_reticles(draw, scale_ret, alpha_ret)
        else:
            draw_reticles(draw, 1.0, 0.9)

        # 2. Finder Eyes
        if t >= 0.12:
            tau_tl = min(1.0, (t - 0.12) / 0.23)
            scale_tl = gd_eye_snap(tau_tl)
            alpha_tl = min(1.0, tau_tl / 0.6)
            draw_eye(draw, tl_mods, tl_center, scale_tl, alpha_tl)

        if t >= 0.22:
            tau_tr = min(1.0, (t - 0.22) / 0.23)
            scale_tr = gd_eye_snap(tau_tr)
            alpha_tr = min(1.0, tau_tr / 0.6)
            draw_eye(draw, tr_mods, tr_center, scale_tr, alpha_tr)

        if t >= 0.32:
            tau_bl = min(1.0, (t - 0.32) / 0.23)
            scale_bl = gd_eye_snap(tau_bl)
            alpha_bl = min(1.0, tau_bl / 0.6)
            draw_eye(draw, bl_mods, bl_center, scale_bl, alpha_bl)

        # 3. Laser Sweep & Matrix Reveal
        laser_start_t = 0.48
        laser_dur = 0.70

        if t < laser_start_t:
            pass
        elif t < laser_start_t + laser_dur:
            tau_l = (t - laser_start_t) / laser_dur
            p_laser = cubic_bezier_y(tau_l, 0.35, 0.0, 0.25, 1.0)
            laser_y = qr_margin + p_laser * matrix_w

            for (r, c, x0, y0, x1, y1) in data_mods:
                if y0 <= laser_y:
                    draw.rectangle([x0, y0, x1, y1], fill=dark_mod)

            glow_h = 16
            for gy in range(int(max(qr_margin, laser_y - glow_h)), int(laser_y)):
                g_alpha = (gy - (laser_y - glow_h)) / glow_h * 0.4
                g_col = (
                    int(bg_card[0] + (laser_glow[0] - bg_card[0]) * g_alpha),
                    int(bg_card[1] + (laser_glow[1] - bg_card[1]) * g_alpha),
                    int(bg_card[2] + (laser_glow[2] - bg_card[2]) * g_alpha),
                )
                draw.line([(qr_margin, gy), (W - qr_margin, gy)], fill=g_col, width=1)

            draw.line([(qr_margin - 4, int(laser_y)), (W - qr_margin + 4, int(laser_y))], fill=green_reticle, width=3)
            draw.line([(qr_margin + 10, int(laser_y)), (W - qr_margin - 10, int(laser_y))], fill=laser_core, width=2)
        else:
            for (r, c, x0, y0, x1, y1) in data_mods:
                draw.rectangle([x0, y0, x1, y1], fill=dark_mod)

            # Ready pulse
            pulse_tau = min(1.0, (t - (laser_start_t + laser_dur)) / 0.22)
            if pulse_tau < 1.0:
                pulse_alpha = (1.0 - pulse_tau) * 0.7
                pulse_col = (
                    int(border_box[0] + (green_reticle[0] - border_box[0]) * pulse_alpha),
                    int(border_box[1] + (green_reticle[1] - border_box[1]) * pulse_alpha),
                    int(border_box[2] + (green_reticle[2] - border_box[2]) * pulse_alpha),
                )
                draw.rounded_rectangle([2, 2, W - 2, H - 2], radius=16, outline=pulse_col, width=3)

        frames.append(img)

    # Master palette to eliminate all jitter/flicker
    comp = Image.new('RGB', (W * 3, H))
    comp.paste(frames[0], (0, 0))
    comp.paste(frames[len(frames)//2], (W, 0))
    comp.paste(frames[-1], (W * 2, 0))
    master_pal = comp.quantize(colors=128, method=Image.Quantize.MAXCOVERAGE)

    p_frames = [f.quantize(palette=master_pal, dither=Image.Dither.NONE) for f in frames]

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    durations = [33] * len(p_frames)
    durations[-1] = 100

    # Save WITHOUT loop (plays once and stays on final scannable frame)
    p_frames[0].save(
        output_path,
        save_all=True,
        append_images=p_frames[1:],
        duration=durations,
        optimize=False
    )

    meta = {
        'width': W,
        'height': H,
        'cssWidth': W // 2,
        'cssHeight': H // 2,
        'sizeBytes': os.path.getsize(output_path),
        'frames': len(p_frames),
    }
    print(json.dumps(meta))

if __name__ == '__main__':
    url = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:5173/?invite=GR-INV-U6GA-4WZY'
    out = sys.argv[2] if len(sys.argv) > 2 else '/tmp/test_qr_script.gif'
    generate_qr_gif(url, out)
