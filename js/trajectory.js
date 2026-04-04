/**
 * Trajectory visualization for Artemis missions.
 * Renders Earth, Moon, planned trajectory, and Orion's current position on a canvas.
 */

class TrajectoryRenderer {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.dpr = window.devicePixelRatio || 1;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * this.dpr;
    this.canvas.height = rect.height * this.dpr;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.w = rect.width;
    this.h = rect.height;
  }

  /**
   * Draw the full trajectory scene.
   * @param {number} progress - Mission progress 0..1 (0=launch, 1=splashdown)
   * @param {object} missionConfig - Mission-specific configuration
   */
  draw(progress, missionConfig) {
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;

    ctx.clearRect(0, 0, w, h);

    // Draw faint star field
    this._drawStars(ctx, w, h);

    // Positions
    const earthX = w * 0.18;
    const earthY = h * 0.5;
    const moonX = w * 0.82;
    const moonY = h * 0.5;

    // Draw Earth
    this._drawBody(ctx, earthX, earthY, 38, '#1e40af', '#3b82f6', 'TIERRA');

    // Draw Moon
    this._drawBody(ctx, moonX, moonY, 16, '#475569', '#94a3b8', 'LUNA');

    // Draw planned trajectory (free-return)
    const trajectoryPoints = this._computeTrajectory(earthX, earthY, moonX, moonY, w, h);
    this._drawPlannedPath(ctx, trajectoryPoints);

    // Draw traveled path up to current progress
    this._drawTraveledPath(ctx, trajectoryPoints, progress);

    // Draw Orion
    const orionPos = this._getPositionOnPath(trajectoryPoints, progress);
    this._drawOrion(ctx, orionPos.x, orionPos.y);

    // Distance lines
    this._drawDistanceLine(ctx, earthX, earthY, orionPos.x, orionPos.y, 'rgba(59,130,246,0.2)');
    this._drawDistanceLine(ctx, moonX, moonY, orionPos.x, orionPos.y, 'rgba(148,163,184,0.15)');
  }

  _drawStars(ctx, w, h) {
    const seed = 42;
    const count = 120;
    for (let i = 0; i < count; i++) {
      const x = ((seed * (i + 1) * 7919) % 10000) / 10000 * w;
      const y = ((seed * (i + 1) * 6271) % 10000) / 10000 * h;
      const r = ((i * 3571) % 100) / 100 * 1.2 + 0.3;
      const alpha = ((i * 2347) % 100) / 100 * 0.5 + 0.1;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      ctx.fill();
    }
  }

  _drawBody(ctx, x, y, r, colorDark, colorLight, label) {
    // Glow
    const glow = ctx.createRadialGradient(x, y, r, x, y, r * 3);
    glow.addColorStop(0, colorLight + '30');
    glow.addColorStop(1, 'transparent');
    ctx.beginPath();
    ctx.arc(x, y, r * 3, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();

    // Body
    const grad = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
    grad.addColorStop(0, colorLight);
    grad.addColorStop(1, colorDark);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // Label
    ctx.fillStyle = '#64748b';
    ctx.font = '600 10px "Orbitron", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(label, x, y + r + 18);
  }

  _computeTrajectory(ex, ey, mx, my, w, h) {
    // Simulate a free-return trajectory as a series of bezier-sampled points
    const points = [];
    const steps = 300;

    // Outbound: Earth to near-Moon (top arc)
    // Control points for outbound leg
    const cp1x = ex + (mx - ex) * 0.35;
    const cp1y = ey - h * 0.42;
    const cp2x = ex + (mx - ex) * 0.7;
    const cp2y = ey - h * 0.35;
    const nearMoonX = mx - 10;
    const nearMoonY = my - 30;

    for (let i = 0; i <= steps / 2; i++) {
      const t = i / (steps / 2);
      const point = this._cubicBezier(ex, ey, cp1x, cp1y, cp2x, cp2y, nearMoonX, nearMoonY, t);
      points.push(point);
    }

    // Return: near-Moon back to Earth (bottom arc)
    const rcp1x = ex + (mx - ex) * 0.7;
    const rcp1y = ey + h * 0.35;
    const rcp2x = ex + (mx - ex) * 0.35;
    const rcp2y = ey + h * 0.42;

    for (let i = 1; i <= steps / 2; i++) {
      const t = i / (steps / 2);
      const point = this._cubicBezier(nearMoonX, nearMoonY, rcp1x, rcp1y, rcp2x, rcp2y, ex + 15, ey + 10, t);
      points.push(point);
    }

    return points;
  }

  _cubicBezier(x0, y0, x1, y1, x2, y2, x3, y3, t) {
    const mt = 1 - t;
    return {
      x: mt * mt * mt * x0 + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t * x3,
      y: mt * mt * mt * y0 + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t * y3
    };
  }

  _drawPlannedPath(ctx, points) {
    ctx.beginPath();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = 'rgba(148,163,184,0.2)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < points.length; i++) {
      if (i === 0) ctx.moveTo(points[i].x, points[i].y);
      else ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  _drawTraveledPath(ctx, points, progress) {
    const endIdx = Math.floor(progress * (points.length - 1));
    if (endIdx < 1) return;

    ctx.beginPath();
    ctx.strokeStyle = '#f97316';
    ctx.lineWidth = 2.5;
    ctx.shadowColor = '#f97316';
    ctx.shadowBlur = 6;

    for (let i = 0; i <= endIdx; i++) {
      if (i === 0) ctx.moveTo(points[i].x, points[i].y);
      else ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  _getPositionOnPath(points, progress) {
    const idx = Math.min(Math.floor(progress * (points.length - 1)), points.length - 1);
    return points[idx];
  }

  _drawOrion(ctx, x, y) {
    // Glow
    const glow = ctx.createRadialGradient(x, y, 2, x, y, 18);
    glow.addColorStop(0, 'rgba(249,115,22,0.6)');
    glow.addColorStop(1, 'transparent');
    ctx.beginPath();
    ctx.arc(x, y, 18, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();

    // Capsule dot
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#f97316';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Label
    ctx.fillStyle = '#f97316';
    ctx.font = '700 9px "Orbitron", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('ORION', x, y - 14);
  }

  _drawDistanceLine(ctx, x1, y1, x2, y2, color) {
    ctx.beginPath();
    ctx.setLineDash([3, 5]);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

window.TrajectoryRenderer = TrajectoryRenderer;
