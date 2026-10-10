"""Isolate the unobstructed 60 fps contact pattern from the user's reference.
Source frames are extracted into output/noise-contact-pattern-review/source.
Only a web derivative is written; the supplied recording is never changed.
"""
from pathlib import Path
import json
import numpy as np
from PIL import Image, ImageFilter

root = Path(__file__).resolve().parents[1]
frames = sorted((root / 'output/noise-contact-pattern-review/source').glob('*.png'))
if len(frames) != 72:
    raise RuntimeError('Expected consecutive reference frames 60 through 131')
centers = []
for path in frames:
    a = np.asarray(Image.open(path).convert('RGB').filter(ImageFilter.GaussianBlur(8))).astype(float)
    yy, xx = np.indices(a.shape[:2])
    weight = np.maximum(a[:, :, 0] - 175, 0)
    weight[(xx < 100) | (xx > 410) | (yy < 90) | (yy > 390)] = 0
    centers.append([float((xx * weight).sum() / weight.sum()), float((yy * weight).sum() / weight.sum())])
centers = np.array(centers)
smooth = np.array([np.median(centers[max(0, i-3):min(len(centers), i+4)], axis=0) for i in range(len(centers))])
tile, pad, columns = 192, 2, 8
cell = tile + pad * 2
atlas = Image.new('RGB', (cell * columns, cell * 9))
yy, xx = np.indices((350, 350))
distance = np.hypot(xx - 174.5, yy - 174.5)
vignette = np.clip((174 - distance) / 22, 0, 1)
vignette = vignette * vignette * (3 - 2 * vignette)
for index, path in enumerate(frames):
    cx, cy = smooth[index]
    crop = Image.open(path).convert('RGB').crop((round(cx)-175, round(cy)-175, round(cx)+175, round(cy)+175))
    a = np.asarray(crop).astype(float)
    background = np.median(a[(distance > 149) & (distance < 172)], axis=0)
    emission = np.maximum(a - background - np.array([7, 3, 3]), 0)
    envelope = np.asarray(Image.fromarray(np.uint8(emission[:, :, 0])).filter(ImageFilter.GaussianBlur(5))).astype(float)
    gate = np.clip((envelope - 8) / 27, 0, 1)
    gate = gate * gate * (3 - 2 * gate) * vignette
    emission[:, :, 0] *= 1.34
    emission[:, :, 1:] *= .92
    emission[:, :, 0] = np.maximum(emission[:, :, 0], np.max(emission[:, :, 1:], axis=2))
    emission *= gate[:, :, None]
    image = Image.fromarray(np.uint8(np.clip(emission, 0, 255))).resize((tile, tile), Image.Resampling.LANCZOS)
    atlas.paste(image, (index % columns * cell + pad, index // columns * cell + pad))
destination = root / 'apps/web/public/effects/noise-domain/contact-atlas.webp'
atlas.save(destination, lossless=True, method=6)
metadata = {'frames': len(frames), 'fps': 60, 'tile': tile, 'padding': pad, 'columns': columns, 'rows': 9, 'centers': smooth.round(2).tolist()}
(root / 'output/noise-contact-pattern-review/extraction.json').write_text(json.dumps(metadata, indent=2), encoding='utf-8')
print(json.dumps({'frames': len(frames), 'atlasSize': atlas.size, 'bytes': destination.stat().st_size}))
