// ---------------------------------------------------------------------------
// Ski Globe — plots OpenSkiMap ski areas on a 3D globe and shows a 7-day
// snowfall forecast from Open-Meteo when you click one.
// ---------------------------------------------------------------------------

// Where to load ski areas from. We try the live OpenSkiMap export first and
// fall back to a local copy (see README for how to download it).
const SKI_AREA_SOURCES = [
  'https://tiles.openskimap.org/geojson/ski_areas.geojson',
  'data/ski_areas.geojson',
];

const statusEl = document.getElementById('status');
const panelEl = document.getElementById('panel');
const nameEl = document.getElementById('resort-name');
const metaEl = document.getElementById('resort-meta');
const forecastEl = document.getElementById('forecast');

// ---------------------------------------------------------------------------
// 1. Create the globe
// ---------------------------------------------------------------------------
const globe = Globe()(document.getElementById('globe'))
  .globeImageUrl('https://cdn.jsdelivr.net/npm/three-globe@2.45.0/example/img/earth-blue-marble.jpg')
  .bumpImageUrl('https://cdn.jsdelivr.net/npm/three-globe@2.45.0/example/img/earth-topology.png')
  .backgroundImageUrl('https://cdn.jsdelivr.net/npm/three-globe@2.45.0/example/img/night-sky.png')
  .pointLat('lat')
  .pointLng('lng')
  .pointColor(() => '#ffffff')
  .pointAltitude(0.01)
  .pointRadius(0.12)
  .pointResolution(6)              // fewer sides per point = faster with thousands of points
  .pointLabel(d => `<b>${escapeHtml(d.name)}</b><br>${escapeHtml(d.country)}`)
  .onPointClick(showResort);

// Start the camera over the Alps.
globe.pointOfView({ lat: 46, lng: 10, altitude: 1.8 });

// Keep the globe sized to the window.
window.addEventListener('resize', () => {
  globe.width(window.innerWidth).height(window.innerHeight);
});

// ---------------------------------------------------------------------------
// 2. Load ski areas and turn GeoJSON features into simple point objects
// ---------------------------------------------------------------------------
async function loadSkiAreas() {
  for (const url of SKI_AREA_SOURCES) {
    try {
      statusEl.textContent = `Loading ski resorts from ${new URL(url, location.href).host || 'local file'}…`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn(`Could not load ${url}:`, err);
    }
  }
  throw new Error('No ski area data could be loaded.');
}

function featureToResort(feature) {
  const p = feature.properties || {};

  // Keep only operating downhill ski areas so the globe isn't cluttered.
  if (p.type && p.type !== 'skiArea') return null;
  if (!Array.isArray(p.activities) || !p.activities.includes('downhill')) return null;
  if (p.status && p.status !== 'operating') return null;

  const center = representativePoint(feature.geometry);
  if (!center) return null;

  const place = p.location?.localized?.en || {};
  return {
    id: p.id,
    name: p.name || 'Unnamed ski area',
    country: [place.region, place.country].filter(Boolean).join(', '),
    website: Array.isArray(p.websites) ? p.websites[0] : undefined,
    lat: center.lat,
    lng: center.lng,
  };
}

// Ski areas can be Points, Polygons or MultiPolygons. For anything that isn't a
// Point we use the centre of its bounding box — good enough for a marker.
function representativePoint(geometry) {
  if (!geometry) return null;
  if (geometry.type === 'Point') {
    const [lng, lat] = geometry.coordinates;
    return { lat, lng };
  }
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  (function walk(coords) {
    if (typeof coords[0] === 'number') {
      const [lng, lat] = coords;
      minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
      minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng);
    } else {
      coords.forEach(walk);
    }
  })(geometry.coordinates || []);
  if (!isFinite(minLat)) return null;
  return { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };
}

loadSkiAreas()
  .then(geojson => {
    const resorts = geojson.features.map(featureToResort).filter(Boolean);
    globe.pointsData(resorts);
    statusEl.textContent = `${resorts.length.toLocaleString()} ski resorts · click one for a snowfall forecast`;
  })
  .catch(err => {
    statusEl.textContent = `${err.message} See README.md for how to download the data locally.`;
    statusEl.classList.add('error');
  });

// ---------------------------------------------------------------------------
// 3. Clicking a resort: open the panel and fetch its forecast
// ---------------------------------------------------------------------------
let latestRequest = 0; // ignore slow responses if the user clicks another resort

async function showResort(resort) {
  const requestId = ++latestRequest;

  panelEl.hidden = false;
  nameEl.textContent = resort.name;
  metaEl.textContent = [resort.country, `${resort.lat.toFixed(3)}, ${resort.lng.toFixed(3)}`]
    .filter(Boolean).join(' · ');
  forecastEl.innerHTML = '<p class="muted">Loading forecast…</p>';

  // Fly the camera to the resort.
  globe.pointOfView({ lat: resort.lat, lng: resort.lng, altitude: 0.8 }, 1000);

  try {
    const daily = await fetchForecast(resort.lat, resort.lng);
    if (requestId !== latestRequest) return;
    renderForecast(daily);
  } catch (err) {
    if (requestId !== latestRequest) return;
    forecastEl.innerHTML = `<p class="error">Could not load forecast: ${escapeHtml(err.message)}</p>`;
  }
}

async function fetchForecast(lat, lng) {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lng,
    daily: 'snowfall_sum,temperature_2m_max,temperature_2m_min',
    timezone: 'auto',     // dates come back in the resort's local time zone
    forecast_days: 7,
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.daily; // { time: [...], snowfall_sum: [...], temperature_2m_max: [...], ... }
}

function renderForecast(daily) {
  const snow = daily.snowfall_sum.map(v => v ?? 0); // cm per day
  const max = Math.max(...snow, 1);                 // scale bars; avoid divide-by-zero
  const total = snow.reduce((a, b) => a + b, 0);

  const rows = daily.time.map((date, i) => {
    const day = new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric',
    });
    const cm = snow[i];
    const hi = daily.temperature_2m_max[i];
    const lo = daily.temperature_2m_min[i];
    return `
      <div class="day" title="${day}: ${cm.toFixed(1)} cm snow">
        <span class="label">${day}</span>
        <div class="bar-track"><div class="bar" style="width:${(cm / max) * 100}%"></div></div>
        <span class="value">${cm.toFixed(1)} cm</span>
        <span class="temps">${Math.round(lo)}° / ${Math.round(hi)}°C</span>
      </div>`;
  }).join('');

  forecastEl.innerHTML = `${rows}<p class="total"><b>${total.toFixed(1)} cm</b> total over 7 days</p>`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
document.getElementById('close').addEventListener('click', () => {
  panelEl.hidden = true;
});

function escapeHtml(str = '') {
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
