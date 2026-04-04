/**
 * Mission dashboard widgets:
 * - DSN World Map with signal arcs
 * - Radiation Gauge
 * - Space Weather Timeline
 * - Crew Firsts
 * - Earth View Simulator
 * - NEO Proximity Radar
 * - Apollo 13 vs Artemis II comparison
 */

// ===== 1. DSN WORLD MAP =====

class DSNMap {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.dpr = window.devicePixelRatio || 1;
    this._frame = 0;
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    if (!this.canvas) return;
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = r.width * this.dpr;
    this.canvas.height = r.height * this.dpr;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.w = r.width;
    this.h = r.height;
  }

  // Station coordinates (lon, lat) → canvas position
  _project(lon, lat) {
    const x = (lon + 180) / 360 * this.w;
    const y = (90 - lat) / 180 * this.h;
    return { x, y };
  }

  draw(dsnData) {
    if (!this.canvas) return;
    const ctx = this.ctx;
    const w = this.w, h = this.h;
    this._frame++;
    ctx.clearRect(0, 0, w, h);

    // Dark world outline
    this._drawWorldOutline(ctx, w, h);

    // Stations
    const stations = [
      { name: 'Goldstone', code: 'gdscc', lon: -116.89, lat: 35.43, color: '#3b82f6' },
      { name: 'Madrid', code: 'mdscc', lon: -4.25, lat: 40.43, color: '#f97316' },
      { name: 'Canberra', code: 'cdscc', lon: 148.98, lat: -35.40, color: '#22c55e' },
    ];

    const activeStations = dsnData ? dsnData.stationsTracking || [] : [];

    for (const s of stations) {
      const p = this._project(s.lon, s.lat);
      const isActive = activeStations.some(a => a.toLowerCase().includes(s.name.toLowerCase()));

      // Station dot
      if (isActive) {
        // Animated signal pulse
        const pulse = 8 + 4 * Math.sin(this._frame * 0.05);
        ctx.beginPath();
        ctx.arc(p.x, p.y, pulse, 0, Math.PI * 2);
        ctx.fillStyle = s.color + '15';
        ctx.fill();

        // Signal arc to center (representing Orion in space)
        const cx = w / 2, cy = h * 0.15;
        this._drawSignalArc(ctx, p.x, p.y, cx, cy, s.color, this._frame);
      }

      // Dot
      ctx.beginPath();
      ctx.arc(p.x, p.y, isActive ? 5 : 3, 0, Math.PI * 2);
      ctx.fillStyle = isActive ? s.color : '#334466';
      ctx.fill();

      if (isActive) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
        ctx.strokeStyle = s.color + '60';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Label
      ctx.fillStyle = isActive ? s.color : '#4a5568';
      ctx.font = `${isActive ? '700' : '500'} 8px "Orbitron", monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(s.name.toUpperCase(), p.x, p.y + 14);
    }

    // Orion indicator at top
    const ox = w / 2, oy = h * 0.12;
    ctx.fillStyle = '#f97316';
    ctx.beginPath();
    ctx.arc(ox, oy, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f9731680';
    ctx.font = '700 7px "Orbitron", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('ORION EM2', ox, oy - 8);

    // Range info
    if (dsnData?.range) {
      ctx.fillStyle = '#64748b';
      ctx.font = '500 8px "Inter", sans-serif';
      ctx.fillText(`${Math.round(dsnData.range).toLocaleString('es-ES')} km · RTLT ${dsnData.rtlt?.toFixed(2) || '--'}s`, ox, oy + 12);
    }
  }

  _drawWorldOutline(ctx, w, h) {
    // Simplified continent outlines (rectangles for major landmasses)
    ctx.fillStyle = '#0a1225';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = '#141e3a';
    ctx.lineWidth = 0.5;
    // Grid lines
    for (let lon = -180; lon <= 180; lon += 30) {
      const p = this._project(lon, 0);
      ctx.beginPath(); ctx.moveTo(p.x, 0); ctx.lineTo(p.x, h); ctx.stroke();
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      const p = this._project(0, lat);
      ctx.beginPath(); ctx.moveTo(0, p.y); ctx.lineTo(w, p.y); ctx.stroke();
    }

    // Equator
    ctx.strokeStyle = '#1a2744';
    ctx.lineWidth = 0.8;
    const eq = this._project(0, 0);
    ctx.beginPath(); ctx.moveTo(0, eq.y); ctx.lineTo(w, eq.y); ctx.stroke();
  }

  _drawSignalArc(ctx, x1, y1, x2, y2, color, frame) {
    ctx.save();
    ctx.setLineDash([3, 6]);
    ctx.lineDashOffset = -frame * 0.5;
    ctx.strokeStyle = color + '40';
    ctx.lineWidth = 1;

    const cpx = (x1 + x2) / 2;
    const cpy = Math.min(y1, y2) - 20;

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo(cpx, cpy, x2, y2);
    ctx.stroke();
    ctx.restore();
  }
}

// ===== 2. RADIATION GAUGE =====

class RadiationGauge {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.dpr = window.devicePixelRatio || 1;
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    if (!this.canvas) return;
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = r.width * this.dpr;
    this.canvas.height = r.height * this.dpr;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.w = r.width;
    this.h = r.height;
  }

  draw(spaceWeather, distEarth) {
    if (!this.canvas) return;
    const ctx = this.ctx;
    const w = this.w, h = this.h;
    ctx.clearRect(0, 0, w, h);

    const cx = w / 2, cy = h * 0.55;
    const radius = Math.min(w, h) * 0.35;

    // Determine risk level (0-1)
    let riskValue = 0.1; // baseline
    if (spaceWeather) {
      if (spaceWeather.riskColor === 'orange') riskValue = 0.5;
      if (spaceWeather.riskColor === 'red') riskValue = 0.8;
      // Van Allen belt zone (2,000 - 60,000 km from Earth)
      if (distEarth > 2000 && distEarth < 60000) riskValue = Math.min(1, riskValue + 0.3);
    }

    // Arc background
    const startAngle = Math.PI * 0.8;
    const endAngle = Math.PI * 2.2;

    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, endAngle);
    ctx.strokeStyle = '#141e3a';
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Colored arc
    const valueAngle = startAngle + (endAngle - startAngle) * riskValue;
    const grad = ctx.createConicGradient(startAngle, cx, cy);
    grad.addColorStop(0, '#22c55e');
    grad.addColorStop(0.4, '#fbbf24');
    grad.addColorStop(0.7, '#f97316');
    grad.addColorStop(1, '#ef4444');

    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, valueAngle);
    ctx.strokeStyle = grad;
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Needle
    const needleAngle = valueAngle;
    const nx = cx + Math.cos(needleAngle) * (radius - 20);
    const ny = cy + Math.sin(needleAngle) * (radius - 20);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(nx, ny);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Center dot
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();

    // Labels
    const colors = { BAJO: '#22c55e', MODERADO: '#f97316', ALTO: '#ef4444' };
    const level = spaceWeather?.riskLevel || 'BAJO';
    ctx.fillStyle = colors[level] || '#22c55e';
    ctx.font = `900 ${Math.max(12, w * 0.08)}px "Orbitron", monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(level, cx, cy + radius * 0.5);

    ctx.fillStyle = '#64748b';
    ctx.font = '500 8px "Inter", sans-serif';
    ctx.fillText('RIESGO RADIACION', cx, cy + radius * 0.5 + 14);

    // Van Allen indicator
    if (distEarth > 0) {
      const inVanAllen = distEarth > 2000 && distEarth < 60000;
      ctx.fillStyle = inVanAllen ? '#ef4444' : '#22c55e';
      ctx.font = '600 7px "Orbitron", monospace';
      ctx.fillText(inVanAllen ? 'EN CINTURON VAN ALLEN' : 'FUERA DE VAN ALLEN', cx, cy - radius - 8);
    }

    // Scale labels
    ctx.fillStyle = '#4a5568';
    ctx.font = '500 7px "Inter", sans-serif';
    const lp = (angle) => ({
      x: cx + Math.cos(angle) * (radius + 14),
      y: cy + Math.sin(angle) * (radius + 14)
    });
    const p0 = lp(startAngle);
    ctx.textAlign = 'right';
    ctx.fillText('BAJO', p0.x, p0.y);
    const p1 = lp(endAngle);
    ctx.textAlign = 'left';
    ctx.fillText('CRITICO', p1.x, p1.y);
  }
}

// ===== 3. CREW FIRSTS =====

function renderCrewFirsts(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;

  const firsts = [
    { name: 'Victor Glover', achievement: 'Primera persona de color mas alla de orbita baja terrestre', icon: '🌍', color: '#3b82f6' },
    { name: 'Christina Koch', achievement: 'Primera mujer en viajar mas alla de orbita baja terrestre', icon: '👩‍🚀', color: '#a855f7' },
    { name: 'Jeremy Hansen', achievement: 'Primer no-estadounidense mas alla de orbita baja terrestre', icon: '🇨🇦', color: '#22c55e' },
    { name: 'Reid Wiseman', achievement: 'Persona de mayor edad en viajar a la Luna', icon: '🚀', color: '#f97316' },
    { name: 'Tripulacion', achievement: 'Primeros humanos mas alla de LEO desde Apollo 17 (1972) — 54 anos', icon: '🌙', color: '#fbbf24' },
  ];

  el.innerHTML = firsts.map(f => `
    <div class="first-item" style="border-left: 2px solid ${f.color}">
      <div class="first-icon">${f.icon}</div>
      <div class="first-info">
        <div class="first-name" style="color:${f.color}">${f.name}</div>
        <div class="first-desc">${f.achievement}</div>
      </div>
    </div>
  `).join('');
}

// ===== 4. EARTH VIEW SIMULATOR =====

class EarthViewSim {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.dpr = window.devicePixelRatio || 1;
    this._img = new Image();
    this._img.crossOrigin = 'anonymous';
    this._imgLoaded = false;
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    if (!this.canvas) return;
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = r.width * this.dpr;
    this.canvas.height = r.height * this.dpr;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.w = r.width;
    this.h = r.height;
  }

  setEpicImage(url) {
    if (this._img.src === url) return;
    this._img.src = url;
    this._img.onload = () => { this._imgLoaded = true; };
  }

  draw(distEarthKm) {
    if (!this.canvas) return;
    const ctx = this.ctx;
    const w = this.w, h = this.h;
    ctx.clearRect(0, 0, w, h);

    // Black space
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);

    if (!distEarthKm || distEarthKm <= 0) return;

    // Angular diameter of Earth from Orion's distance
    // Earth radius = 6371 km
    // Angular diameter = 2 * atan(6371 / dist) in radians
    const angularRad = 2 * Math.atan(6371 / distEarthKm);
    const angularDeg = angularRad * (180 / Math.PI);

    // Map to canvas: at ISS distance (~400km) Earth fills view (~140°)
    // At Moon distance (~384400km) Earth is ~1.9°
    // Scale: we want Earth visible, so map 0-180° to 0-canvas
    const maxViewAngle = 40; // degrees field of view
    const earthSizePx = (angularDeg / maxViewAngle) * Math.min(w, h);

    const cx = w / 2, cy = h / 2;

    if (this._imgLoaded) {
      // Draw Earth photo
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, earthSizePx / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(this._img, cx - earthSizePx / 2, cy - earthSizePx / 2, earthSizePx, earthSizePx);
      ctx.restore();

      // Atmosphere glow
      const glow = ctx.createRadialGradient(cx, cy, earthSizePx / 2, cx, cy, earthSizePx / 2 + 8);
      glow.addColorStop(0, 'rgba(96,165,250,0.15)');
      glow.addColorStop(1, 'transparent');
      ctx.beginPath();
      ctx.arc(cx, cy, earthSizePx / 2 + 8, 0, Math.PI * 2);
      ctx.fillStyle = glow;
      ctx.fill();
    } else {
      // Fallback blue circle
      ctx.beginPath();
      ctx.arc(cx, cy, earthSizePx / 2, 0, Math.PI * 2);
      ctx.fillStyle = '#2563eb';
      ctx.fill();
    }

    // Info text
    ctx.fillStyle = '#64748b';
    ctx.font = '500 9px "Inter", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`Vista desde Orion a ${Math.round(distEarthKm).toLocaleString('es-ES')} km`, cx, h - 24);
    ctx.fillText(`Diametro angular: ${angularDeg.toFixed(2)}°`, cx, h - 12);
  }
}

// ===== 5. NEO RADAR =====

class NEORadar {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.dpr = window.devicePixelRatio || 1;
    this._frame = 0;
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    if (!this.canvas) return;
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = r.width * this.dpr;
    this.canvas.height = r.height * this.dpr;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.w = r.width;
    this.h = r.height;
  }

  draw(neoData) {
    if (!this.canvas || !neoData) return;
    const ctx = this.ctx;
    const w = this.w, h = this.h;
    this._frame++;
    ctx.clearRect(0, 0, w, h);

    const cx = w / 2, cy = h / 2;
    const maxR = Math.min(w, h) / 2 - 20;

    // Background
    ctx.fillStyle = '#050a14';
    ctx.fillRect(0, 0, w, h);

    // Radar circles (distance rings)
    const rings = [0.25, 0.5, 0.75, 1];
    const maxDistLD = 70; // max distance in lunar distances to show

    for (const ring of rings) {
      ctx.beginPath();
      ctx.arc(cx, cy, maxR * ring, 0, Math.PI * 2);
      ctx.strokeStyle = '#141e3a';
      ctx.lineWidth = 0.5;
      ctx.stroke();

      ctx.fillStyle = '#334466';
      ctx.font = '500 7px "Inter", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`${Math.round(maxDistLD * ring)} LD`, cx + maxR * ring + 3, cy - 2);
    }

    // Sweep line
    const sweepAngle = (this._frame * 0.02) % (Math.PI * 2);
    const sweepGrad = ctx.createConicalGradient
      ? null // not supported everywhere
      : null;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(sweepAngle) * maxR, cy + Math.sin(sweepAngle) * maxR);
    ctx.strokeStyle = '#06d6d620';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    // Earth at center
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#3b82f6';
    ctx.fill();
    ctx.fillStyle = '#3b82f680';
    ctx.font = '600 6px "Orbitron", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('TIERRA', cx, cy + 12);

    // Moon ring (~1 LD)
    const moonR = maxR * (1 / maxDistLD);
    ctx.beginPath();
    ctx.arc(cx, cy, moonR, 0, Math.PI * 2);
    ctx.strokeStyle = '#94a3b820';
    ctx.lineWidth = 0.5;
    ctx.setLineDash([2, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Plot NEOs
    if (neoData.objects) {
      for (let i = 0; i < neoData.objects.length; i++) {
        const neo = neoData.objects[i];
        const distLD = parseFloat(neo.missDistanceLunar) || 0;
        if (distLD <= 0 || distLD > maxDistLD) continue;

        const r = maxR * (distLD / maxDistLD);
        // Distribute around the circle using index as angle seed
        const angle = (i / neoData.objects.length) * Math.PI * 2 + 0.5;
        const nx = cx + Math.cos(angle) * r;
        const ny = cy + Math.sin(angle) * r;

        const dotSize = neo.hazardous ? 4 : 2.5;
        const color = neo.hazardous ? '#ef4444' : '#fbbf24';

        ctx.beginPath();
        ctx.arc(nx, ny, dotSize, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();

        // Label for hazardous or close ones
        if (neo.hazardous || distLD < 10) {
          ctx.fillStyle = color + '80';
          ctx.font = '500 6px "Inter", sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(neo.name, nx, ny - dotSize - 3);
        }
      }
    }

    // Legend
    ctx.fillStyle = '#4a5568';
    ctx.font = '500 7px "Inter", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('LD = Distancia Lunar (384.400 km)', 8, h - 8);
  }
}

// ===== 6. SPACE WEATHER TIMELINE =====

class SpaceWeatherTimeline {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.dpr = window.devicePixelRatio || 1;
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    if (!this.canvas) return;
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = r.width * this.dpr;
    this.canvas.height = r.height * this.dpr;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.w = r.width;
    this.h = r.height;
  }

  draw(spaceWeather, launchDate) {
    if (!this.canvas || !spaceWeather) return;
    const ctx = this.ctx;
    const w = this.w, h = this.h;
    ctx.clearRect(0, 0, w, h);

    const launch = new Date(launchDate).getTime();
    const now = Date.now();
    const missionEnd = launch + 10 * 86400_000;
    const timelineStart = launch - 3 * 86400_000; // 3 days before launch
    const timelineEnd = missionEnd + 1 * 86400_000;
    const span = timelineEnd - timelineStart;

    const marginL = 10, marginR = 10, marginT = 20, marginB = 20;
    const plotW = w - marginL - marginR;
    const plotH = h - marginT - marginB;

    const toX = (ms) => marginL + ((ms - timelineStart) / span) * plotW;

    // Background
    ctx.fillStyle = '#050a14';
    ctx.fillRect(0, 0, w, h);

    // Mission phase band
    const launchX = toX(launch);
    const nowX = toX(now);
    const endX = toX(missionEnd);

    ctx.fillStyle = 'rgba(249,115,22,0.05)';
    ctx.fillRect(launchX, marginT, endX - launchX, plotH);

    // "Now" line
    ctx.strokeStyle = '#f9731640';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(nowX, marginT); ctx.lineTo(nowX, h - marginB); ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#f97316';
    ctx.font = '600 7px "Orbitron", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('AHORA', nowX, marginT - 4);

    // Launch marker
    ctx.fillStyle = '#22c55e80';
    ctx.font = '500 6px "Inter", sans-serif';
    ctx.fillText('LANZAMIENTO', launchX, marginT - 4);

    // Timeline axis
    ctx.strokeStyle = '#1a2744';
    ctx.lineWidth = 1;
    const axisY = marginT + plotH * 0.5;
    ctx.beginPath(); ctx.moveTo(marginL, axisY); ctx.lineTo(w - marginR, axisY); ctx.stroke();

    // Day markers
    ctx.fillStyle = '#334466';
    ctx.font = '500 6px "Inter", sans-serif';
    ctx.textAlign = 'center';
    for (let d = -3; d <= 11; d++) {
      const dayMs = launch + d * 86400_000;
      const dx = toX(dayMs);
      ctx.fillRect(dx, axisY - 3, 1, 6);
      if (d % 2 === 0) ctx.fillText(d >= 0 ? `D${d}` : `${d}d`, dx, axisY + 14);
    }

    // Plot flares (above axis)
    const flareClasses = { X: { y: 0.15, r: 5, color: '#ef4444' }, M: { y: 0.25, r: 4, color: '#f97316' }, C: { y: 0.35, r: 3, color: '#fbbf24' } };

    for (const flare of (spaceWeather.flares || [])) {
      const t = new Date(flare.peak || flare.begin).getTime();
      const x = toX(t);
      const cls = flare.classType?.[0] || 'C';
      const cfg = flareClasses[cls] || flareClasses.C;

      ctx.beginPath();
      ctx.arc(x, marginT + plotH * cfg.y, cfg.r, 0, Math.PI * 2);
      ctx.fillStyle = cfg.color;
      ctx.fill();

      ctx.fillStyle = cfg.color + '80';
      ctx.font = '700 6px "Orbitron", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(flare.classType || '', x, marginT + plotH * cfg.y - cfg.r - 2);
    }

    // Plot storms (below axis)
    for (const storm of (spaceWeather.storms || [])) {
      const t = new Date(storm.start).getTime();
      const x = toX(t);
      const kpNorm = Math.min(1, storm.maxKp / 9);

      ctx.beginPath();
      ctx.arc(x, marginT + plotH * 0.7, 4 + kpNorm * 4, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(139, 92, 246, ${0.3 + kpNorm * 0.5})`;
      ctx.fill();

      ctx.fillStyle = '#8b5cf680';
      ctx.font = '600 6px "Inter", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`Kp${storm.maxKp.toFixed(1)}`, x, marginT + plotH * 0.85);
    }

    // Legend
    ctx.font = '500 7px "Inter", sans-serif';
    ctx.textAlign = 'left';
    let lx = marginL;

    for (const [cls, cfg] of Object.entries(flareClasses)) {
      ctx.fillStyle = cfg.color;
      ctx.beginPath(); ctx.arc(lx + 4, h - 6, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillText(`Clase ${cls}`, lx + 10, h - 3);
      lx += 55;
    }
    ctx.fillStyle = '#8b5cf6';
    ctx.beginPath(); ctx.arc(lx + 4, h - 6, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillText('Tormenta Geomag.', lx + 10, h - 3);
  }
}

// Export
window.DSNMap = DSNMap;
window.RadiationGauge = RadiationGauge;
window.renderCrewFirsts = renderCrewFirsts;
window.EarthViewSim = EarthViewSim;
window.NEORadar = NEORadar;
window.SpaceWeatherTimeline = SpaceWeatherTimeline;
