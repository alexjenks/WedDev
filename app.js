// A wintery topographic globe with a logo badge for every Ikon Pass resort.
// Drag to rotate, scroll (or pinch) to zoom, hover a badge to see its name.
// Nearby resorts merge into a numbered bubble when zoomed out; click it to zoom in.

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
  `https://www.google.com/s2/favicons?domain=${resort.domain}&sz=128`,      // the resort website's icon
];

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
  globe.pointOfView({ lat: cluster.lat, lng: cluster.lng, altitude: target }, 1200);
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
