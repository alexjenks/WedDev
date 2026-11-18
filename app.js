// A wintery topographic globe with a logo badge for every Ikon Pass resort.
// Drag to rotate, scroll (or pinch) to zoom, hover a badge to see its name.

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

  // globe.gl moves markers by setting their CSS transform, so give it a plain
  // wrapper to move and keep the badge's own hover zoom separate.
  const wrapper = document.createElement('div');
  wrapper.className = 'badge-anchor';
  wrapper.append(el);
  return wrapper;
}

fetch('data/ikon-resorts.json')
  .then(res => res.json())
  .then(({ resorts }) => {
    globe
      .htmlElementsData(resorts)
      .htmlLat('lat')
      .htmlLng('lng')
      .htmlAltitude(0.005)
      .htmlElement(makeBadge);
  })
  .catch(err => console.error('Could not load Ikon resorts:', err));

// Stop the spin as soon as someone points at a badge, so it doesn't slide away.
document.getElementById('globe').addEventListener('pointerover', e => {
  if (e.target.closest('.badge')) globe.controls().autoRotate = false;
});
