/**
 * Main application — Artemis Mission Tracker
 * Configurable per mission (Artemis II, III, IV, V...)
 */

// ===== MISSION CONFIG =====
// Change this object for each Artemis mission
const MISSION = {
  name: 'Artemis II',
  launchDate: '2026-04-02T13:00:00Z', // April 2, 2026 — adjust to actual launch time
  durationDays: 10,
  maxDistanceKm: 380000,
  lunarFlybyDistanceKm: 8900,
  lunarFlybyProgress: 0.42, // ~day 4 of 10
};

// ===== INIT =====
const telemetryEngine = new TelemetryEngine(MISSION);
const trajectoryRenderer = new TrajectoryRenderer('trajectory-canvas');

// ===== DOM refs =====
const $met = document.getElementById('met-clock');
const $phase = document.getElementById('mission-phase');
const $dateDisplay = document.getElementById('current-date-display');
const $distEarth = document.getElementById('dist-earth');
const $distMoon = document.getElementById('dist-moon');
const $velocity = document.getElementById('velocity');
const $altitude = document.getElementById('altitude');
const $acceleration = document.getElementById('acceleration');
const $tempExt = document.getElementById('temp-ext');

// ===== Number formatting =====
function formatNumber(n) {
  return n.toLocaleString('es-ES');
}

// ===== Update loop =====
function update() {
  const telem = telemetryEngine.getTelemetry();

  // MET clock
  $met.textContent = telem.met.formatted;

  // Phase
  $phase.textContent = telem.phase;

  // Date
  $dateDisplay.textContent = new Date().toLocaleString('es-ES', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  // Telemetry values
  $distEarth.textContent = formatNumber(telem.distEarth);
  $distMoon.textContent = formatNumber(telem.distMoon);
  $velocity.textContent = formatNumber(telem.velocity);
  $altitude.textContent = formatNumber(telem.altitude);
  $acceleration.textContent = telem.acceleration;
  $tempExt.textContent = telem.tempExt;

  // Trajectory canvas
  trajectoryRenderer.draw(telem.met.progress, MISSION);

  // Update timeline active states
  updateTimeline(telem.met.progress);
}

// ===== Timeline updater =====
function updateTimeline(progress) {
  const events = document.querySelectorAll('.timeline-event');
  const thresholds = [0, 0.005, 0.015, 0.40, 0.44, 0.50, 0.95];

  events.forEach((ev, i) => {
    ev.classList.remove('completed', 'active', 'upcoming');
    if (progress >= (thresholds[i + 1] || 1)) {
      ev.classList.add('completed');
    } else if (progress >= thresholds[i]) {
      ev.classList.add('active');
    } else {
      ev.classList.add('upcoming');
    }
  });
}

// ===== Run =====
update();
setInterval(update, 1000);

// Responsive canvas redraw
window.addEventListener('resize', () => {
  const telem = telemetryEngine.getTelemetry();
  trajectoryRenderer.draw(telem.met.progress, MISSION);
});
