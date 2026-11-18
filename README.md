# Ski Globe

An interactive 3D globe built with [globe.gl](https://globe.gl/). No build step
and nothing to install: the library loads from a CDN.

Current step: a wintery topographic globe with a logo badge for every Ikon Pass resort.
Drag to rotate, scroll/pinch to zoom, hover a badge for the resort's name.
When zoomed out, nearby resorts merge into a numbered bubble; click it to zoom in.
Click a resort for its 14-day snowfall forecast (from Open-Meteo).

## Run it

```sh
git clone https://github.com/alexjenks/WedDev.git
cd WedDev
git checkout claude/gracious-knuth-e4q42u
python3 -m http.server 8000
```

Then open http://localhost:8000 in your browser. Press Ctrl+C in the terminal to stop the server.

(Opening `index.html` directly also works for the basic globe, but the server
will be needed once the page starts loading resort data.)

## Files

| File | What it does |
|---|---|
| `index.html` | Page skeleton: loads globe.gl and gives it a full-screen `<div>` to draw in. |
| `style.css` | Makes the page a full-screen dark canvas with no scrollbars. |
| `app.js` | Creates the globe (images, starting view, slow spin) and adds a badge for each Ikon resort. |
| `data/forecasts.json` | Saved 14-day forecast for every resort, used when live requests are blocked. |
| `data/ikon-resorts.json` | The Ikon Pass resorts: name, region, location and website. Edit this to add or remove resorts. |
| `img/logos/` | Optional logo files, named `<id>.png` after each resort's `id` in the JSON. |
| `img/earth-winter.jpg` | The winter topographic map the globe uses: snow cover, sea ice, ice-blue palette (generated, see below). |
| `img/earth-topo.jpg` | A summer-style topographic map (green/brown), kept as an alternative. |
| `img/earth-topology.png`, `img/earth-water.png`, `img/night-sky.png` | Elevation map, water mask and star background, copied from the [three-globe](https://github.com/vasturiano/three-globe) examples. |
| `tools/fetch_forecasts.py` | Refreshes `data/forecasts.json` from Open-Meteo. |
| `tools/make_topo_texture.py` | Builds both maps from the elevation map: color by height, snow cover, hillshading, contour lines, ice sheets, shaded ocean and a 15° grid. |

## Snowfall forecasts

Clicking a resort opens a panel with 14 days of forecast snowfall, totals for
the next 7 and 14 days, temperatures and conditions, in inches or cm.

- Data comes from [Open-Meteo](https://open-meteo.com/), free for
  non-commercial use with no API key. It blends several national weather
  models. (OpenSnow doesn't offer a public API.)
- Forecasts are for each resort's listed location, usually near the base area,
  so summits often get more snow. Days 8–14 are much less reliable and are drawn
  lighter.
- The page fetches forecasts live. Where outside requests are blocked (the
  claude.ai preview), it falls back to `data/forecasts.json`, a snapshot you can
  refresh with:

```sh
python3 tools/fetch_forecasts.py
```

## Resort logos

Each badge tries, in order:

1. `img/logos/<id>.png` (your own file, e.g. `img/logos/jackson-hole.png`)
2. The resort website's icon, via Google's favicon service
3. The resort's initials

To download logos from Wikipedia/Wikidata automatically (needs Pillow):

```sh
python3 tools/fetch_logos.py           # only fetches logos you don't have yet
python3 tools/fetch_logos.py --force   # re-download all
```

It uses each resort's `wiki` field in `data/ikon-resorts.json` and lists the
resorts it couldn't find a logo for. Logos are trademarks of their resorts.

Website icons are often a simplified mark rather than the full logo, so for the
best look save each resort's logo as a square PNG (128x128 or larger, transparent
background) in `img/logos/`.

## Regenerating the topographic map

Requires Python 3 with Pillow and NumPy (`pip install pillow numpy`):

```sh
python3 tools/make_topo_texture.py                 # winter -> img/earth-winter.jpg
python3 tools/make_topo_texture.py --theme summer  # summer -> img/earth-topo.jpg
```

All colors live in the `THEMES` table at the top of the script. To change how
far snow reaches, edit the `snowline` line (lower numbers = more snow). To
switch the globe to the summer map, change `globeImageUrl` in `app.js`.
