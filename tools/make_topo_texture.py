"""Build the topographic Earth textures used by the globe.

Input:  img/earth-topology.png  (grayscale elevation, 0 = sea level/ocean)
        img/earth-water.png     (white = water)
Output: img/earth-winter.jpg    (--theme winter, the default: snow and ice blues)
        img/earth-topo.jpg      (--theme summer: classic green/brown topo map)

Each map is built in layers:
  1. Elevation tints: land colored by height.
  2. Snow cover (winter only): the snowline drops the farther you are from the
     equator, so the Alps, Rockies and Scandinavia are white while the tropics
     only have snow on the highest peaks.
  3. Hillshading: light from the north-west so slopes read as 3D relief.
  4. Contour lines: thin lines at fixed elevation steps, every 4th one darker.
  5. Ocean: lighter near coasts, plus sea ice near the poles in winter, and a
     faint 15° latitude/longitude grid.

Run from the repo root:
    python3 tools/make_topo_texture.py                  # winter
    python3 tools/make_topo_texture.py --theme summer
Needs: Pillow and NumPy.
"""

import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
IMG = ROOT / "img"
W, H = 4096, 2048  # output size (equirectangular: 360° x 180°)


def hexrgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float32)


# Every color the map uses, per theme. Stops are (elevation 0..1, color).
THEMES = {
    "winter": {
        "out": "earth-winter.jpg",
        "land": [
            (0.00, "#8aa1b1"),  # snow-free lowlands: cold steel blue-gray
            (0.15, "#7e97a9"),
            (0.35, "#6f8a9f"),  # bare upland rock
            (0.60, "#647f95"),
            (1.00, "#9fb4c4"),
        ],
        "snow": "#f8fbfe",
        "ice": [(0.0, "#e9f2f8"), (1.0, "#ffffff")],
        "shadow": "#41617f",     # shaded slopes turn blue, not gray
        "contour": "#4f7394",
        "ocean": [(0.0, "#24507a"), (0.5, "#4579a3"), (1.0, "#93c3da")],
        "sea_ice": "#dbe9f2",
        "coast": "#1b3550",
        "snow_cover": True,
    },
    "summer": {
        "out": "earth-topo.jpg",
        "land": [
            (0.00, "#7fa66a"),  # coastal lowland green
            (0.10, "#a9c483"),
            (0.22, "#dfd9a0"),  # tan uplands
            (0.36, "#cfa877"),
            (0.52, "#a87c58"),  # brown mountains
            (0.62, "#8c7a6e"),  # bare rock
            (0.76, "#d9d6d2"),  # high peaks, snow-dusted
            (1.00, "#ffffff"),
        ],
        "snow": "#ffffff",
        "ice": [(0.0, "#e4edf2"), (1.0, "#fbfdff")],
        "shadow": "#000000",
        "contour": "#4a3626",
        "ocean": [(0.0, "#3f6f93"), (0.5, "#6f9fbd"), (1.0, "#a8cfdc")],
        "sea_ice": None,
        "coast": "#2c4a63",
        "snow_cover": False,
    },
}


def load_gray(name, size, resample=Image.BICUBIC):
    im = Image.open(IMG / name).convert("L").resize(size, resample)
    return np.asarray(im, dtype=np.float32)


def blur(a, radius):
    """Gaussian blur a float array via Pillow (keeps us free of SciPy)."""
    lo, hi = float(a.min()), float(a.max())
    scale = 255.0 / (hi - lo) if hi > lo else 1.0
    im = Image.fromarray(((a - lo) * scale).astype(np.uint8))
    out = np.asarray(im.filter(ImageFilter.GaussianBlur(radius)), dtype=np.float32)
    return out / scale + lo


def ramp(values, stops):
    """Map values in [0, 1] through a list of (position, hex color) stops."""
    pos = [p for p, _ in stops]
    cols = [hexrgb(c) for _, c in stops]
    out = np.zeros(values.shape + (3,), dtype=np.float32)
    for c in range(3):
        out[..., c] = np.interp(values, pos, [col[c] for col in cols])
    return out


def mix(a, color, amount):
    """Blend image `a` toward `color` by `amount` (0..1 per pixel)."""
    color = hexrgb(color) if isinstance(color, str) else color
    return a * (1 - amount[..., None]) + color * amount[..., None]


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def build(theme):
    T = THEMES[theme]

    # --- Load inputs ---------------------------------------------------------
    elev_raw = load_gray("earth-topology.png", (W, H))
    water = load_gray("earth-water.png", (W, H)) > 128
    land = (elev_raw > 0.5) & ~water
    elev = np.clip(blur(elev_raw / 248.0, 1.2), 0, 1)  # normalised 0..1, smoothed

    lat = np.linspace(90, -90, H)[:, None]
    lon = np.linspace(-180, 180, W)[None, :]
    abslat = np.abs(lat)

    # Patchy noise so snow and sea-ice edges look natural rather than ruler-straight.
    # Made by upscaling small random grids, which gives smooth blobs at a few sizes.
    rng = np.random.default_rng(7)

    def smooth_noise(h, w):
        small = Image.fromarray(rng.random((h, w), dtype=np.float32), mode="F")
        return np.asarray(small.resize((W, H), Image.BICUBIC), dtype=np.float32)

    noise = 0.5 * smooth_noise(64, 128) + 0.3 * smooth_noise(160, 320) + 0.2 * smooth_noise(400, 800)
    noise = (noise - noise.mean()) / (noise.std() + 1e-6)

    # --- 1. Elevation tints --------------------------------------------------
    land_rgb = ramp(elev, T["land"])

    # --- 2. Snow cover -------------------------------------------------------
    if T["snow_cover"]:
        # Snowline (in normalised elevation): high in the tropics, sea level by ~55°.
        snowline = np.clip(0.58 - 0.019 * (abslat - 25), 0.0, 0.58)
        snow = smoothstep(snowline - 0.06, snowline + 0.02, elev + 0.025 * noise)
        land_rgb = mix(land_rgb, T["snow"], snow)

    # Ice sheets (Antarctica and Greenland).
    ice = land & ((lat < -60) | ((lat > 60) & (lon > -73) & (lon < -12) & (elev > 0.06)))
    land_rgb = np.where(ice[..., None], ramp(elev, T["ice"]), land_rgb)

    # --- 3. Hillshade --------------------------------------------------------
    # Pixels get narrower toward the poles, so stretch the east-west gradient.
    coslat = np.clip(np.cos(np.radians(lat)), 0.15, 1)
    gy, gx = np.gradient(elev * 60.0)
    gx = gx / coslat
    light = np.array([-1.0, -1.0, 1.4])  # from the north-west, above the horizon
    light /= np.linalg.norm(light)
    normal = np.stack([-gx, -gy, np.ones_like(gx)], axis=-1)
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
    shade = np.clip((normal * light).sum(-1), 0, 1) - light[2]  # 0 on flat ground
    lit = np.clip(shade, 0, None) * 0.9
    dark = np.clip(-shade, 0, None) * 0.9
    if theme == "winter":
        # Shadows on snow look blue: blend toward the shadow color, highlights toward white.
        land_rgb = mix(land_rgb, T["shadow"], np.clip(dark * 1.3, 0, 0.75))
        land_rgb = mix(land_rgb, "#ffffff", np.clip(lit * 0.8, 0, 0.6))
    else:
        land_rgb *= (1.0 + lit - dark)[..., None]

    # --- 4. Contour lines (anti-aliased) ---------------------------------------
    STEP = 0.045  # elevation step between contours
    level = elev / STEP
    gyl, gxl = np.gradient(level)
    grad = np.sqrt(gxl ** 2 + gyl ** 2) + 1e-6
    frac = level - np.floor(level)
    dist_px = np.minimum(frac, 1 - frac) / grad  # distance to nearest contour, in pixels
    is_index = np.round(level) % 4 == 0
    width = np.where(is_index, 1.1, 0.6)
    alpha = np.clip(1 - dist_px / width, 0, 1) * (elev > STEP * 0.5)
    alpha *= np.where(is_index, 0.6, 0.35)
    land_rgb = mix(land_rgb, T["contour"], alpha)

    # --- 5. Ocean ------------------------------------------------------------
    # No bathymetry in the source, so fake shallow shelves by blurring the land mask.
    landf = land.astype(np.float32)
    near = np.clip((0.6 * blur(landf, 6) + 0.4 * blur(landf, 24)) * 2.2, 0, 1)
    ocean_rgb = ramp(near, T["ocean"])

    if T["sea_ice"]:
        # Winter sea ice: solid near the poles, breaking into patches around 60-70°.
        north = smoothstep(66, 76, lat + 3 * noise)    # Arctic (northern winter)
        south = smoothstep(-64, -70, lat + 3 * noise)  # Antarctic fringe
        ocean_rgb = mix(ocean_rgb, T["sea_ice"], np.clip(north + south, 0, 1) * 0.92)

    rgb = np.where(land[..., None], land_rgb, ocean_rgb)

    # Coastline: a thin dark edge where land meets water.
    soft_land = blur(landf, 0.8)
    rgb = mix(rgb, T["coast"], np.clip(1 - np.abs(soft_land - 0.5) * 4, 0, 1) * 0.6)

    # Graticule every 15°, very faint.
    px_per_deg = W / 360.0

    def grid_alpha(deg):
        d = np.abs(((deg + 7.5) % 15) - 7.5) * px_per_deg
        return np.clip(1 - d / 0.8, 0, 1)

    grat = np.maximum(grid_alpha(lat) * np.ones_like(lon), grid_alpha(lon) * np.ones_like(lat)) * 0.18
    rgb = mix(rgb, "#ffffff", grat)

    out = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8))
    out.save(IMG / T["out"], quality=88, optimize=True)
    print(f"Wrote {IMG / T['out']} ({out.size[0]}x{out.size[1]})")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--theme", choices=sorted(THEMES), default="winter")
    build(parser.parse_args().theme)
