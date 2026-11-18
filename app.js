// A basic interactive globe.
// Drag to rotate, scroll (or pinch) to zoom.

const IMG = 'https://cdn.jsdelivr.net/npm/three-globe@2.45.0/example/img';

const globe = Globe()(document.getElementById('globe'))
  .globeImageUrl(`${IMG}/earth-blue-marble.jpg`)    // satellite-style Earth texture
  .bumpImageUrl(`${IMG}/earth-topology.png`)        // adds subtle relief to mountains
  .backgroundImageUrl(`${IMG}/night-sky.png`);      // starry background

// Start looking at the Alps.
globe.pointOfView({ lat: 46, lng: 10, altitude: 2 });

// Slowly spin the globe until the user grabs it.
globe.controls().autoRotate = true;
globe.controls().autoRotateSpeed = 0.4;

// Keep the globe sized to the window.
window.addEventListener('resize', () => {
  globe.width(window.innerWidth).height(window.innerHeight);
});
