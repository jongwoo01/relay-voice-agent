from __future__ import annotations

import argparse
import shutil
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps


ICONSET_SPECS = [
    ("icon_16x16.png", 16),
    ("icon_16x16@2x.png", 32),
    ("icon_32x32.png", 32),
    ("icon_32x32@2x.png", 64),
    ("icon_128x128.png", 128),
    ("icon_128x128@2x.png", 256),
    ("icon_256x256.png", 256),
    ("icon_256x256@2x.png", 512),
    ("icon_512x512.png", 512),
    ("icon_512x512@2x.png", 1024),
]

PNG_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
ICO_SIZES = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
MASTER_SIZE = 1024


def create_squircle_mask(size: int, radius: int) -> Image.Image:
    scale = 4
    mask = Image.new("L", (size * scale, size * scale), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, size * scale, size * scale), radius=radius * scale, fill=255)
    return mask.resize((size, size), Image.Resampling.LANCZOS)


def build_master_icon(input_path: Path) -> Image.Image:
    original = Image.open(input_path).convert("RGBA")
    square = Image.new("RGBA", (MASTER_SIZE, MASTER_SIZE), (0, 0, 0, 0))

    fitted = ImageOps.contain(original, (MASTER_SIZE, MASTER_SIZE), Image.Resampling.LANCZOS)
    offset = ((MASTER_SIZE - fitted.width) // 2, (MASTER_SIZE - fitted.height) // 2)
    square.paste(fitted, offset)

    mask_size = int(MASTER_SIZE * 0.81)
    mask = create_squircle_mask(mask_size, radius=int(mask_size * 0.24))
    full_mask = Image.new("L", (MASTER_SIZE, MASTER_SIZE), 0)
    inset = (MASTER_SIZE - mask_size) // 2
    full_mask.paste(mask, (inset, inset))

    final_image = Image.new("RGBA", (MASTER_SIZE, MASTER_SIZE), (0, 0, 0, 0))
    final_image.paste(square, (0, 0), full_mask)
    return final_image


def render_pngs(master: Image.Image, build_dir: Path) -> None:
    master.save(build_dir / "icon.png")
    master.save(build_dir / "icon_1024.png")

    for size in PNG_SIZES[:-1]:
        rendered = master.resize((size, size), Image.Resampling.LANCZOS)
        rendered.save(build_dir / f"icon_{size}.png")


def render_ico(master: Image.Image, build_dir: Path) -> None:
    master.save(build_dir / "icon.ico", format="ICO", sizes=ICO_SIZES)


def render_icns(master: Image.Image, build_dir: Path) -> None:
    iconset_dir = build_dir / "icon.iconset"
    if iconset_dir.exists():
        shutil.rmtree(iconset_dir)
    iconset_dir.mkdir(parents=True, exist_ok=True)

    for filename, size in ICONSET_SPECS:
        rendered = master.resize((size, size), Image.Resampling.LANCZOS)
        rendered.save(iconset_dir / filename)

    subprocess.run(
        ["iconutil", "-c", "icns", str(iconset_dir), "-o", str(build_dir / "icon.icns")],
        check=True,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate Relay desktop app icons.")
    parser.add_argument("input", type=Path, help="Path to the source logo image.")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("apps/desktop/build"),
        help="Directory where generated icon assets will be written.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    input_path = args.input.expanduser().resolve()
    output_dir = args.output_dir.expanduser().resolve()

    if not input_path.exists():
        raise SystemExit(f"Source image not found: {input_path}")

    output_dir.mkdir(parents=True, exist_ok=True)
    master = build_master_icon(input_path)
    render_pngs(master, output_dir)
    render_ico(master, output_dir)
    render_icns(master, output_dir)
    print(f"Updated icons in {output_dir}")


if __name__ == "__main__":
    main()
