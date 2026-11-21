#!/usr/bin/env python3
"""
Generate an animated GIF of a cryptographic pairing code rising character by character from the bottom.
Designed for 100% email client compatibility (Gmail, Apple Mail, Outlook).
"""
import sys
import os
from PIL import Image, ImageDraw, ImageFont

def generate_pairing_code_gif(code_str: str, output_path: str):
    # Dimensions (2x for Retina sharpness)
    width = 760
    height = 96
    bg_color = (237, 230, 214)     # #EDE6D6
    text_color = (39, 49, 33)      # #273121
    dash_color = (130, 150, 115)   # #829673
    
    # Font
    font_path = '/System/Library/Fonts/Menlo.ttc'
    if not os.path.exists(font_path):
        font_path = '/System/Library/Fonts/Monaco.ttf'
    font = ImageFont.truetype(font_path, 42)
    
    chars = list(code_str)
    n = len(chars)
    
    # Calculate character layout
    dummy_img = Image.new('RGB', (width, height), bg_color)
    draw = ImageDraw.Draw(dummy_img)
    
    char_widths = []
    for ch in chars:
        bbox = draw.textbbox((0, 0), ch, font=font)
        w = bbox[2] - bbox[0]
        char_widths.append(w)
    
    spacing = 8  # letter spacing in 2x
    total_w = sum(char_widths) + (n - 1) * spacing
    start_x = (width - total_w) // 2
    target_y = (height - 46) // 2
    
    # Compute base positions
    x_positions = []
    curr_x = start_x
    for w in char_widths:
        x_positions.append(curr_x)
        curr_x += w + spacing
        
    frames = []
    durations = []
    
    # Animation phases:
    # Each character takes 2 micro-frames to rise from bottom (offset +22px -> offset +8px -> 0px)
    # Then final frame holds for 3.2 seconds
    
    # Initial empty frame
    f0 = Image.new('RGB', (width, height), bg_color)
    frames.append(f0)
    durations.append(80)
    
    for i in range(n):
        # Frame A: character i is halfway up (+14px)
        img_a = Image.new('RGB', (width, height), bg_color)
        draw_a = ImageDraw.Draw(img_a)
        for j in range(i):
            col = dash_color if chars[j] == '-' else text_color
            draw_a.text((x_positions[j], target_y), chars[j], fill=col, font=font)
        # Rising char
        col_i = dash_color if chars[i] == '-' else text_color
        draw_a.text((x_positions[i], target_y + 16), chars[i], fill=col_i, font=font)
        frames.append(img_a)
        durations.append(45)
        
        # Frame B: character i lands in place (+0px)
        img_b = Image.new('RGB', (width, height), bg_color)
        draw_b = ImageDraw.Draw(img_b)
        for j in range(i + 1):
            col = dash_color if chars[j] == '-' else text_color
            draw_b.text((x_positions[j], target_y), chars[j], fill=col, font=font)
        frames.append(img_b)
        durations.append(50)
        
    # Final hold frame: All characters in place for 3.5 seconds
    durations[-1] = 3500
    
    # Save as animated GIF with palette optimization
    # Convert frames to 'P' mode (quantize)
    p_frames = [f.quantize(colors=64, method=Image.Resampling.LANCZOS) for f in frames]
    p_frames[0].save(
        output_path,
        save_all=True,
        append_images=p_frames[1:],
        duration=durations,
        loop=0,
        optimize=True
    )
    print(f"Generated GIF {output_path} ({os.path.getsize(output_path)} bytes)")

if __name__ == '__main__':
    code = sys.argv[1] if len(sys.argv) > 1 else 'GR-INV-DJTU-M6TR'
    out = sys.argv[2] if len(sys.argv) > 2 else 'scratch/test_code.gif'
    generate_pairing_code_gif(code, out)
