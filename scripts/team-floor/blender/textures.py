"""Procedural, tileable textures for the office (numpy, deterministic seeds). Original work.

Every function returns a (h, w, 4) float array in sRGB display encoding, ready for
common.save_rgb_image(). Sizes are powers of two so the glTF exporter can write WebP.
"""

import numpy as np


def _periodic_noise(size, cells, rng, octaves=4, persistence=0.5, stretch=(1, 1)):
    """Tileable value noise (bilinear on a periodic lattice) in 0..1. `stretch` scales the
    lattice per axis (x, y) for anisotropic grain."""
    h, w = size
    out = np.zeros((h, w), np.float32)
    amp = 1.0
    total = 0.0
    for o in range(octaves):
        cx = max(1, int(cells[0] * (2 ** o) * stretch[0]))
        cy = max(1, int(cells[1] * (2 ** o) * stretch[1]))
        lattice = rng.random((cy, cx)).astype(np.float32)
        ys = np.linspace(0, cy, h, endpoint=False)
        xs = np.linspace(0, cx, w, endpoint=False)
        y0 = np.floor(ys).astype(int)
        x0 = np.floor(xs).astype(int)
        fy = (ys - y0)[:, None]
        fx = (xs - x0)[None, :]
        fy = fy * fy * (3 - 2 * fy)
        fx = fx * fx * (3 - 2 * fx)
        y1 = (y0 + 1) % cy
        x1 = (x0 + 1) % cx
        a = lattice[y0][:, x0]
        b = lattice[y0][:, x1]
        c = lattice[y1][:, x0]
        d = lattice[y1][:, x1]
        layer = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy
        out += layer * amp
        total += amp
        amp *= persistence
    return out / total


def _rgb(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)], np.float32)


def planks(size=1024, tile_m=2.4, plank_w=0.2, base='#b98458', dark='#8a5a36', light='#d1a074', seed=7, gap='#5c3a22', min_len=0.9, max_len=1.9, grain=1.0):
    """Wood floor planks running along u (image x). Tileable in both directions."""
    rng = np.random.default_rng(seed)
    h = w = size
    px_per_m = size / tile_m
    rows = int(round(tile_m / plank_w))
    row_h = h / rows
    img = np.zeros((h, w, 3), np.float32)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    row = np.floor(yy / row_h).astype(int)
    v_in = (yy - row * row_h) / row_h  # 0..1 across the plank width

    base_c, dark_c, light_c, gap_c = _rgb(base), _rgb(dark), _rgb(light), _rgb(gap)
    plank_id = np.zeros((h, w), np.int32)
    u_in = np.zeros((h, w), np.float32)
    joints = np.zeros((h, w), bool)
    for r in range(rows):
        # Joint positions along the row (wrapping at the tile length).
        cuts = []
        x = rng.uniform(0, max_len) * px_per_m
        while len(cuts) == 0 or x < w + cuts[0]:
            cuts.append(x)
            x += rng.uniform(min_len, max_len) * px_per_m
        cuts = np.array(cuts) % w
        cuts.sort()
        mask = row == r
        xr = xx[mask]
        idx = np.searchsorted(cuts, xr, side='right')
        start = np.where(idx == 0, cuts[-1] - w, cuts[np.maximum(idx - 1, 0)])
        end = np.where(idx == len(cuts), cuts[0] + w, cuts[np.minimum(idx, len(cuts) - 1)])
        plank_id[mask] = r * 1000 + (idx % len(cuts))
        u_in[mask] = (xr - start) / np.maximum(1.0, end - start)
        joints[mask] = (np.minimum(xr - start, end - xr) < 1.3)

    # Per-plank tone and hue jitter.
    ids = np.unique(plank_id)
    tone = {i: rng.uniform(-1, 1) for i in ids}
    tone_map = np.vectorize(tone.get)(plank_id).astype(np.float32)

    # Grain: long stretched noise plus fine streaks, phase-shifted per plank.
    n1 = _periodic_noise((h, w), (2, rows * 2), rng, octaves=5, stretch=(1, 4))
    n2 = _periodic_noise((h, w), (6, rows * 10), rng, octaves=3, stretch=(1, 3))
    streak = 0.5 + 0.5 * np.sin((v_in * 9.0 + n1 * 7.0 + tone_map * 3.0) * np.pi)
    fine = _periodic_noise((h, w), (64, 512), rng, octaves=2)
    g = np.clip(0.55 * streak + 0.45 * n2, 0, 1) ** 1.6 * grain

    col = base_c[None, None, :] * (1 + 0.075 * tone_map[..., None])
    col = col * (1 - g[..., None]) + dark_c[None, None, :] * g[..., None] * 0.9 + col * g[..., None] * 0.1
    highlight = np.clip(n1 - 0.62, 0, 1)[..., None] * 1.6
    col = col * (1 - highlight * 0.35) + light_c[None, None, :] * highlight * 0.35
    col *= (0.96 + 0.08 * fine[..., None])
    # Edge bevel: slightly darker near plank long edges, dark gap lines.
    edge = np.clip(1 - np.minimum(v_in, 1 - v_in) * row_h / 2.2, 0, 1)
    col = col * (1 - 0.18 * edge[..., None])
    gap_mask = (np.minimum(v_in, 1 - v_in) * row_h < 0.9) | joints
    col[gap_mask] = col[gap_mask] * 0.45 + gap_c * 0.55
    img = np.clip(col, 0, 1)
    return _rgba(img)


def carpet(size=256, base='#8d97a2', seed=11):
    rng = np.random.default_rng(seed)
    n = _periodic_noise((size, size), (4, 4), rng, octaves=3)
    fine = rng.random((size, size)).astype(np.float32)
    loops = _periodic_noise((size, size), (64, 64), rng, octaves=1)
    c = _rgb(base)[None, None, :] * (0.92 + 0.12 * n[..., None]) * (0.94 + 0.08 * fine[..., None]) * (0.96 + 0.06 * loops[..., None])
    return _rgba(np.clip(c, 0, 1))


def rug(size=512, base='#7b828b', border='#d7d2c8', inner='#5f666e', seed=5):
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32) / size
    d = np.minimum(np.minimum(xx, 1 - xx), np.minimum(yy, 1 - yy))
    c = np.ones((size, size, 3), np.float32) * _rgb(base)
    band = (d > 0.045) & (d < 0.075)
    c[band] = _rgb(border)
    band2 = (d > 0.1) & (d < 0.112)
    c[band2] = _rgb(inner)
    weave = _periodic_noise((size, size), (128, 128), rng, octaves=1)
    n = _periodic_noise((size, size), (6, 6), rng, octaves=3)
    c *= (0.9 + 0.12 * weave[..., None]) * (0.95 + 0.08 * n[..., None])
    return _rgba(np.clip(c, 0, 1))


def stone(size=256, base='#c9c6c0', grout='#a19d96', tiles=2, seed=3):
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    cell = size / tiles
    gx = np.minimum(xx % cell, cell - xx % cell)
    gy = np.minimum(yy % cell, cell - yy % cell)
    n = _periodic_noise((size, size), (5, 5), rng, octaves=4)
    tid = (np.floor(xx / cell) + np.floor(yy / cell) * tiles).astype(int)
    tone = rng.uniform(-1, 1, tiles * tiles)[tid]
    c = _rgb(base)[None, None, :] * (0.93 + 0.1 * n[..., None] + 0.03 * tone[..., None])
    g = (np.minimum(gx, gy) < 1.6)
    c[g] = _rgb(grout)
    return _rgba(np.clip(c, 0, 1))


def _rgba(rgb):
    h, w, _ = rgb.shape
    out = np.ones((h, w, 4), np.float32)
    out[..., :3] = rgb
    # Blender images are stored bottom-up.
    return out[::-1].copy()
