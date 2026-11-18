"""Build the topographic Earth texture used by the globe.

Input:  img/earth-topology.png  (grayscale elevation, 0 = sea level/ocean)
        img/earth-water.png     (white = water)
Output: img/earth-topo.jpg      (equirectangular color map for globe.gl)

The map is built in four layers:
  1. Hypsometric tints: land colored by elevation (green lowlands, tan hills,
     brown mountains, white peaks).
  2. Hillshading: light from the north-west so slopes read as 3D relief.
  3. Contour lines: thin lines at fixed elevation steps, with every 4th one
     drawn darker (an "index contour", as on printed topo maps).
  4. Ocean: blue that gets lighter near coasts, plus a 15° lat/lng graticule.

Run from the repo root:  python3 tools/make_topo_texture.py
Needs: Pillow and NumPy.
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
IMG = ROOT / "img"
W, H = 4096, 2048  # output size (equirectangular: 360° x 180°)


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
    """Map values in [0, 1] through a list of (position, (r, g, b)) color stops."""
    pos = np.array([p for p, _ in stops])
    out = np.zeros(values.shape + (3,), dtype=np.float32)
    for c in range(3):
        out[..., c] = np.interp(values, pos, [col[c] for _, col in stops])
    return out


def hexrgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


# --- Load inputs -------------------------------------------------------------
elev_raw = load_gray("earth-topology.png", (W, H))
water = load_gray("earth-water.png", (W, H)) > 128
land = (elev_raw > 0.5) & ~water

# Normalised elevation 0..1, lightly smoothed so contours don't look jagged.
elev = blur(elev_raw / 248.0, 1.2)
elev = np.clip(elev, 0, 1)

# --- 1. Hypsometric tints -----------------------------------------------------
land_rgb = ramp(elev, [
    (0.00, hexrgb("#7fa66a")),  # coastal lowland green
    (0.10, hexrgb("#a9c483")),
    (0.22, hexrgb("#dfd9a0")),  # tan uplands
    (0.36, hexrgb("#cfa877")),
    (0.52, hexrgb("#a87c58")),  # brown mountains
    (0.62, hexrgb("#8c7a6e")),  # bare rock
    (0.76, hexrgb("#d9d6d2")),  # high peaks, snow-dusted
    (1.00, hexrgb("#ffffff")),  # snow and ice
])

# Ice sheets (Antarctica and Greenland) are tinted ice-white instead of by height.
lon_deg = np.linspace(-180, 180, W)[None, :]
lat_deg = np.linspace(90, -90, H)[:, None]
ice = land & ((lat_deg < -60) | ((lat_deg > 60) & (lon_deg > -73) & (lon_deg < -12) & (elev > 0.06)))
ice_rgb = ramp(elev, [(0.0, hexrgb("#e4edf2")), (1.0, hexrgb("#fbfdff"))])
land_rgb = np.where(ice[..., None], ice_rgb, land_rgb)

# --- 2. Hillshade ------------------------------------------------------------
# Pixels get narrower toward the poles, so stretch the east-west gradient.
lat = np.linspace(90, -90, H)[:, None]
coslat = np.clip(np.cos(np.radians(lat)), 0.15, 1)
gy, gx = np.gradient(elev * 60.0)
gx = gx / coslat
light = np.array([-1.0, -1.0, 1.4])  # from the north-west, above the horizon
light /= np.linalg.norm(light)
normal = np.stack([-gx, -gy, np.ones_like(gx)], axis=-1)
normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
shade = np.clip((normal * light).sum(-1), 0, 1)
flat = light[2]
shade = 1.0 + 0.9 * (shade - flat)  # 1.0 on flat ground, darker/lighter on slopes
land_rgb *= shade[..., None]

# --- 3. Contour lines (anti-aliased) ------------------------------------------
STEP = 0.045  # elevation step between contours
level = elev / STEP
gyl, gxl = np.gradient(level)
grad = np.sqrt(gxl ** 2 + gyl ** 2) + 1e-6
frac = level - np.floor(level)
dist_px = np.minimum(frac, 1 - frac) / grad          # distance to nearest contour, in pixels
is_index = (np.round(level) % 4 == 0)
width = np.where(is_index, 1.1, 0.6)
alpha = np.clip(1 - dist_px / width, 0, 1) * (elev > STEP * 0.5)
alpha *= np.where(is_index, 0.65, 0.38)
contour_rgb = np.array(hexrgb("#4a3626"), dtype=np.float32)
land_rgb = land_rgb * (1 - alpha[..., None]) + contour_rgb * alpha[..., None]

# --- 4. Ocean -----------------------------------------------------------------
# No bathymetry in the source, so fake shallow shelves by blurring the land mask.
landf = land.astype(np.float32)
near = np.clip(0.6 * blur(landf, 6) + 0.4 * blur(landf, 24), 0, 1)
near = np.clip(near * 2.2, 0, 1)
ocean_rgb = ramp(near, [
    (0.0, hexrgb("#3f6f93")),  # deep
    (0.5, hexrgb("#6f9fbd")),
    (1.0, hexrgb("#a8cfdc")),  # shallow, near coast
])

rgb = np.where(land[..., None], land_rgb, ocean_rgb)

# Coastline: a thin dark-blue edge where land meets water.
soft_land = blur(landf, 0.8)
coast = np.clip(1 - np.abs(soft_land - 0.5) * 4, 0, 1) * 0.6
rgb = rgb * (1 - coast[..., None]) + np.array(hexrgb("#2c4a63")) * coast[..., None]

# Graticule every 15°, very faint.
lon = np.linspace(-180, 180, W)[None, :]
px_per_deg = W / 360.0
def grid_alpha(deg):
    d = np.abs(((deg + 7.5) % 15) - 7.5) * px_per_deg
    return np.clip(1 - d / 0.8, 0, 1)
grat = np.maximum(grid_alpha(lat) * np.ones_like(lon), grid_alpha(lon) * np.ones_like(lat)) * 0.18
rgb = rgb * (1 - grat[..., None]) + 255 * grat[..., None]

out = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8))
out.save(IMG / "earth-topo.jpg", quality=88, optimize=True)
print(f"Wrote {IMG / 'earth-topo.jpg'} ({out.size[0]}x{out.size[1]})")
