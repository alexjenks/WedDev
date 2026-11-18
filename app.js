// A wintery topographic globe with a logo badge for every Ikon Pass resort.
// Drag to rotate, scroll (or pinch) to zoom, hover a badge to see its name.
// Nearby resorts merge into a numbered bubble when zoomed out; click it to zoom in.
// Click a resort for its 14-day snowfall forecast.

const globe = Globe()(document.getElementById('globe'))
  .globeImageUrl('img/earth-winter.jpg')       // our wintery topographic map (see tools/make_topo_texture.py)
  .bumpImageUrl('img/earth-topology.png')      // elevation map: makes mountains catch the light
  .backgroundImageUrl('img/night-sky.png')     // starry background
  .atmosphereColor('#d6ecff')                  // soft pale-blue halo around the globe
  .atmosphereAltitude(0.18);

// Start looking at North America, where most Ikon resorts are.
globe.pointOfView({ lat: 42, lng: -100, altitude: 2.2 });

// Slowly spin the globe until the user grabs it (unless they prefer reduced motion).
globe.controls().autoRotate = !matchMedia('(prefers-reduced-motion: reduce)').matches;
globe.controls().autoRotateSpeed = 0.4;

// ---------------------------------------------------------------------------
// Zoom speed
// ---------------------------------------------------------------------------
// globe.gl slows zooming down as you get closer (speed ~ sqrt(altitude)), which
// feels sluggish near the surface. Instead, make every scroll notch change the
// camera's height above the ground by the same fraction, whatever the zoom.
const ZOOM_STEP = 0.3; // each notch moves ~30% of the way to the ground

function updateZoomSpeed() {
  const a = globe.pointOfView().altitude;
  // The controls scale the camera's distance from the globe's centre, R(1 + a),
  // by 0.95^zoomSpeed per notch. Solve for the speed that gives a' = a(1 - step).
  const scale = (1 + a * (1 - ZOOM_STEP)) / (1 + a);
  globe.controls().zoomSpeed = Math.log(scale) / Math.log(0.95);
}
globe.controls().addEventListener('change', updateZoomSpeed); // runs after globe.gl's own handler
updateZoomSpeed();

// Badges are clickable HTML on top of the globe, so they'd swallow scroll-wheel
// events. Pass those on to the globe's canvas so zooming works anywhere.
document.getElementById('globe').addEventListener('wheel', e => {
  if (!e.target.closest('.badge-anchor')) return;
  e.preventDefault();
  globe.renderer().domElement.dispatchEvent(new WheelEvent('wheel', e));
}, { passive: false });

// Keep the globe sized to the window.
window.addEventListener('resize', () => {
  globe.width(window.innerWidth).height(window.innerHeight);
});

// ---------------------------------------------------------------------------
// Ikon Pass resort badges
// ---------------------------------------------------------------------------

// Where to look for each resort's logo, in order. If one fails to load we try
// the next, and if they all fail the badge shows the resort's initials.
const logoSources = resort => [
  `img/logos/${resort.id}.png`,                                             // your own logo file, if you add one
  resort.domain && `https://www.google.com/s2/favicons?domain=${resort.domain}&sz=128`, // the resort website's icon
].filter(Boolean);

function makeBadge(resort) {
  const el = document.createElement('button');
  el.className = 'badge';
  el.setAttribute('aria-label', `${resort.name}, ${resort.region}`);

  const initials = document.createElement('span');
  initials.className = 'initials';
  initials.textContent = resort.name
    .replace(/^(The|Mt\.?|Mount)\s+/i, '')
    .split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  el.append(initials);

  const img = document.createElement('img');
  img.alt = '';
  const sources = logoSources(resort);
  let i = 0;
  img.onload = () => el.classList.add('has-logo');
  img.onerror = () => { i += 1; if (i < sources.length) img.src = sources[i]; else img.remove(); };
  img.src = sources[0];
  el.append(img);

  // Name label shown on hover/focus.
  const label = document.createElement('span');
  label.className = 'badge-label';
  label.innerHTML = `<b></b><small></small>`;
  label.querySelector('b').textContent = resort.name;
  label.querySelector('small').textContent = resort.region;
  el.append(label);

  el.dataset.id = resort.id;
  el.addEventListener('click', () => openForecast(resort));
  return wrapInAnchor(el);
}

// globe.gl moves markers by setting their CSS transform, so give it a plain
// wrapper to move and keep the badge's own hover zoom separate.
function wrapInAnchor(el) {
  const wrapper = document.createElement('div');
  wrapper.className = 'badge-anchor';
  wrapper.append(el);
  return wrapper;
}

// A numbered bubble standing in for several resorts that would overlap.
function makeClusterBadge(cluster) {
  const el = document.createElement('button');
  el.className = 'badge cluster';
  const n = cluster.members.length;
  el.style.setProperty('--size', `${Math.min(30 + 3 * Math.sqrt(n), 44)}px`);
  el.setAttribute('aria-label', `${n} resorts: ${cluster.members.map(r => r.name).join(', ')}. Click to zoom in.`);

  const count = document.createElement('span');
  count.className = 'count';
  count.textContent = n;
  el.append(count);

  const label = document.createElement('span');
  label.className = 'badge-label';
  const title = document.createElement('b');
  title.textContent = `${n} resorts`;
  label.append(title);
  for (const r of cluster.members.slice(0, 8)) {
    const line = document.createElement('small');
    line.textContent = r.name;
    label.append(line);
  }
  if (n > 8) {
    const more = document.createElement('small');
    more.textContent = `+ ${n - 8} more`;
    label.append(more);
  }
  el.append(label);

  el.addEventListener('click', () => zoomToCluster(cluster));
  return wrapInAnchor(el);
}

// ---------------------------------------------------------------------------
// Grouping nearby resorts
// ---------------------------------------------------------------------------
// Badges keep the same size on screen while the globe zooms, so when zoomed out
// they pile up. Each time the zoom changes we work out how many degrees of the
// globe a badge covers, and merge resorts closer together than that.

const BADGE_GAP_PX = 36;   // two badges closer than this on screen get merged
let allResorts = [];
let currentCellDeg = null;
const elementCache = new Map(); // reuse DOM elements so logos don't reload

// Approximate screen pixels per degree of latitude at the centre of the view.
function pixelsPerDegree() {
  const { altitude } = globe.pointOfView();
  const fov = (globe.camera().fov * Math.PI) / 180;
  return (globe.height() / 2 / Math.tan(fov / 2)) * (Math.PI / 180) / altitude;
}

// Great-circle distance in degrees.
function angularDistance(a, b) {
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLng = (b.lng - a.lng) * toRad;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLng / 2) ** 2;
  return (2 * Math.asin(Math.min(1, Math.sqrt(h)))) / toRad;
}

function groupResorts(resorts, maxDeg) {
  // Each group is anchored on its first resort, so a group can't creep across
  // the map by chaining neighbours together.
  const groups = [];
  for (const r of resorts) {
    const near = groups.find(g => angularDistance(g.anchor, r) < maxDeg);
    if (near) near.members.push(r);
    else groups.push({ anchor: r, members: [r] });
  }
  // Draw each group at the average position of its members.
  for (const g of groups) {
    g.lat = g.members.reduce((s, m) => s + m.lat, 0) / g.members.length;
    g.lng = g.members.reduce((s, m) => s + m.lng, 0) / g.members.length;
  }
  return groups;
}

function elementFor(group) {
  const key = group.members.map(r => r.id).sort().join('+');
  if (!elementCache.has(key)) {
    elementCache.set(key, group.members.length === 1 ? makeBadge(group.members[0]) : makeClusterBadge(group));
  }
  return elementCache.get(key);
}

function updateGroups() {
  if (!allResorts.length) return;
  // Round to a few sizes so small zoom changes don't reshuffle the badges.
  const raw = BADGE_GAP_PX / pixelsPerDegree();
  const cellDeg = 2 ** (Math.round(Math.log2(raw) * 4) / 4);
  if (cellDeg === currentCellDeg) return;
  currentCellDeg = cellDeg;
  globe.htmlElementsData(groupResorts(allResorts, cellDeg));
}

function zoomToCluster(cluster) {
  globe.controls().autoRotate = false;
  // Zoom in far enough that the cluster's resorts separate.
  // Zoom in until the whole group spans about a third of the screen. Big groups
  // split into smaller ones; click again to keep drilling down.
  // pixelsPerDegree() scales with 1/altitude, which lets us solve for altitude.
  const { altitude } = globe.pointOfView();
  const spread = Math.max(...cluster.members.map(r => angularDistance(cluster, r)), 0.02);
  const fit = (pixelsPerDegree() * altitude * spread) / (globe.height() / 3);
  const target = Math.max(0.03, Math.min(altitude / 1.5, fit));
  globe.pointOfView({ lat: cluster.lat, lng: cluster.lng, altitude: target }, 700);
}

fetch('data/ikon-resorts.json')
  .then(res => res.json())
  .then(({ resorts }) => {
    allResorts = resorts;
    globe
      .htmlLat('lat')
      .htmlLng('lng')
      .htmlAltitude(0.005)
      .htmlElement(elementFor)
      .htmlTransitionDuration(0);
    updateGroups();
  })
  .catch(err => console.error('Could not load Ikon resorts:', err));

// Re-group whenever the camera moves (checked at most once per frame).
let pending = false;
globe.controls().addEventListener('change', () => {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => { pending = false; updateGroups(); });
});

// Stop the spin as soon as someone points at a badge, so it doesn't slide away.
document.getElementById('globe').addEventListener('pointerover', e => {
  if (e.target.closest('.badge')) globe.controls().autoRotate = false;
});

// ---------------------------------------------------------------------------
// Snowfall forecast panel
// ---------------------------------------------------------------------------
// Forecasts come from Open-Meteo (free, no key). If the page isn't allowed to
// call it (the claude.ai preview blocks outside requests), we fall back to the
// snapshot in data/forecasts.json made by tools/fetch_forecasts.py.

const FORECAST_DAYS = 14;
const CERTAIN_DAYS = 7;   // forecasts beyond this many days are much less reliable
const FORECAST_PARAMS = {
  daily: 'snowfall_sum,temperature_2m_max,temperature_2m_min,weather_code',
  timezone: 'auto',
  forecast_days: FORECAST_DAYS,
};

const panel = document.getElementById('panel');
const forecastEl = document.getElementById('forecast');
const liveCache = new Map();
let snapshotPromise = null;
let currentResort = null;
let currentForecast = null;
let requestId = 0;

// Units: inches/°F by default in the US, cm/°C elsewhere; remembered per browser.
let units = (navigator.language || '').toLowerCase() === 'en-us' ? 'in' : 'cm';
try { units = localStorage.getItem('ski-globe-units') || units; } catch {}

async function fetchLive(resort) {
  if (liveCache.has(resort.id)) return liveCache.get(resort.id);
  const params = new URLSearchParams({ latitude: resort.lat, longitude: resort.lng, ...FORECAST_PARAMS });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!res.ok) throw new Error(`Open-Meteo answered ${res.status}`);
  const data = await res.json();
  const forecast = { daily: data.daily, elevation: data.elevation, live: true, fetchedAt: new Date() };
  liveCache.set(resort.id, forecast);
  return forecast;
}

async function fetchSnapshot(resort) {
  snapshotPromise ??= fetch('data/forecasts.json').then(r => (r.ok ? r.json() : null)).catch(() => null);
  const snap = await snapshotPromise;
  const f = snap?.resorts?.[resort.id];
  if (!f) throw new Error('No forecast available for this resort.');
  return { daily: f.daily, elevation: f.elevation, live: false, fetchedAt: new Date(snap.generated_at) };
}

async function getForecast(resort) {
  try {
    return await fetchLive(resort);
  } catch (err) {
    console.info('Live forecast unavailable, using saved snapshot:', err.message);
    return fetchSnapshot(resort);
  }
}

async function openForecast(resort) {
  const id = ++requestId;
  currentResort = resort;
  currentForecast = null;
  globe.controls().autoRotate = false;

  document.querySelectorAll('.badge.selected').forEach(b => b.classList.remove('selected'));
  document.querySelector(`.badge[data-id="${CSS.escape(resort.id)}"]`)?.classList.add('selected');

  // Header: logo (or initials), name, region.
  const logo = document.getElementById('panel-logo');
  logo.textContent = '';
  const badgeImg = document.querySelector(`.badge[data-id="${CSS.escape(resort.id)}"].has-logo img`);
  if (badgeImg) {
    const img = document.createElement('img');
    img.src = badgeImg.src;
    img.alt = '';
    logo.append(img);
  } else {
    logo.textContent = initialsFor(resort.name);
  }
  document.getElementById('panel-name').textContent = resort.name;
  document.getElementById('panel-region').textContent = resort.region;
  document.getElementById('panel-source').textContent = '';
  forecastEl.innerHTML = '<p class="panel-msg">Loading forecast…</p>';
  panel.hidden = false;

  try {
    const forecast = await getForecast(resort);
    if (id !== requestId) return; // a different resort was clicked meanwhile
    currentForecast = forecast;
    renderForecast();
  } catch (err) {
    if (id !== requestId) return;
    forecastEl.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'panel-msg error';
    p.textContent = `Couldn't load a forecast: ${err.message}`;
    forecastEl.append(p);
  }
}

function initialsFor(name) {
  return name.replace(/^(The|Mt\.?|Mount)\s+/i, '')
    .split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

// --- Formatting helpers ------------------------------------------------------
const snowIn = cm => (units === 'in' ? cm / 2.54 : cm);
const unitLabel = () => (units === 'in' ? 'in' : 'cm');
function fmtSnow(cm, { withUnit = false } = {}) {
  const v = snowIn(cm ?? 0);
  const text = v === 0 ? '0' : v < 10 ? v.toFixed(1) : Math.round(v).toString();
  return withUnit ? `${text} ${unitLabel()}` : text;
}
const fmtTemp = c => (c == null ? '–' : `${Math.round(units === 'in' ? c * 9 / 5 + 32 : c)}°`);

// WMO weather codes used by Open-Meteo, shortened.
function describeWeather(code) {
  if (code == null) return '';
  if (code === 0) return 'Clear';
  if (code <= 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code <= 48) return 'Fog';
  if (code <= 57) return 'Drizzle';
  if (code <= 67) return 'Rain';
  if (code <= 77) return code === 77 ? 'Snow grains' : 'Snow';
  if (code <= 82) return 'Rain showers';
  if (code <= 86) return 'Snow showers';
  return 'Thunderstorms';
}

function parseDay(iso) {
  // Dates arrive as YYYY-MM-DD in the resort's own time zone; build a local date
  // from the parts so they don't shift a day in the viewer's time zone.
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// --- Rendering ----------------------------------------------------------------
function renderForecast() {
  const f = currentForecast;
  if (!f) return;
  const days = f.daily.time.map((iso, i) => ({
    date: parseDay(iso),
    snow: f.daily.snowfall_sum[i] ?? 0,
    hi: f.daily.temperature_2m_max[i],
    lo: f.daily.temperature_2m_min[i],
    code: f.daily.weather_code?.[i],
    far: i >= CERTAIN_DAYS,
  }));
  const total7 = days.slice(0, CERTAIN_DAYS).reduce((s, d) => s + d.snow, 0);
  const total14 = days.reduce((s, d) => s + d.snow, 0);
  const max = Math.max(...days.map(d => d.snow));
  const scaleMax = Math.max(max, units === 'in' ? 2.54 * 2 : 5); // keep light snow looking light
  const peakIndex = max > 0 ? days.findIndex(d => d.snow === max) : -1;

  forecastEl.innerHTML = '';

  // Totals
  const totals = document.createElement('div');
  totals.className = 'totals';
  for (const [label, value] of [['Next 7 days', total7], [`Next ${days.length} days`, total14]]) {
    const t = document.createElement('div');
    t.className = 'total';
    t.innerHTML = `<div class="num"></div><div class="lbl"></div>`;
    t.querySelector('.num').innerHTML = `${fmtSnow(value)}<small>${unitLabel()}</small>`;
    t.querySelector('.lbl').textContent = label;
    totals.append(t);
  }
  forecastEl.append(totals);

  // Chart
  const chart = document.createElement('div');
  chart.className = 'chart';
  const bars = document.createElement('div');
  bars.className = 'bars';
  const axis = document.createElement('div');
  axis.className = 'axis';
  axis.setAttribute('aria-hidden', 'true');
  const detail = document.createElement('div');
  detail.className = 'day-detail';

  const describe = d => {
    const date = d.date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
    return `<b>${date}</b> · ${fmtSnow(d.snow, { withUnit: true })} snow · ` +
      `${fmtTemp(d.lo)} / ${fmtTemp(d.hi)} · ${describeWeather(d.code)}` +
      (d.far ? ' · <i>less certain</i>' : '');
  };
  const defaultDetail = peakIndex >= 0
    ? `Most snow: ${describe(days[peakIndex])}`
    : 'No snow in the forecast for the next two weeks.';
  detail.innerHTML = defaultDetail;

  days.forEach((d, i) => {
    const col = document.createElement('button');
    col.type = 'button';
    col.className = 'day' + (d.far ? ' far' : '') + (i === peakIndex ? ' peak' : '');
    col.setAttribute('aria-label', describe(d).replace(/<[^>]+>/g, ''));
    if (d.snow > 0) {
      const val = document.createElement('span');
      val.className = 'val';
      val.textContent = fmtSnow(d.snow);
      col.append(val);
      const bar = document.createElement('span');
      bar.className = 'bar';
      bar.style.height = `${Math.max(2, (d.snow / scaleMax) * 128)}px`;
      col.append(bar);
    }
    const show = () => { detail.innerHTML = describe(d); };
    col.addEventListener('pointerenter', show);
    col.addEventListener('focus', show);
    col.addEventListener('pointerleave', () => { detail.innerHTML = defaultDetail; });
    col.addEventListener('blur', () => { detail.innerHTML = defaultDetail; });
    bars.append(col);

    const tick = document.createElement('div');
    const dow = d.date.getDay();
    if (dow === 0 || dow === 6) tick.className = 'weekend';
    tick.innerHTML = `<b>${d.date.toLocaleDateString(undefined, { weekday: 'narrow' })}</b>${d.date.getDate()}`;
    axis.append(tick);
  });

  chart.append(bars, axis);
  const key = document.createElement('div');
  key.className = 'chart-key';
  key.innerHTML = `<span><i style="background:var(--snow)"></i>Days 1–${CERTAIN_DAYS}</span>` +
    `<span><i style="background:var(--snow-far)"></i>Days ${CERTAIN_DAYS + 1}–${days.length}, less certain</span>`;
  chart.append(key);
  forecastEl.append(chart, detail);

  // Table view of the same numbers
  const details = document.createElement('details');
  details.className = 'table-view';
  details.innerHTML = `<summary>Show as table</summary>
    <table><thead><tr><th>Day</th><th>Snow (${unitLabel()})</th><th>Low</th><th>High</th><th>Conditions</th></tr></thead><tbody></tbody></table>`;
  const tbody = details.querySelector('tbody');
  for (const d of days) {
    const tr = document.createElement('tr');
    for (const text of [
      d.date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
      fmtSnow(d.snow), fmtTemp(d.lo), fmtTemp(d.hi), describeWeather(d.code),
    ]) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.append(td);
    }
    tbody.append(tr);
  }
  forecastEl.append(details);

  // Source line
  const when = f.fetchedAt.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const elev = f.elevation != null
    ? ` at ${units === 'in' ? Math.round(f.elevation * 3.281).toLocaleString() + ' ft' : Math.round(f.elevation).toLocaleString() + ' m'}`
    : '';
  document.getElementById('panel-source').innerHTML =
    `Forecast${elev} from <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>, ` +
    (f.live ? `updated ${when}.` : `saved snapshot from ${when}.`) +
    ' Mountain snowfall varies a lot with elevation; treat these as estimates.';
}

// --- Panel controls ---------------------------------------------------------------
function closePanel() {
  panel.hidden = true;
  requestId++;
  document.querySelectorAll('.badge.selected').forEach(b => b.classList.remove('selected'));
}
document.getElementById('panel-close').addEventListener('click', closePanel);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) closePanel(); });

function setUnits(u) {
  units = u;
  try { localStorage.setItem('ski-globe-units', u); } catch {}
  document.getElementById('unit-in').setAttribute('aria-pressed', String(u === 'in'));
  document.getElementById('unit-cm').setAttribute('aria-pressed', String(u === 'cm'));
  renderForecast();
}
document.getElementById('unit-in').addEventListener('click', () => setUnits('in'));
document.getElementById('unit-cm').addEventListener('click', () => setUnits('cm'));
setUnits(units);
