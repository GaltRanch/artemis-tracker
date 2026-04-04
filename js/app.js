/**
 * Main application — Artemis Mission Tracker
 * Integrates: JPL Horizons, DSN Now, DONKI Space Weather, NASA Images
 */

const MISSION = {
  name: 'Artemis II',
  horizonsId: '-1024',
  launchDate: '2026-04-01T22:35:12Z',
  durationDays: 10,
  maxDistanceKm: 400171,
  lunarFlybyDistanceKm: 6513,
  lunarFlybyProgress: 0.55,
};

// ===== Init =====
const telemetry = new TelemetryEngine(MISSION);
const dataSources = new NASADataSources();

// 3D trajectory with WebGL detection + 2D canvas fallback
let trajectory3d = null;
let trajectory2d = null;
let vizInitDone = false;

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl'));
  } catch (e) { return false; }
}

function initViz() {
  if (vizInitDone) return;

  const container = document.getElementById('trajectory-3d');
  if (!container) return;

  if (hasWebGL() && window.Trajectory3D) {
    try {
      trajectory3d = new Trajectory3D('trajectory-3d');
      vizInitDone = true;
      console.log('[Viz] 3D initialized (WebGL)');
    } catch (err) {
      console.warn('[Viz] 3D failed, falling back to 2D:', err.message);
      initFallback2D(container);
    }
  } else if (!hasWebGL()) {
    console.log('[Viz] No WebGL — using 2D canvas fallback');
    initFallback2D(container);
  }
  // else: Trajectory3D not loaded yet, will retry
}

function initFallback2D(container) {
  if (vizInitDone) return;
  vizInitDone = true; // prevent double init

  // Create canvas matching container size
  const h = container.clientHeight || 420;
  container.innerHTML = `<canvas id="trajectory-canvas" style="width:100%;height:${h}px;display:block"></canvas>`;

  // Load 2D renderer script
  if (window.TrajectoryRenderer) {
    trajectory2d = new TrajectoryRenderer('trajectory-canvas');
    console.log('[Viz] 2D canvas fallback initialized');
  } else {
    const script = document.createElement('script');
    script.src = 'js/trajectory.js';
    script.onload = () => {
      if (window.TrajectoryRenderer) {
        trajectory2d = new TrajectoryRenderer('trajectory-canvas');
        console.log('[Viz] 2D canvas fallback initialized (async)');
      }
    };
    document.head.appendChild(script);
  }
}

window.addEventListener('trajectory3d-ready', initViz);
setTimeout(initViz, 500);
setTimeout(initViz, 2000);

const $ = (id) => document.getElementById(id);
const dom = {
  met: $('met-clock'), phase: $('mission-phase'), date: $('current-date'),
  distEarth: $('dist-earth'), distMoon: $('dist-moon'),
  velocity: $('velocity'), rangeRate: $('range-rate'),
  ra: $('ra'), dec: $('dec'),
  constellation: $('constellation'), lightTime: $('light-time'), distSun: $('dist-sun'),
  dataSource: $('data-source'),
  dsnStatus: $('dsn-status'), dsnGrid: $('dsn-grid'),
  swRisk: $('sw-risk'), swDetails: $('sw-details'),
  gallery: $('gallery'),
  epicGrid: $('epic-grid'),
  apodContent: $('apod-content'),
  neoSummary: $('neo-summary'), neoTable: $('neo-table'),
};

function fmt(n) { return n.toLocaleString('es-ES'); }

// ===== Widgets =====
const dsnMap = new DSNMap('dsn-map-canvas');
const radGauge = new RadiationGauge('radiation-gauge');
// earthView removed — not real data
const neoRadar = new NEORadar('neo-radar-canvas');
const swTimeline = new SpaceWeatherTimeline('sw-timeline');
renderCrewFirsts('crew-firsts');

// ===== Timeline =====
function updateTimeline(elapsedSeconds) {
  const events = document.querySelectorAll('.tl-event');
  const mets = Array.from(events).map(e => parseInt(e.dataset.met, 10));
  events.forEach((ev, i) => {
    ev.classList.remove('completed', 'active', 'upcoming');
    const next = mets[i + 1] ?? Infinity;
    if (elapsedSeconds >= next) ev.classList.add('completed');
    else if (elapsedSeconds >= mets[i]) ev.classList.add('active');
    else ev.classList.add('upcoming');
  });
}

// ===== DSN Renderer =====
function renderDSN() {
  const dsn = dataSources.dsn;
  if (!dsn) { dom.dsnStatus.textContent = 'Conectando con DSN...'; return; }

  if (dsn.em2Dishes.length === 0) {
    dom.dsnStatus.innerHTML = '<span style="color:var(--text-muted)">Ninguna antena DSN trackeando a Orion en este momento</span>';
    dom.dsnGrid.innerHTML = '';
    return;
  }

  dom.dsnStatus.innerHTML =
    `<strong>${dsn.dishCount}</strong> antena${dsn.dishCount > 1 ? 's' : ''} en ` +
    `<strong>${dsn.stationsTracking.join(', ')}</strong> · ` +
    `Bandas: ${dsn.bands.join(', ')} · ` +
    `Rango: ${dsn.range ? fmt(Math.round(dsn.range)) + ' km' : '--'} · ` +
    `RTLT: ${dsn.rtlt ? dsn.rtlt.toFixed(2) + 's' : '--'} · ` +
    `Data rate: ${dsn.maxDataRate > 0 ? fmtDataRate(dsn.maxDataRate) : '--'}`;

  dom.dsnGrid.innerHTML = dsn.em2Dishes.map(d => {
    const activeUp = d.signals.filter(s => s.active && s.direction === 'up');
    const activeDown = d.signals.filter(s => s.active && s.direction === 'down');
    const target = d.targets.find(t => t.name === 'EM2');

    return `<div class="dsn-dish active">
      <div class="dish-name">${d.name}</div>
      <div class="dish-station">${d.station}</div>
      <div class="dish-detail">
        Az: ${d.azimuth.toFixed(1)}° · El: ${d.elevation.toFixed(1)}°
        ${target ? `<br>Rango: ${fmt(Math.round(target.downlegRange))} km` : ''}
      </div>
      ${activeUp.map(s => `<span class="dish-signal up">↑ ${s.band}-band ${s.power > 0 ? s.power.toFixed(1) + ' dBm' : ''}</span>`).join(' ')}
      ${activeDown.map(s => `<span class="dish-signal down">↓ ${s.band}-band ${s.dataRate > 0 ? fmtDataRate(s.dataRate) : ''}</span>`).join(' ')}
    </div>`;
  }).join('');
}

function fmtDataRate(bps) {
  if (bps >= 1e6) return (bps / 1e6).toFixed(1) + ' Mbps';
  if (bps >= 1e3) return (bps / 1e3).toFixed(0) + ' kbps';
  return bps + ' bps';
}

// ===== Space Weather Renderer =====
function renderSpaceWeather() {
  const sw = dataSources.spaceWeather;
  if (!sw) { dom.swRisk.textContent = 'Cargando...'; return; }

  dom.swRisk.className = `sw-risk ${sw.riskColor}`;
  dom.swRisk.textContent = `RIESGO RADIACION: ${sw.riskLevel}`;

  let html = '';

  // Flares
  if (sw.flares.length > 0) {
    html += `<div style="margin-bottom:0.4rem"><strong>Llamaradas solares (7 dias):</strong> `;
    html += sw.flares.slice(0, 8).map(f => {
      const cls = f.classType?.[0]?.toLowerCase() || 'c';
      return `<span class="sw-flare ${cls}">${f.classType}</span>`;
    }).join('');
    html += `</div>`;
  }

  // Storms
  if (sw.storms.length > 0) {
    html += `<div style="margin-bottom:0.4rem"><strong>Tormentas geomagneticas:</strong> `;
    html += sw.storms.map(s => {
      const level = s.maxKp >= 7 ? 'G3+' : s.maxKp >= 6 ? 'G2' : s.maxKp >= 5 ? 'G1' : 'Menor';
      return `${level} (Kp ${s.maxKp.toFixed(1)}) — ${new Date(s.start).toLocaleDateString('es-ES')}`;
    }).join(', ');
    html += `</div>`;
  }

  // CME
  if (sw.cmeCount > 0) {
    html += `<div><strong>Eyecciones de masa coronal:</strong> ${sw.cmeCount} en los ultimos 7 dias</div>`;
  }

  // RBE
  if (sw.rbeCount > 0) {
    html += `<div style="margin-bottom:0.4rem"><strong>Radiacion cinturones Van Allen:</strong> ${sw.rbeCount} eventos de enhancement`;
    if (sw.rbeEvents.length > 0) html += ` — ultimo: ${new Date(sw.rbeEvents[sw.rbeEvents.length-1].time).toLocaleString('es-ES')}`;
    html += `</div>`;
  }

  // IPS
  if (sw.ipsEvents?.length > 0) {
    html += `<div style="margin-bottom:0.4rem"><strong>Choques interplanetarios:</strong> ${sw.ipsEvents.length} detectados — `;
    html += sw.ipsEvents.map(i => `${i.location} (${new Date(i.time).toLocaleDateString('es-ES')})`).join(', ');
    html += `</div>`;
  }

  dom.swDetails.innerHTML = html || '<div>Sin eventos significativos</div>';
}

// ===== Gallery Renderer =====
function renderGallery() {
  const imgs = dataSources.images;
  if (!imgs || imgs.length === 0) { dom.gallery.textContent = 'Cargando fotos...'; return; }

  dom.gallery.innerHTML = imgs.map(img => `
    <a class="gallery-item" href="${img.medium || img.thumb}" target="_blank" rel="noopener">
      <img src="${img.thumb}" alt="${img.title || ''}" loading="lazy">
      <div class="gi-info">
        <div class="gi-title">${img.title || ''}</div>
        <div class="gi-date">${img.date ? new Date(img.date).toLocaleDateString('es-ES') : ''} · ${img.photographer || 'NASA'}</div>
      </div>
    </a>
  `).join('');
}

// ===== Main update loop =====
function update() {
  const t = telemetry.getTelemetry();

  dom.met.textContent = t.met.formatted;
  dom.phase.textContent = t.phase;
  dom.date.textContent = new Date().toLocaleString('es-ES', {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });

  dom.distEarth.textContent = fmt(t.distEarth);
  dom.distMoon.textContent = fmt(t.distMoon);
  dom.velocity.textContent = fmt(t.velocity);
  dom.rangeRate.textContent = t.rangeRate;
  dom.ra.textContent = t.ra;
  dom.dec.textContent = t.dec;
  dom.constellation.textContent = t.constellation;
  dom.lightTime.textContent = t.lightTime;
  dom.distSun.textContent = t.distSun;

  dom.dataSource.textContent = `Fuente: ${t.dataSource}`;
  dom.dataSource.classList.toggle('error', !t.dataSource.includes('Horizons'));

  // Trajectory visualization (3D or 2D fallback)
  if (!vizInitDone) initViz();
  if (trajectory3d) trajectory3d.update(t.met.progress, MISSION);
  else if (trajectory2d) trajectory2d.draw(t.met.progress, MISSION, t);

  updateTimeline(t.met.elapsedSeconds);
}

// ===== EPIC Renderer =====
function renderEPIC() {
  const epic = dataSources.epic;
  if (!epic || epic.length === 0) return;

  dom.epicGrid.innerHTML = epic.map(img => `
    <a class="epic-item" href="${img.urlFull}" target="_blank" rel="noopener">
      <img src="${img.url}" alt="Earth from DSCOVR" loading="lazy">
      <div class="ei-date">${img.date}</div>
    </a>
  `).join('');
}

// ===== APOD Renderer =====
function renderAPOD() {
  const apod = dataSources.apod;
  if (!apod) return;

  if (apod.mediaType === 'image') {
    dom.apodContent.innerHTML = `
      <div class="apod-wrap">
        <a href="${apod.hdurl || apod.url}" target="_blank" rel="noopener">
          <img src="${apod.url}" alt="${apod.title}" loading="lazy">
        </a>
        <div class="apod-title">${apod.title}</div>
        <div class="apod-date">${apod.date}</div>
        <div class="apod-text">${apod.explanation}</div>
      </div>`;
  } else {
    dom.apodContent.innerHTML = `
      <div class="apod-wrap">
        <div class="apod-title">${apod.title}</div>
        <div class="apod-date">${apod.date}</div>
        <div class="apod-text">${apod.explanation}</div>
        <a href="${apod.url}" target="_blank" rel="noopener" style="color:var(--accent-cyan);font-size:0.7rem">Ver contenido</a>
      </div>`;
  }
}

// ===== NEO Renderer =====
function renderNEO() {
  const neo = dataSources.neo;
  if (!neo) return;

  dom.neoSummary.innerHTML = `
    <div class="neo-stat safe"><span class="ns-val">${neo.count}</span><span class="ns-label">objetos<br>cercanos hoy</span></div>
    <div class="neo-stat ${neo.hazardous > 0 ? 'danger' : 'safe'}"><span class="ns-val">${neo.hazardous}</span><span class="ns-label">potencialmente<br>peligrosos</span></div>
    <div class="neo-stat ${neo.sentry > 0 ? 'warn' : 'safe'}"><span class="ns-val">${neo.sentry}</span><span class="ns-label">monitoreados<br>(Sentry)</span></div>
  `;

  if (neo.objects.length > 0) {
    dom.neoTable.innerHTML = `
      <thead><tr>
        <th>Nombre</th><th>Diametro</th><th>Velocidad</th><th>Distancia</th><th>Dist. Lunar</th><th>Riesgo</th>
      </tr></thead>
      <tbody>${neo.objects.map(n => `
        <tr>
          <td>${n.name}</td>
          <td>${n.diameter}</td>
          <td>${n.velocity} km/h</td>
          <td>${n.missDistance} km</td>
          <td>${n.missDistanceLunar} LD</td>
          <td class="${n.hazardous ? 'hazardous' : 'safe'}">${n.hazardous ? 'PELIGROSO' : 'Seguro'}</td>
        </tr>
      `).join('')}</tbody>`;
  }
}

// ===== Slow update loop =====
function updateExtras() {
  const t = telemetry.getTelemetry();

  renderDSN();
  renderSpaceWeather();
  renderEPIC();
  renderAPOD();
  renderNEO();
  renderGallery();

  // Canvas widgets
  dsnMap.draw(dataSources.dsn);
  radGauge.draw(dataSources.spaceWeather, t.distEarth);
  swTimeline.draw(dataSources.spaceWeather, MISSION.launchDate);
  neoRadar.draw(dataSources.neo);

}

update();
setInterval(update, 1000);
setTimeout(updateExtras, 3000); // initial delay for data to load
setInterval(updateExtras, 15000); // refresh rendering every 15s

// ===== API Key Setup UI =====

const apiSetup = $('api-setup');
const apiInput = $('api-key-input');
const apiSaveBtn = $('api-key-save');
const apiSkipBtn = $('api-key-skip');
const apiSettingsBtn = $('api-settings-btn');

// Check if API key is configured on server
async function checkApiConfig() {
  try {
    const resp = await fetch('/api/config');
    const data = await resp.json();
    if (data.configured) {
      apiSettingsBtn.classList.add('configured');
      apiSettingsBtn.title = `NASA API Key: ${data.keyPreview}`;
    } else {
      // Show setup modal on first visit if no key and not dismissed
      if (!localStorage.getItem('artemis-api-dismissed')) {
        apiSetup.style.display = 'flex';
      }
    }
  } catch (e) { /* server not reachable */ }
}

// Enable save button when input has content
apiInput?.addEventListener('input', () => {
  apiSaveBtn.disabled = apiInput.value.trim().length < 10;
});

// Save API key
apiSaveBtn?.addEventListener('click', async () => {
  const key = apiInput.value.trim();
  if (key.length < 10) return;

  apiSaveBtn.textContent = 'Conectando...';
  apiSaveBtn.disabled = true;

  try {
    const resp = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: key }),
    });
    const data = await resp.json();

    if (data.ok) {
      apiSetup.style.display = 'none';
      apiSettingsBtn.classList.add('configured');
      apiSettingsBtn.title = `NASA API Key: ${key.slice(0, 6)}...`;
      localStorage.setItem('artemis-api-key', key);
      // Refresh data sources with new key
      dataSources.fetchAll();
    } else {
      apiSaveBtn.textContent = 'Error — intentar de nuevo';
      apiSaveBtn.disabled = false;
    }
  } catch (e) {
    apiSaveBtn.textContent = 'Error de conexion';
    apiSaveBtn.disabled = false;
  }
});

// Skip — use DEMO_KEY
apiSkipBtn?.addEventListener('click', () => {
  apiSetup.style.display = 'none';
  localStorage.setItem('artemis-api-dismissed', '1');
});

// Settings button — reopen modal
apiSettingsBtn?.addEventListener('click', () => {
  apiSetup.style.display = 'flex';
  // Pre-fill if we have a stored key
  const stored = localStorage.getItem('artemis-api-key');
  if (stored && apiInput) apiInput.value = stored;
});

// Check on load
checkApiConfig();
