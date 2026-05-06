#!/usr/bin/env python3
"""
Upscale every map's tile pyramid from z=4 to z=5 using Real-ESRGAN on the GPU box.

For each texture in assets/maps/tiles/<TexName>/4/, this script:

  1. Stitches the existing 16x16 z=4 tiles into one 4096x4096 PNG
  2. scp's it to the GPU box
  3. ssh's the GPU box to run `realesrgan-ncnn-vulkan -s 4` on it
  4. scp's the 16384x16384 result back
  5. Resizes 16384 -> 8192 (Lanczos) and slices into 32x32 = 1024 z=5 tiles
  6. Cleans up the giant intermediate PNG (controllable via --keep-intermediates)

Skips any texture that already has a complete z=5 directory (1024 tiles).

Usage:
  python3 scripts/upscale_tiles_to_z5.py                  # all textures
  python3 scripts/upscale_tiles_to_z5.py T_AlBasrah_Minimap Anvil_Minimap   # specific
  python3 scripts/upscale_tiles_to_z5.py --dry-run        # plan only
  python3 scripts/upscale_tiles_to_z5.py --gpu-host user@gpu-box.example  # override
  SQUADMAPS_GPU_HOST=user@gpu-box.example python3 scripts/upscale_tiles_to_z5.py
"""

import argparse
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

from PIL import Image
Image.MAX_IMAGE_PIXELS = None  # the 16384^2 PNG trips the bomb check

REPO = Path(__file__).resolve().parent.parent
TILES_ROOT = REPO / 'assets' / 'maps' / 'tiles'
CACHE_ROOT = REPO / 'scripts' / 'upscale_cache'
DEFAULT_GPU_HOST = os.environ.get('SQUADMAPS_GPU_HOST')  # set this or pass --gpu-host
GPU_WORKDIR = '~/squad'
GPU_BINARY = './realesrgan-ncnn-vulkan'
GPU_MODEL = 'realesrgan-x4plus'
TILE = 256


def stitched_z4_path(texname):
    return CACHE_ROOT / f'{texname}_z4.png'


def upscaled_path(texname):
    return CACHE_ROOT / f'{texname}_z5_4x.png'


def discover_textures():
    return sorted(d.name for d in TILES_ROOT.iterdir() if d.is_dir())


def has_complete_z5(texname):
    z5 = TILES_ROOT / texname / '5'
    if not z5.is_dir():
        return False
    expected = 32 * 32
    actual = sum(1 for _ in z5.rglob('*.png'))
    return actual >= expected


def has_complete_z4(texname):
    z4 = TILES_ROOT / texname / '4'
    if not z4.is_dir():
        return False
    expected = 16 * 16
    actual = sum(1 for _ in z4.rglob('*.png'))
    return actual >= expected


def stitch_z4(texname):
    out = stitched_z4_path(texname)
    if out.exists():
        return out
    z4 = TILES_ROOT / texname / '4'
    img = Image.new('RGB', (4096, 4096))
    missing = 0
    for x in range(16):
        for y in range(16):
            tile_path = z4 / str(x) / f'{y}.png'
            if tile_path.exists():
                img.paste(Image.open(tile_path), (x * 256, y * 256))
            else:
                missing += 1
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, optimize=False)
    if missing:
        print(f'    WARN: {missing}/256 z=4 tiles missing, stitched anyway')
    return out


def scp_to(host, src, dst):
    cmd = ['scp', '-q', str(src), f'{host}:{dst}']
    subprocess.run(cmd, check=True)


def scp_from(host, src, dst):
    cmd = ['scp', '-q', f'{host}:{src}', str(dst)]
    subprocess.run(cmd, check=True)


def ssh_run(host, cmd):
    full = ['ssh', host, cmd]
    return subprocess.run(full, check=True, capture_output=True, text=True)


def gpu_upscale(host, texname):
    """Run Real-ESRGAN x4 on the GPU box and return the local path of the result."""
    in_name = f'{texname}_z4.png'
    out_name = f'{texname}_z5_4x.png'
    cmd = (f'cd {GPU_WORKDIR} && '
           f'{GPU_BINARY} -i {in_name} -o {out_name} '
           f'-n {GPU_MODEL} -s 4 2>&1 | tail -3 && '
           f'ls -lh {out_name}')
    result = ssh_run(host, cmd)
    print(f'    gpu: {result.stdout.strip().splitlines()[-1] if result.stdout else ""}')


def slice_z5(texname, src_4x_path):
    """Resize 16384 -> 8192 and slice into 32x32 z=5 tiles."""
    out_dir = TILES_ROOT / texname / '5'
    out_dir.mkdir(parents=True, exist_ok=True)

    img = Image.open(src_4x_path)
    if img.size != (8192, 8192):
        img = img.resize((8192, 8192), Image.LANCZOS)

    n = 32
    for x in range(n):
        xdir = out_dir / str(x)
        xdir.mkdir(exist_ok=True)
        for y in range(n):
            tile = img.crop((x * TILE, y * TILE, (x + 1) * TILE, (y + 1) * TILE))
            tile.save(xdir / f'{y}.png', optimize=True)


def process_one(texname, host, keep_intermediates, dry_run):
    if not has_complete_z4(texname):
        print(f'  [{texname}] SKIP: no complete z=4 pyramid')
        return False
    if has_complete_z5(texname):
        print(f'  [{texname}] SKIP: z=5 already exists (1024 tiles)')
        return True

    print(f'  [{texname}] processing...')
    if dry_run:
        return True

    started = time.time()
    try:
        # 1. Stitch
        t0 = time.time()
        src = stitch_z4(texname)
        print(f'    stitch: {time.time() - t0:.1f}s -> {src.name}')

        # 2. scp source to GPU box
        t0 = time.time()
        scp_to(host, src, f'{GPU_WORKDIR}/{src.name}')
        print(f'    scp ->: {time.time() - t0:.1f}s')

        # 3. Real-ESRGAN
        t0 = time.time()
        gpu_upscale(host, texname)
        print(f'    upscale: {time.time() - t0:.1f}s')

        # 4. scp result back
        t0 = time.time()
        local_4x = upscaled_path(texname)
        scp_from(host, f'{GPU_WORKDIR}/{local_4x.name}', local_4x)
        print(f'    scp <-: {time.time() - t0:.1f}s')

        # 5. Resize + slice
        t0 = time.time()
        slice_z5(texname, local_4x)
        print(f'    slice: {time.time() - t0:.1f}s')

        # 6. Cleanup intermediates
        if not keep_intermediates:
            for p in (src, local_4x):
                p.unlink(missing_ok=True)
            print(f'    cleanup: removed intermediates')

        # 7. Cleanup remote intermediates too
        ssh_run(host, f'cd {GPU_WORKDIR} && rm -f {src.name} {local_4x.name}')

        elapsed = time.time() - started
        z5_size_mb = sum((p.stat().st_size for p in (TILES_ROOT / texname / '5').rglob('*.png'))) / 1024 / 1024
        print(f'  [{texname}] DONE in {elapsed:.0f}s — {z5_size_mb:.1f} MB z=5 tiles')
        return True
    except subprocess.CalledProcessError as e:
        print(f'  [{texname}] FAIL: subprocess error: {e}')
        if e.stderr:
            print(f'    stderr: {e.stderr}')
        return False
    except Exception as e:
        print(f'  [{texname}] FAIL: {e}')
        return False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('textures', nargs='*', help='Specific texture names (default: all)')
    parser.add_argument('--gpu-host', default=DEFAULT_GPU_HOST,
                        help='GPU box ssh target (or set $SQUADMAPS_GPU_HOST)')
    parser.add_argument('--keep-intermediates', action='store_true', help="Don't delete the giant 16384 PNG after slicing")
    parser.add_argument('--dry-run', action='store_true', help='List what would be processed without doing it')
    args = parser.parse_args()

    if not args.gpu_host:
        parser.error('GPU host required: pass --gpu-host or set $SQUADMAPS_GPU_HOST')
    textures = args.textures or discover_textures()
    print(f'Targets: {len(textures)} texture(s) — gpu={args.gpu_host}')

    ok = fail = skip = 0
    for tex in textures:
        result = process_one(tex, args.gpu_host, args.keep_intermediates, args.dry_run)
        if result is True:
            ok += 1
        else:
            fail += 1

    print()
    print(f'=== Done: {ok} ok, {fail} failed ===')
    return 0 if fail == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
