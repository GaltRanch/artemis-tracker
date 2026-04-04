/**
 * Cinematic trajectory renderer using REAL NASA/JPL Horizons data.
 * Fetches the full mission trajectory once and renders it on canvas.
 */

class TrajectoryRenderer {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.dpr = window.devicePixelRatio || 1;

    this._stars = null;
    this._particles = [];
    this._mouse = { x: 0, y: 0, active: false };
    this._animFrame = 0;

    // Zoom & pan state
    this._zoom = 1;
    this._panX = 0;
    this._panY = 0;
    this._dragging = false;
    this._dragStart = { x: 0, y: 0 };
    this._pinchDist = 0;

    // Real trajectory data from JPL
    this._realTrajectory = null;
    this._moonPositions = null;
    this._trajectoryLoaded = false;
    this._trajectoryLoading = false;

    // Images
    this._earthImg = null;
    this._moonImg = null;
    this._loadImages();

    this.resize();
    window.addEventListener('resize', () => { this._stars = null; this.resize(); });

    // Mouse events
    this.canvas.addEventListener('mousemove', (e) => {
      const r = this.canvas.getBoundingClientRect();
      this._mouse.x = e.clientX - r.left;
      this._mouse.y = e.clientY - r.top;
      this._mouse.active = true;
      if (this._dragging) {
        this._panX += (e.clientX - this._dragStart.x) / this._zoom;
        this._panY += (e.clientY - this._dragStart.y) / this._zoom;
        this._dragStart = { x: e.clientX, y: e.clientY };
      }
    });
    this.canvas.addEventListener('mouseleave', () => {
      this._mouse.active = false;
      this._dragging = false;
      this.canvas.style.cursor = 'crosshair';
    });
    this.canvas.addEventListener('mousedown', (e) => {
      this._dragging = true;
      this._dragStart = { x: e.clientX, y: e.clientY };
      this.canvas.style.cursor = 'grabbing';
    });
    this.canvas.addEventListener('mouseup', () => {
      this._dragging = false;
      this.canvas.style.cursor = 'crosshair';
    });

    // Double click to reset
    this.canvas.addEventListener('dblclick', () => {
      this._zoom = 1; this._panX = 0; this._panY = 0;
    });

    // Wheel zoom
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.75 : 1.33;
      this._zoom = Math.max(0.5, Math.min(15, this._zoom * delta));
    }, { passive: false });

    // Touch events (pinch zoom + drag)
    this.canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        this._dragging = true;
        this._dragStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      } else if (e.touches.length === 2) {
        this._pinchDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
      }
    }, { passive: true });
    this.canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (e.touches.length === 1 && this._dragging) {
        this._panX += (e.touches[0].clientX - this._dragStart.x) / this._zoom;
        this._panY += (e.touches[0].clientY - this._dragStart.y) / this._zoom;
        this._dragStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      } else if (e.touches.length === 2) {
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        if (this._pinchDist > 0) {
          this._zoom = Math.max(0.5, Math.min(15, this._zoom * (dist / this._pinchDist)));
        }
        this._pinchDist = dist;
      }
    }, { passive: false });
    this.canvas.addEventListener('touchend', () => {
      this._dragging = false;
      this._pinchDist = 0;
    });
  }

  _loadImages() {
    let n = 0;
    const done = () => { n++; };
    this._earthImg = new Image();
    this._earthImg.crossOrigin = 'anonymous';
    this._earthImg.onload = this._earthImg.onerror = done;
    this._earthImg.src = 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/cb/The_Blue_Marble_%28remastered%29.jpg/600px-The_Blue_Marble_%28remastered%29.jpg';

    this._moonImg = new Image();
    this._moonImg.crossOrigin = 'anonymous';
    this._moonImg.onload = this._moonImg.onerror = done;
    this._moonImg.src = 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e1/FullMoon2010.jpg/600px-FullMoon2010.jpg';
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = r.width * this.dpr;
    this.canvas.height = r.height * this.dpr;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.w = r.width;
    this.h = r.height;
  }

  // ===== Load full mission trajectory from JPL =====

  async loadTrajectory(config) {
    if (this._trajectoryLoading || this._trajectoryLoaded) return;
    this._trajectoryLoading = true;

    const base = '/api/horizons';
    const fmt = (d) => `'${d}'`;

    try {
      // Fetch spacecraft position relative to Earth for full mission
      const params = new URLSearchParams({
        format: 'json',
        COMMAND: `'${config.horizonsId}'`,
        CENTER: "'399'",
        EPHEM_TYPE: "'VECTORS'",
        START_TIME: "'2026-04-02 02:00'",
        STOP_TIME: "'2026-04-10 23:50'",
        STEP_SIZE: "'1 h'",
        VEC_TABLE: "'3'",
        OUT_UNITS: "'KM-S'",
        REF_PLANE: "'ECLIPTIC'",
        REF_SYSTEM: "'J2000'",
        CSV_FORMAT: "'YES'",
      });

      const resp = await fetch(`${base}?${params}`);
      const json = await resp.json();
      this._realTrajectory = this._parseVectors(json.result);

      // Fetch Moon positions during mission (for current position)
      await new Promise(r => setTimeout(r, 800));
      const moonParams = new URLSearchParams({
        format: 'json',
        COMMAND: "'301'", CENTER: "'399'",
        EPHEM_TYPE: "'VECTORS'",
        START_TIME: "'2026-04-02 02:00'", STOP_TIME: "'2026-04-10 23:50'",
        STEP_SIZE: "'6 h'", VEC_TABLE: "'2'", OUT_UNITS: "'KM-S'",
        REF_PLANE: "'ECLIPTIC'", REF_SYSTEM: "'J2000'", CSV_FORMAT: "'YES'",
      });
      const moonResp = await fetch(`${base}?${moonParams}`);
      const moonJson = await moonResp.json();
      this._moonPositions = this._parseMoonVectors(moonJson.result);

      // Fetch full Moon orbit (~27 days) for orbital path visualization
      await new Promise(r => setTimeout(r, 800));
      const moonOrbitParams = new URLSearchParams({
        format: 'json',
        COMMAND: "'301'", CENTER: "'399'",
        EPHEM_TYPE: "'VECTORS'",
        START_TIME: "'2026-03-20 00:00'", STOP_TIME: "'2026-04-16 08:00'",
        STEP_SIZE: "'8 h'", VEC_TABLE: "'2'", OUT_UNITS: "'KM-S'",
        REF_PLANE: "'ECLIPTIC'", REF_SYSTEM: "'J2000'", CSV_FORMAT: "'YES'",
      });
      const moonOrbitResp = await fetch(`${base}?${moonOrbitParams}`);
      const moonOrbitJson = await moonOrbitResp.json();
      this._moonOrbit = this._parseMoonVectors(moonOrbitJson.result);

      if (this._realTrajectory && this._realTrajectory.length > 0) {
        this._trajectoryLoaded = true;
        console.log(`[Trajectory] Loaded ${this._realTrajectory.length} real JPL points`);
        if (this._moonPositions) {
          console.log(`[Trajectory] Loaded ${this._moonPositions.length} Moon mission points`);
        }
        if (this._moonOrbit) {
          console.log(`[Trajectory] Loaded ${this._moonOrbit.length} Moon orbit points`);
        }
      }
    } catch (err) {
      console.warn('[Trajectory] Failed to load:', err.message);
    }
    this._trajectoryLoading = false;
  }

  _parseVectors(text) {
    const soe = text.indexOf('$$SOE');
    const eoe = text.indexOf('$$EOE');
    if (soe === -1 || eoe === -1) return null;
    const lines = text.substring(soe + 5, eoe).trim().split('\n').filter(l => l.trim());
    const pts = [];
    for (const line of lines) {
      const c = line.split(',').map(s => s.trim());
      if (c.length < 11) continue;
      const ts = this._parseDate(c[1]);
      if (!ts) continue;
      pts.push({
        timestamp: ts,
        x: parseFloat(c[2]), y: parseFloat(c[3]), z: parseFloat(c[4]),
        range: parseFloat(c[9]),
      });
    }
    return pts;
  }

  _parseMoonVectors(text) {
    const soe = text.indexOf('$$SOE');
    const eoe = text.indexOf('$$EOE');
    if (soe === -1 || eoe === -1) return null;
    const lines = text.substring(soe + 5, eoe).trim().split('\n').filter(l => l.trim());
    const pts = [];
    for (const line of lines) {
      const c = line.split(',').map(s => s.trim());
      if (c.length < 7) continue;
      const ts = this._parseDate(c[1]);
      if (!ts) continue;
      pts.push({ timestamp: ts, x: parseFloat(c[2]), y: parseFloat(c[3]), z: parseFloat(c[4]) });
    }
    return pts;
  }

  _parseDate(raw) {
    const cleaned = raw.trim().replace(/A\.D\.\s*/, '').replace(/\.0+$/, '').replace(/\s+/g, ' ').trim();
    const m = cleaned.match(/(\d{4})-(\w{3})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
    if (!m) return null;
    const months = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
    if (!(m[2] in months)) return null;
    return new Date(Date.UTC(+m[1], months[m[2]], +m[3], +m[4], +m[5], +m[6])).getTime();
  }

  // ===== Main draw =====

  draw(progress, config, telemetry) {
    // Trigger trajectory load
    if (!this._trajectoryLoaded && !this._trajectoryLoading) {
      this.loadTrajectory(config);
    }

    const ctx = this.ctx;
    const w = this.w, h = this.h;
    this._animFrame++;
    ctx.clearRect(0, 0, w, h);

    this._drawStarfield(ctx, w, h);

    if (!this._trajectoryLoaded || !this._realTrajectory) {
      ctx.fillStyle = 'rgba(148,163,184,0.4)';
      ctx.font = '600 12px "Orbitron", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Cargando trayectoria real de NASA/JPL Horizons...', w / 2, h / 2);
      return;
    }

    // Project real 3D data to 2D canvas
    const scene = this._projectToCanvas(w, h);

    // Apply zoom & pan transform
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(this._zoom, this._zoom);
    ctx.translate(-w / 2 + this._panX, -h / 2 + this._panY);

    // Draw grid
    this._drawGrid(ctx, w, h, scene);

    // Moon orbit (full ~27-day path)
    if (scene.moonOrbitPts?.length > 1) {
      this._drawMoonOrbit(ctx, scene);
    }

    // Split trajectory: past (tracked) vs future (NoBurn prediction)
    const nowMs = Date.now();
    let currentIdx = 0;
    for (let i = 0; i < this._realTrajectory.length; i++) {
      if (this._realTrajectory[i].timestamp <= nowMs) currentIdx = i;
    }

    // Future path (NoBurn prediction — dashed, dimmer)
    if (currentIdx < scene.pts.length - 1) {
      this._drawPath(ctx, scene.pts.slice(currentIdx), 'prediction');
    }

    // Past path (real tracked data — solid orange)
    this._drawPath(ctx, scene.pts.slice(0, currentIdx + 1), 'traveled');

    // Particles
    if (currentIdx > 0) {
      this._updateParticles(ctx, scene.pts, currentIdx);
    }

    // Earth & Moon
    this._drawEarth(ctx, scene.earthX, scene.earthY, scene.earthR);
    this._drawMoon(ctx, scene.moonX, scene.moonY, scene.moonR);

    // Orion
    if (currentIdx < scene.pts.length) {
      const orion = scene.pts[currentIdx];
      this._drawOrion(ctx, orion.x, orion.y, w);

      this._drawDistLabel(ctx, scene.earthX, scene.earthY, orion.x, orion.y,
        telemetry ? telemetry.distEarth : 0, 'rgba(96,165,250,0.4)', 'rgba(37,99,235,0.12)');
      this._drawDistLabel(ctx, scene.moonX, scene.moonY, orion.x, orion.y,
        telemetry ? telemetry.distMoon : 0, 'rgba(148,163,184,0.35)', 'rgba(148,163,184,0.08)');
    }

    // TLI marker
    this._drawTLIMarker(ctx, scene, config);

    // Hover (needs transformed coords)
    this._handleHover(ctx, scene, currentIdx, telemetry);

    ctx.restore(); // end zoom/pan transform

    // HUD overlay (not affected by zoom)
    this._drawProgressBar(ctx, w, h, progress, currentIdx, scene.pts.length);
    this._drawZoomHUD(ctx, w, h);

    ctx.fillStyle = 'rgba(74,85,104,0.35)';
    ctx.font = '500 8px "Inter", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Trayectoria real NASA/JPL Horizons · Scroll/pinch para zoom · Drag para mover', 12, 14);
  }

  _drawZoomHUD(ctx, w, h) {
    const zoomPct = Math.round(this._zoom * 100);
    ctx.fillStyle = 'rgba(74,85,104,0.5)';
    ctx.font = '700 9px "Orbitron", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`ZOOM ${zoomPct}%`, w - 12, 14);

    // Reset hint when zoomed
    if (this._zoom !== 1 || this._panX !== 0 || this._panY !== 0) {
      ctx.fillStyle = 'rgba(6,214,214,0.3)';
      ctx.font = '500 8px "Inter", sans-serif';
      ctx.fillText('Doble click para resetear', w - 12, 26);
    }
  }

  // ===== Project 3D ecliptic coordinates to 2D canvas =====
  // Rotates the coordinate system so the Earth-Moon axis is horizontal
  // (Earth on left, Moon on right) — this matches how people expect to see it.

  _projectToCanvas(w, h) {
    const traj = this._realTrajectory;
    const margin = 50;

    // Find Moon position at flyby time (~day 6) for rotation reference
    let moonRef = { x: -130472, y: -383247 }; // fallback
    if (this._moonPositions && this._moonPositions.length > 0) {
      // Use mid-mission Moon position
      const midIdx = Math.floor(this._moonPositions.length / 2);
      moonRef = this._moonPositions[midIdx];
    }

    // Calculate rotation angle to make Earth→Moon horizontal (pointing right)
    const angle = Math.atan2(moonRef.y, moonRef.x);
    // We want Moon to the right (+X), so rotate by -angle + PI (flip to right side)
    const rot = -angle + Math.PI;
    const cosR = Math.cos(rot);
    const sinR = Math.sin(rot);

    // Rotate a point around origin (Earth)
    const rotate = (x, y) => ({
      rx: x * cosR - y * sinR,
      ry: x * sinR + y * cosR,
    });

    // Rotate all trajectory points and find bounds
    const rotated = traj.map(p => {
      const r = rotate(p.x, p.y);
      return { ...r, timestamp: p.timestamp, range: p.range };
    });

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of rotated) {
      if (p.rx < minX) minX = p.rx;
      if (p.rx > maxX) maxX = p.rx;
      if (p.ry < minY) minY = p.ry;
      if (p.ry > maxY) maxY = p.ry;
    }

    // Include rotated Moon positions in bounds
    const moonRotated = [];
    if (this._moonPositions) {
      for (const m of this._moonPositions) {
        const r = rotate(m.x, m.y);
        moonRotated.push({ ...r, timestamp: m.timestamp });
        if (r.rx < minX) minX = r.rx;
        if (r.rx > maxX) maxX = r.rx;
        if (r.ry < minY) minY = r.ry;
        if (r.ry > maxY) maxY = r.ry;
      }
    }

    // Rotate full Moon orbit for visualization
    const moonOrbitRotated = [];
    if (this._moonOrbit) {
      for (const m of this._moonOrbit) {
        const r = rotate(m.x, m.y);
        moonOrbitRotated.push({ ...r, timestamp: m.timestamp });
        // Include orbit in bounds
        if (r.rx < minX) minX = r.rx;
        if (r.rx > maxX) maxX = r.rx;
        if (r.ry < minY) minY = r.ry;
        if (r.ry > maxY) maxY = r.ry;
      }
    }

    // Earth at rotated origin
    const earthRot = rotate(0, 0);
    if (earthRot.rx < minX) minX = earthRot.rx;
    if (earthRot.rx > maxX) maxX = earthRot.rx;

    // Padding
    const padKm = 30000;
    minX -= padKm; maxX += padKm;
    minY -= padKm; maxY += padKm;

    const rangeX = maxX - minX;
    const rangeY = maxY - minY;
    const scale = Math.min((w - margin * 2) / rangeX, (h - margin * 2) / rangeY);

    const cx = w / 2;
    const cy = h / 2;
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;

    const toScreen = (rx, ry) => ({
      x: cx + (rx - midX) * scale,
      y: cy - (ry - midY) * scale,
    });

    // Project trajectory
    const pts = rotated.map(p => {
      const s = toScreen(p.rx, p.ry);
      return { ...s, timestamp: p.timestamp, range: p.range };
    });

    // Earth
    const earth = toScreen(0, 0);

    // Moon position at current time
    let moonProj = toScreen(maxX * 0.9, 0); // fallback
    if (moonRotated.length > 1) {
      const now = Date.now();
      let mp = moonRotated[0];
      for (const m of moonRotated) {
        if (m.timestamp <= now) mp = m;
      }
      moonProj = toScreen(mp.rx, mp.ry);
    }

    // Sizes: Earth radius 6,371 km, Moon 1,737 km
    const earthR = Math.max(8, 6371 * scale);
    const moonR = Math.max(3, 1737 * scale);

    // If they're too small to see, enforce minimums
    const earthRfinal = Math.max(earthR, 12);
    const moonRfinal = Math.max(moonR, earthRfinal / 3.67);

    // Project Moon orbit points
    const moonOrbitPts = moonOrbitRotated.map(m => toScreen(m.rx, m.ry));

    // Find Moon position at flyby time (closest approach ~Apr 7 00:31 UTC)
    const flybyMs = new Date('2026-04-06T23:06:00Z').getTime();
    let flybyMoonPos = null;
    if (moonRotated.length > 0) {
      let best = moonRotated[0];
      for (const m of moonRotated) {
        if (Math.abs(m.timestamp - flybyMs) < Math.abs(best.timestamp - flybyMs)) best = m;
      }
      flybyMoonPos = toScreen(best.rx, best.ry);
    }

    return {
      pts,
      earthX: earth.x, earthY: earth.y, earthR: earthRfinal,
      moonX: moonProj.x, moonY: moonProj.y, moonR: moonRfinal,
      moonOrbitPts,
      flybyMoonPos,
      scale,
    };
  }

  // ===== Drawing methods =====

  _drawMoonOrbit(ctx, scene) {
    const pts = scene.moonOrbitPts;
    if (!pts || pts.length < 2) return;

    ctx.save();

    // Full orbit path — thin dashed blue-gray
    ctx.setLineDash([4, 6]);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.closePath();
    ctx.stroke();

    // "ORBITA LUNAR" label at the top of the orbit
    let topPt = pts[0];
    for (const p of pts) { if (p.y < topPt.y) topPt = p; }
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(148, 163, 184, 0.2)';
    ctx.font = '600 7px "Orbitron", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('ORBITA LUNAR', topPt.x, topPt.y - 8);

    // Flyby point marker — where the Moon will be during closest approach
    if (scene.flybyMoonPos) {
      const fp = scene.flybyMoonPos;

      // Pulsing circle at flyby location
      ctx.beginPath();
      ctx.arc(fp.x, fp.y, 8, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(139, 92, 246, 0.3)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([2, 3]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Cross marker
      ctx.strokeStyle = 'rgba(139, 92, 246, 0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(fp.x - 5, fp.y); ctx.lineTo(fp.x + 5, fp.y);
      ctx.moveTo(fp.x, fp.y - 5); ctx.lineTo(fp.x, fp.y + 5);
      ctx.stroke();

      // Label
      ctx.fillStyle = 'rgba(139, 92, 246, 0.6)';
      ctx.font = '700 7px "Orbitron", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('FLYBY', fp.x, fp.y - 12);
      ctx.fillStyle = 'rgba(139, 92, 246, 0.35)';
      ctx.font = '500 6px "Inter", sans-serif';
      ctx.fillText('6-7 Abr ~23:06 UTC', fp.x, fp.y + 16);
    }

    ctx.restore();
  }

  _drawStarfield(ctx, w, h) {
    if (!this._stars) {
      this._stars = [];
      for (let i = 0; i < 250; i++) {
        this._stars.push({
          x: this._hash(i * 7919) * w,
          y: this._hash(i * 6271 + 42) * h,
          r: 0.2 + this._hash(i * 3571) * 0.9,
          a: 0.05 + this._hash(i * 2347) * 0.3,
          tw: this._hash(i * 4441) * Math.PI * 2,
          sp: 0.3 + this._hash(i * 1013) * 0.7,
        });
      }
    }
    const t = this._animFrame * 0.015;
    for (const s of this._stars) {
      const alpha = s.a * (0.6 + 0.4 * Math.sin(t * s.sp + s.tw));
      let px = s.x, py = s.y;
      if (this._mouse.active) {
        px += (this._mouse.x - this.w / 2) * 0.003 * s.sp;
        py += (this._mouse.y - this.h / 2) * 0.003 * s.sp;
      }
      ctx.beginPath();
      ctx.arc(px, py, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(190,210,255,${alpha})`;
      ctx.fill();
    }
  }

  _drawGrid(ctx, w, h, scene) {
    ctx.save();
    ctx.setLineDash([2, 8]);
    ctx.strokeStyle = 'rgba(20,30,58,0.4)';
    ctx.lineWidth = 0.5;
    // Earth-Moon line
    ctx.beginPath();
    ctx.moveTo(scene.earthX, scene.earthY);
    ctx.lineTo(scene.moonX, scene.moonY);
    ctx.stroke();
    ctx.restore();
  }

  _drawPath(ctx, pts, mode) {
    // mode: 'traveled' | 'prediction'
    if (pts.length < 2) return;
    ctx.save();

    if (mode === 'traveled') {
      ctx.lineCap = 'round';
      ctx.lineWidth = 2;
      for (let i = 1; i < pts.length; i++) {
        const alpha = 0.1 + 0.7 * (i / pts.length);
        ctx.beginPath();
        ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
        ctx.lineTo(pts[i].x, pts[i].y);
        ctx.strokeStyle = `rgba(249,115,22,${alpha})`;
        ctx.stroke();
      }
      // Glow tip
      const gs = Math.max(0, pts.length - 15);
      ctx.shadowColor = '#f97316';
      ctx.shadowBlur = 8;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (let i = gs; i < pts.length; i++) {
        i === gs ? ctx.moveTo(pts[i].x, pts[i].y) : ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.strokeStyle = 'rgba(249,115,22,0.85)';
      ctx.stroke();
      ctx.shadowBlur = 0;
    } else if (mode === 'prediction') {
      // Future / NoBurn prediction — dashed, dimmer, different color
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = 'rgba(148,163,184,0.18)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
      ctx.stroke();

      // Label "PREDICCION (NoBurn)" near the midpoint of the prediction
      if (pts.length > 10) {
        const mid = pts[Math.floor(pts.length * 0.4)];
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(148,163,184,0.2)';
        ctx.font = '600 8px "Orbitron", monospace';
        ctx.textAlign = 'center';
        ctx.fillText('PREDICCION', mid.x, mid.y - 8);
        ctx.fillStyle = 'rgba(148,163,184,0.12)';
        ctx.font = '500 7px "Inter", sans-serif';
        ctx.fillText('(NoBurn — sujeta a correcciones)', mid.x, mid.y + 2);
      }
    }
    ctx.restore();
  }

  _drawEarth(ctx, x, y, r) {
    // Atmosphere glow
    for (let i = 3; i >= 0; i--) {
      const gr = r + r * (0.4 + i * 0.6);
      const glow = ctx.createRadialGradient(x, y, r, x, y, gr);
      glow.addColorStop(0, `rgba(37,99,235,${0.06 - i * 0.012})`);
      glow.addColorStop(1, 'transparent');
      ctx.beginPath(); ctx.arc(x, y, gr, 0, Math.PI * 2); ctx.fillStyle = glow; ctx.fill();
    }

    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.clip();
    if (this._earthImg?.complete && this._earthImg.naturalWidth) {
      ctx.drawImage(this._earthImg, x - r, y - r, r * 2, r * 2);
      const sh = ctx.createLinearGradient(x - r, y, x + r, y);
      sh.addColorStop(0, 'transparent'); sh.addColorStop(0.6, 'transparent');
      sh.addColorStop(1, 'rgba(0,0,20,0.35)');
      ctx.fillStyle = sh; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    } else {
      const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.05, x, y, r);
      g.addColorStop(0, '#60a5fa'); g.addColorStop(0.5, '#2563eb'); g.addColorStop(1, '#1e3a8a');
      ctx.fillStyle = g; ctx.fill();
    }
    ctx.restore();

    ctx.beginPath(); ctx.arc(x, y, r + 1, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(96,165,250,0.2)'; ctx.lineWidth = 1; ctx.stroke();

    ctx.fillStyle = 'rgba(148,163,184,0.5)';
    ctx.font = '700 8px "Orbitron", monospace'; ctx.textAlign = 'center';
    ctx.fillText('TIERRA', x, y + r + 14);
  }

  _drawMoon(ctx, x, y, r) {
    const glowR = Math.max(r * 4, 16);
    const glow = ctx.createRadialGradient(x, y, r, x, y, glowR);
    glow.addColorStop(0, 'rgba(148,163,184,0.1)');
    glow.addColorStop(1, 'transparent');
    ctx.beginPath(); ctx.arc(x, y, glowR, 0, Math.PI * 2); ctx.fillStyle = glow; ctx.fill();

    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.clip();
    if (this._moonImg?.complete && this._moonImg.naturalWidth) {
      ctx.drawImage(this._moonImg, x - r, y - r, r * 2, r * 2);
    } else {
      const g = ctx.createRadialGradient(x - r * 0.2, y - r * 0.2, 0, x, y, r);
      g.addColorStop(0, '#cbd5e1'); g.addColorStop(1, '#64748b');
      ctx.fillStyle = g; ctx.fill();
    }
    ctx.restore();

    ctx.fillStyle = 'rgba(148,163,184,0.5)';
    ctx.font = '700 8px "Orbitron", monospace'; ctx.textAlign = 'center';
    ctx.fillText('LUNA', x, y + r + 14);
  }

  _drawOrion(ctx, x, y, w) {
    const s = Math.max(4, w * 0.005);
    const t = this._animFrame * 0.03;
    const breathe = 0.85 + 0.15 * Math.sin(t);

    const glow = ctx.createRadialGradient(x, y, s * 0.5, x, y, s * 5 * breathe);
    glow.addColorStop(0, 'rgba(249,115,22,0.4)');
    glow.addColorStop(0.4, 'rgba(249,115,22,0.08)');
    glow.addColorStop(1, 'transparent');
    ctx.beginPath(); ctx.arc(x, y, s * 5 * breathe, 0, Math.PI * 2); ctx.fillStyle = glow; ctx.fill();

    const core = ctx.createRadialGradient(x, y, 0, x, y, s);
    core.addColorStop(0, '#fff'); core.addColorStop(0.4, '#fb923c'); core.addColorStop(1, '#ea580c');
    ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2); ctx.fillStyle = core; ctx.fill();

    ctx.beginPath(); ctx.arc(x, y, s + 2, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,255,255,${0.3 + 0.2 * Math.sin(t * 1.5)})`;
    ctx.lineWidth = 1; ctx.stroke();

    ctx.fillStyle = '#f97316';
    ctx.font = `900 ${Math.max(8, w * 0.007)}px "Orbitron", monospace`;
    ctx.textAlign = 'center';
    ctx.fillText('ORION', x, y - s * 3);
    ctx.fillStyle = 'rgba(249,115,22,0.45)';
    ctx.font = `600 ${Math.max(6, w * 0.005)}px "Inter", sans-serif`;
    ctx.fillText('"INTEGRITY"', x, y - s * 3 + 11);
  }

  _drawDistLabel(ctx, x1, y1, x2, y2, distKm, textColor, lineColor) {
    ctx.save();
    ctx.setLineDash([2, 5]);
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();

    if (distKm > 0) {
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      const label = distKm >= 1000
        ? (distKm / 1000).toFixed(1).replace('.', ',') + 'k km'
        : Math.round(distKm) + ' km';
      ctx.fillStyle = textColor;
      ctx.font = '600 9px "Inter", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(label, mx, my - 5);
    }
    ctx.restore();
  }

  _drawTLIMarker(ctx, scene, config) {
    // TLI happened at MET ~1d 1h 14m = ~90840 seconds after launch
    const launchMs = new Date(config.launchDate).getTime();
    const tliMs = launchMs + 90840 * 1000;

    // Find closest trajectory point
    let tliPt = null;
    let minDiff = Infinity;
    for (const p of scene.pts) {
      const d = Math.abs(p.timestamp - tliMs);
      if (d < minDiff) { minDiff = d; tliPt = p; }
    }

    if (tliPt) {
      ctx.save();
      ctx.fillStyle = 'rgba(251,191,36,0.7)';
      ctx.beginPath();
      ctx.moveTo(tliPt.x, tliPt.y - 5);
      ctx.lineTo(tliPt.x + 4, tliPt.y);
      ctx.lineTo(tliPt.x, tliPt.y + 5);
      ctx.lineTo(tliPt.x - 4, tliPt.y);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = 'rgba(251,191,36,0.55)';
      ctx.font = '700 8px "Orbitron", monospace';
      ctx.textAlign = 'left';
      ctx.fillText('TLI', tliPt.x + 7, tliPt.y + 3);
      ctx.restore();
    }
  }

  _updateParticles(ctx, pts, idx) {
    const pos = pts[idx];
    const prev = pts[Math.max(0, idx - 1)];

    if (this._animFrame % 3 === 0) {
      const dx = pos.x - prev.x, dy = pos.y - prev.y;
      this._particles.push({
        x: pos.x, y: pos.y,
        vx: -dx * 0.2 + (Math.random() - 0.5) * 0.4,
        vy: -dy * 0.2 + (Math.random() - 0.5) * 0.4,
        life: 1, decay: 0.02 + Math.random() * 0.02,
        size: 0.8 + Math.random() * 1.2,
      });
    }

    if (this._particles.length > 60) this._particles = this._particles.slice(-60);

    for (let i = this._particles.length - 1; i >= 0; i--) {
      const p = this._particles[i];
      p.x += p.vx; p.y += p.vy; p.life -= p.decay;
      if (p.life <= 0) { this._particles.splice(i, 1); continue; }
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(249,115,22,${p.life * 0.35})`;
      ctx.fill();
    }
  }

  _handleHover(ctx, scene, currentIdx, telemetry) {
    if (!this._mouse.active || this._dragging) return;
    // Transform mouse coords into the zoomed/panned space
    const w = this.w, h = this.h;
    const hx = (this._mouse.x - w / 2) / this._zoom + w / 2 - this._panX;
    const hy = (this._mouse.y - h / 2) / this._zoom + h / 2 - this._panY;

    // Earth
    if (Math.hypot(hx - scene.earthX, hy - scene.earthY) < scene.earthR + 8) {
      this.canvas.style.cursor = 'pointer';
      this._tooltip(ctx, scene.earthX, scene.earthY - scene.earthR - 8, [
        'TIERRA', 'Radio: 6.371 km', 'Masa: 5,97 x 10^24 kg',
        telemetry ? `Orion a ${this._fmtDist(telemetry.distEarth)}` : '',
      ]);
      return;
    }

    // Moon
    if (Math.hypot(hx - scene.moonX, hy - scene.moonY) < Math.max(scene.moonR + 8, 15)) {
      this.canvas.style.cursor = 'pointer';
      this._tooltip(ctx, scene.moonX, scene.moonY - scene.moonR - 8, [
        'LUNA', 'Radio: 1.737 km', 'Dist. media: 384.400 km',
        telemetry ? `Orion a ${this._fmtDist(telemetry.distMoon)}` : '',
      ]);
      return;
    }

    // Orion
    if (currentIdx < scene.pts.length) {
      const op = scene.pts[currentIdx];
      if (Math.hypot(hx - op.x, hy - op.y) < 18) {
        this.canvas.style.cursor = 'pointer';
        this._tooltip(ctx, op.x, op.y - 25, [
          'ORION "INTEGRITY"', 'Tripulacion: 4 astronautas',
          telemetry ? `Vel: ${telemetry.velocity.toLocaleString('es-ES')} km/h` : '',
          telemetry ? `Tierra: ${this._fmtDist(telemetry.distEarth)}` : '',
          telemetry ? `Luna: ${this._fmtDist(telemetry.distMoon)}` : '',
        ]);
        return;
      }
    }

    this.canvas.style.cursor = 'crosshair';
  }

  _tooltip(ctx, x, y, lines) {
    const fl = lines.filter(l => l);
    if (!fl.length) return;
    ctx.save();
    ctx.font = '600 10px "Inter", sans-serif';
    const pad = 8, lh = 14;
    const bw = Math.max(...fl.map(l => ctx.measureText(l).width)) + pad * 2;
    const bh = fl.length * lh + pad * 2 - 4;
    let tx = x - bw / 2, ty = y - bh - 6;
    if (tx < 4) tx = 4;
    if (tx + bw > this.w - 4) tx = this.w - bw - 4;
    if (ty < 4) ty = y + 16;

    ctx.fillStyle = 'rgba(10,15,30,0.92)';
    ctx.strokeStyle = 'rgba(6,214,214,0.3)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(tx, ty, bw, bh, 4); ctx.fill(); ctx.stroke();

    ctx.textAlign = 'left';
    fl.forEach((l, i) => {
      ctx.fillStyle = i === 0 ? '#06d6d6' : 'rgba(148,163,184,0.8)';
      ctx.font = i === 0 ? '700 10px "Orbitron", monospace' : '500 10px "Inter", sans-serif';
      ctx.fillText(l, tx + pad, ty + pad + lh * i + 10);
    });
    ctx.restore();
  }

  _drawProgressBar(ctx, w, h, progress, currentIdx, totalPts) {
    ctx.save();
    const barY = h - 14, barH = 3, barW = w - 40, barX = 20;

    ctx.fillStyle = 'rgba(20,30,58,0.6)';
    ctx.beginPath(); ctx.roundRect(barX, barY, barW, barH, 2); ctx.fill();

    const fillW = barW * progress;
    const grad = ctx.createLinearGradient(barX, 0, barX + fillW, 0);
    grad.addColorStop(0, 'rgba(249,115,22,0.3)'); grad.addColorStop(1, '#f97316');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.roundRect(barX, barY, fillW, barH, 2); ctx.fill();

    ctx.textAlign = 'center';
    ctx.font = '500 7px "Inter", sans-serif';
    for (let d = 0; d <= 10; d++) {
      const dx = barX + (d / 10) * barW;
      ctx.fillStyle = (d / 10 <= progress) ? 'rgba(249,115,22,0.5)' : 'rgba(74,85,104,0.4)';
      ctx.fillRect(dx, barY - 2, 1, barH + 4);
      if (d % 2 === 0) ctx.fillText(`D${d}`, dx, barY - 5);
    }

    const day = Math.min(10, progress * 10).toFixed(1);
    ctx.fillStyle = 'rgba(249,115,22,0.7)';
    ctx.font = '700 9px "Orbitron", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`DIA ${day}`, w - 20, barY - 5);
    ctx.restore();
  }

  _fmtDist(km) {
    if (!km) return '--';
    return km >= 1000 ? (km / 1000).toFixed(1).replace('.', ',') + 'k km' : Math.round(km) + ' km';
  }

  _hash(n) { return ((Math.sin(n) * 43758.5453) % 1 + 1) % 1; }
}

window.TrajectoryRenderer = TrajectoryRenderer;
