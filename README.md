# Ski Globe

An interactive 3D globe of the world's ski resorts. Click a resort to see its
7-day snowfall forecast.

- **Globe:** [globe.gl](https://globe.gl/) (loaded from a CDN, no build step)
- **Resorts:** [OpenSkiMap](https://openskimap.org/) `ski_areas.geojson`, © OpenStreetMap contributors
- **Forecast:** [Open-Meteo](https://open-meteo.com/) (free, no API key)

## Run it

The page fetches data, so open it through a local web server rather than
double-clicking the file:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Files

| File | What it does |
|---|---|
| `index.html` | Page skeleton: the globe container, a status line, and the side panel. Loads globe.gl from a CDN. |
| `style.css` | Full-screen globe, the floating side panel, and the snowfall bar rows. |
| `app.js` | Creates the globe, loads and filters the ski areas, and fetches/renders the forecast on click. |

## If the resort data won't load

`app.js` first tries `https://tiles.openskimap.org/geojson/ski_areas.geojson`.
If that fails (network or CORS), it falls back to a local copy:

```sh
mkdir -p data
curl -L -o data/ski_areas.geojson https://tiles.openskimap.org/geojson/ski_areas.geojson
```

The file is large, so the first load can take a while.
