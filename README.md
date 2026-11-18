# Ski Globe

An interactive 3D globe built with [globe.gl](https://globe.gl/). No build step
and nothing to install: the library loads from a CDN.

Current step: a basic globe you can rotate (drag) and zoom (scroll/pinch).
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
