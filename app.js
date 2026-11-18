// A basic interactive topographic globe.
// Drag to rotate, scroll (or pinch) to zoom.

const globe = Globe()(document.getElementById('globe'))
  .globeImageUrl('img/earth-winter.jpg')       // our wintery topographic map (see tools/make_topo_texture.py)
  .bumpImageUrl('img/earth-topology.png')      // elevation map: makes mountains catch the light
  .backgroundImageUrl('img/night-sky.png')     // starry background
  .atmosphereColor('#d6ecff')                  // soft pale-blue halo around the globe
  .atmosphereAltitude(0.18);

// Start looking at the Alps.
globe.pointOfView({ lat: 46, lng: 10, altitude: 2 });

// Slowly spin the globe until the user grabs it (unless they prefer reduced motion).
globe.controls().autoRotate = !matchMedia('(prefers-reduced-motion: reduce)').matches;
globe.controls().autoRotateSpeed = 0.4;

// Keep the globe sized to the window.
window.addEventListener('resize', () => {
  globe.width(window.innerWidth).height(window.innerHeight);
});
