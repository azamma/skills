"""Encode motion frames (a folder of PNGs, or a video) into a looping GIF for READMEs and docs.

Usage: uv run --with pillow python gif.py <frames-dir> <out.gif>   (a video input also needs --with imageio --with imageio-ffmpeg)
       [--size 360] [--fps 12] [--src-fps 24] [--colors 128]
One shared palette built from a sample of frames keeps colours stable between frames
(no flicker) and the file small; frames are dropped from --src-fps down to --fps.
"""
import argparse
from pathlib import Path

from PIL import Image


def load_frames(src: Path):
    if src.is_dir():
        return [Image.open(p).convert("RGB") for p in sorted(src.glob("*.png"))]
    import imageio.v3 as iio
    return [Image.fromarray(f).convert("RGB") for f in iio.imiter(src)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("--size", type=int, default=360)
    ap.add_argument("--fps", type=float, default=12)
    ap.add_argument("--src-fps", type=float, default=24)
    ap.add_argument("--colors", type=int, default=128)
    a = ap.parse_args()

    frames = load_frames(a.src)
    if not frames:
        raise SystemExit(f"no frames in {a.src}")
    step = max(1, round(a.src_fps / a.fps))
    frames = [f.resize((a.size, a.size), Image.LANCZOS) for f in frames[::step]]

    sample = frames[:: max(1, len(frames) // 8)]
    sheet = Image.new("RGB", (a.size * len(sample), a.size))
    for i, f in enumerate(sample):
        sheet.paste(f, (i * a.size, 0))
    palette = sheet.quantize(colors=a.colors, method=Image.Quantize.MEDIANCUT)

    gif = [f.quantize(palette=palette, dither=Image.Dither.FLOYDSTEINBERG) for f in frames]
    gif[0].save(a.out, save_all=True, append_images=gif[1:], loop=0,
                duration=round(1000 * step / a.src_fps), optimize=True, disposal=1)
    print(f"{a.out}: {len(gif)} frames, {a.out.stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
