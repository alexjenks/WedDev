"""Make sharp winter-topo "detail patches" around each group of resorts.

The globe's main map is 4096 px wide (~10 km per pixel), which looks blurry
when you zoom in to a single resort. No single image can be sharp everywhere,
so this script renders small high-resolution images (~175 m per pixel) just
around the resorts. The globe fades them in as you zoom close.

Elevation comes from the free AWS Terrain Tiles dataset (Terrarium format,
https://registry.opendata.aws/terrain-tiles/), cached in .cache/terrain/.
Colors, snow and shading use the same winter theme as make_topo_texture.py.

Output: img/detail/<id>.jpg and data/detail-patches.json
Run from the repo root:  python3 tools/make_detail_patches.py
Needs: Pillow and NumPy.
"""

import http.client
import json
import math
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from make_topo_texture import THEMES, blur, hexrgb, mix, ramp, smoothstep  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
RESORTS = ROOT / "data" / "ikon-resorts.json"
FORECASTS = ROOT / "data" / "forecasts.json"   # has each resort's base elevation
OUT_DIR = ROOT / "img" / "detail"
OUT_JSON = ROOT / "data" / "detail-patches.json"
CACHE = ROOT / ".cache" / "terrain"
TILE_URL = "https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png"

ZOOM = 10               # terrain tile zoom (~150 m/px at the equator)
PX_PER_DEG = 640        # output resolution (~175 m per pixel north-south)
GROUP_DEG = 0.6         # resorts closer than this share one patch
PAD_DEG = 0.8           # margin around the resorts in a patch
MIN_SIZE_DEG = 2.0      # smallest patch, north-south
M_PER_UNIT = 9000.0     # metres per unit of the main map's normalised elevation
                        # (calibrated against known peaks), so colours match


def get_tile(z, x, y):
    path = CACHE / str(z) / str(x) / f"{y}.png"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        for attempt in range(4):
            try:
                req = urllib.request.Request(TILE_URL.format(z=z, x=x, y=y), headers={"User-Agent": "ski-globe/0.1"})
                with urllib.request.urlopen(req, timeout=30) as res:
                    path.write_bytes(res.read())
                break
            except (urllib.error.URLError, http.client.HTTPException, ConnectionError, TimeoutError):
                if attempt == 3:
                    raise
                time.sleep(2 * (attempt + 1))
    rgb = np.asarray(Image.open(path).convert("RGB"), dtype=np.float32)
    return rgb[..., 0] * 256 + rgb[..., 1] + rgb[..., 2] / 256 - 32768  # metres


def mercator_px(lat, lng, z):
    """Global Web-Mercator pixel coordinates at zoom z (256 px tiles)."""
    n = 256 * 2 ** z
    x = (lng + 180) / 360 * n
    lat_r = np.radians(np.clip(lat, -85.05, 85.05))
    y = (1 - np.log(np.tan(lat_r) + 1 / np.cos(lat_r)) / np.pi) / 2 * n
    return x, y


def elevation_grid(lat0, lat1, lng0, lng1, w, h):
    """Sample elevation on a regular lat/lng grid (equirectangular) by bilinear
    interpolation from the Mercator terrain tiles."""
    lats = np.linspace(lat1, lat0, h)[:, None] * np.ones((1, w))
    lngs = np.ones((h, 1)) * np.linspace(lng0, lng1, w)[None, :]
    px, py = mercator_px(lats, lngs, ZOOM)
    tx0, tx1 = int(px.min() // 256), int(px.max() // 256)
    ty0, ty1 = int(py.min() // 256), int(py.max() // 256)
    mosaic = np.zeros(((ty1 - ty0 + 1) * 256, (tx1 - tx0 + 1) * 256), dtype=np.float32)
    for ty in range(ty0, ty1 + 1):
        for tx in range(tx0, tx1 + 1):
            mosaic[(ty - ty0) * 256:(ty - ty0 + 1) * 256, (tx - tx0) * 256:(tx - tx0 + 1) * 256] = get_tile(ZOOM, tx, ty)
    fx, fy = px - tx0 * 256 - 0.5, py - ty0 * 256 - 0.5
    x0 = np.clip(np.floor(fx).astype(int), 0, mosaic.shape[1] - 2)
    y0 = np.clip(np.floor(fy).astype(int), 0, mosaic.shape[0] - 2)
    ax, ay = np.clip(fx - x0, 0, 1), np.clip(fy - y0, 0, 1)
    m = mosaic
    top = m[y0, x0] * (1 - ax) + m[y0, x0 + 1] * ax
    bot = m[y0 + 1, x0] * (1 - ax) + m[y0 + 1, x0 + 1] * ax
    return top * (1 - ay) + bot * ay, lats


def render(elev_m, lats, ppd, resort_base_m=None):
    """Winter-theme rendering of an elevation grid (metres).

    resort_base_m: lowest base elevation of the resorts in this patch. The snowline
    is kept at least 250 m below it, so ski areas always look snowy (the
    latitude rule alone leaves snowy places like central Japan bare)."""
    T = THEMES["winter"]
    h, w = elev_m.shape
    land = elev_m > 0.5
    e = np.clip(elev_m / M_PER_UNIT, 0, 1)
    abslat = np.abs(lats)

    rng = np.random.default_rng(int(abs(lats[0, 0]) * 1000))
    small = Image.fromarray(rng.random((max(4, h // 40), max(4, w // 40)), dtype=np.float32), mode="F")
    noise = np.asarray(small.resize((w, h), Image.BICUBIC), dtype=np.float32)
    noise = (noise - noise.mean()) / (noise.std() + 1e-6)

    rgb = ramp(e, T["land"])
    snowline = np.clip(0.58 - 0.019 * (abslat - 25), 0.0, 0.58)  # same rule as the main map
    if resort_base_m is not None:
        snowline = np.minimum(snowline, max(resort_base_m - 250, 0) / M_PER_UNIT)
    snow = smoothstep(snowline - 0.018, snowline + 0.006, e + 0.006 * noise)
    rgb = mix(rgb, T["snow"], snow)

    # Hillshade from true slopes.
    dy_m = 111_320 / ppd
    dx_m = dy_m * np.clip(np.cos(np.radians(lats)), 0.15, 1)
    gy, gx = np.gradient(elev_m)
    gx, gy = gx / dx_m * 2.2, gy / dy_m * 2.2   # mild vertical exaggeration
    light = np.array([-1.0, -1.0, 1.4]); light /= np.linalg.norm(light)
    normal = np.stack([-gx, gy, np.ones_like(gx)], axis=-1)  # rows run north->south
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
    shade = np.clip((normal * light).sum(-1), 0, 1) - light[2]
    rgb = mix(rgb, T["shadow"], np.clip(np.clip(-shade, 0, None) * 1.2, 0, 0.75))
    rgb = mix(rgb, "#ffffff", np.clip(np.clip(shade, 0, None) * 0.7, 0, 0.6))

    # Contours every 200 m, index contour every 1000 m.
    level = blur(elev_m, 1.0) / 200.0
    gyl, gxl = np.gradient(level)
    grad = np.sqrt(gxl ** 2 + gyl ** 2) + 1e-6
    frac = level - np.floor(level)
    dist = np.minimum(frac, 1 - frac) / grad
    is_index = np.round(level) % 5 == 0
    alpha = np.clip(1 - dist / np.where(is_index, 1.0, 0.6), 0, 1) * np.where(is_index, 0.45, 0.22) * land
    rgb = mix(rgb, T["contour"], alpha)

    # Water (sea only; the terrain data has no lake outlines).
    rgb = np.where(land[..., None], rgb, hexrgb(T["ocean"][1][1]))
    return np.clip(rgb, 0, 255).astype(np.uint8)


def group_resorts(resorts):
    groups = []
    for r in resorts:
        g = next((g for g in groups if abs(g["anchor"]["lat"] - r["lat"]) < GROUP_DEG
                  and abs(g["anchor"]["lng"] - r["lng"]) * math.cos(math.radians(r["lat"])) < GROUP_DEG), None)
        if g:
            g["members"].append(r)
        else:
            groups.append({"anchor": r, "members": [r]})
    return groups


def main():
    resorts = json.loads(RESORTS.read_text())["resorts"]
    bases = {}
    if FORECASTS.exists():
        bases = {k: v.get("elevation") for k, v in json.loads(FORECASTS.read_text())["resorts"].items()}
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    patches = []
    for g in group_resorts(resorts):
        lats = [m["lat"] for m in g["members"]]
        lngs = [m["lng"] for m in g["members"]]
        coslat = math.cos(math.radians(sum(lats) / len(lats)))
        lat0, lat1 = min(lats) - PAD_DEG, max(lats) + PAD_DEG
        lng0, lng1 = min(lngs) - PAD_DEG / coslat, max(lngs) + PAD_DEG / coslat
        if lat1 - lat0 < MIN_SIZE_DEG:
            c = (lat0 + lat1) / 2; lat0, lat1 = c - MIN_SIZE_DEG / 2, c + MIN_SIZE_DEG / 2
        if (lng1 - lng0) * coslat < MIN_SIZE_DEG:
            c = (lng0 + lng1) / 2; half = MIN_SIZE_DEG / coslat / 2; lng0, lng1 = c - half, c + half
        h = int(round((lat1 - lat0) * PX_PER_DEG))
        w = int(round((lng1 - lng0) * PX_PER_DEG * coslat))
        pid = g["anchor"]["id"]
        elev, grid_lats = elevation_grid(lat0, lat1, lng0, lng1, w, h)
        base = min((bases[m["id"]] for m in g["members"] if bases.get(m["id"]) is not None), default=None)
        Image.fromarray(render(elev, grid_lats, PX_PER_DEG, base)).save(OUT_DIR / f"{pid}.jpg", quality=80, optimize=True, progressive=True)
        patches.append({
            "id": pid,
            "resorts": [m["id"] for m in g["members"]],
            "lat": round((lat0 + lat1) / 2, 4), "lng": round((lng0 + lng1) / 2, 4),
            "width": round(lng1 - lng0, 4), "height": round(lat1 - lat0, 4),
            "file": f"img/detail/{pid}.jpg",
        })
        print(f"  {pid:22s} {len(g['members'])} resort(s)  {w}x{h}px")
    OUT_JSON.write_text(json.dumps({"patches": patches}, indent=1))
    size = sum(f.stat().st_size for f in OUT_DIR.glob("*.jpg")) // 1024
    print(f"Wrote {len(patches)} patches ({size} KB) and {OUT_JSON.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
