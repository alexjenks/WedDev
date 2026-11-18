# Ski Globe

An interactive 3D globe built with [globe.gl](https://globe.gl/). No build step
and nothing to install: the library loads from a CDN.

Current step: a wintery topographic globe you can rotate (drag) and zoom (scroll/pinch).
Next steps: plot OpenSkiMap ski resorts, then show an Open-Meteo snowfall
forecast when you click one.

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
| `app.js` | Creates the globe, sets the Earth/sky images and starting view, and turns on slow auto-rotation. |
| `img/earth-winter.jpg` | The winter topographic map the globe uses: snow cover, sea ice, ice-blue palette (generated, see below). |
| `img/earth-topo.jpg` | A summer-style topographic map (green/brown), kept as an alternative. |
| `img/earth-topology.png`, `img/earth-water.png`, `img/night-sky.png` | Elevation map, water mask and star background, copied from the [three-globe](https://github.com/vasturiano/three-globe) examples. |
| `tools/make_topo_texture.py` | Builds both maps from the elevation map: color by height, snow cover, hillshading, contour lines, ice sheets, shaded ocean and a 15° grid. |

## Regenerating the topographic map

Requires Python 3 with Pillow and NumPy (`pip install pillow numpy`):

```sh
python3 tools/make_topo_texture.py                 # winter -> img/earth-winter.jpg
python3 tools/make_topo_texture.py --theme summer  # summer -> img/earth-topo.jpg
```

All colors live in the `THEMES` table at the top of the script. To change how
far snow reaches, edit the `snowline` line (lower numbers = more snow). To
switch the globe to the summer map, change `globeImageUrl` in `app.js`.
