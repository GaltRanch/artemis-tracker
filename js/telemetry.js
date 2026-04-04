/**
 * Simulated telemetry engine for Artemis missions.
 * Generates realistic telemetry data based on mission elapsed time.
 */

class TelemetryEngine {
  /**
   * @param {object} config - Mission configuration
   * @param {Date} config.launchDate - Launch date/time
   * @param {number} config.durationDays - Total mission duration in days
   * @param {number} config.maxDistanceKm - Max distance from Earth (km)
   * @param {number} config.lunarFlybyDistanceKm - Closest approach to Moon surface (km)
   * @param {number} config.lunarFlybyProgress - Progress value (0-1) at lunar flyby
   */
  constructor(config) {
    this.config = config;
    this.launchDate = new Date(config.launchDate);
    this.durationMs = config.durationDays * 24 * 60 * 60 * 1000;
    this.earthMoonDistance = 384400; // km average
  }

  /**
   * Get mission elapsed time in various formats
   */
  getMET() {
    const now = new Date();
    const elapsedMs = now - this.launchDate;
    if (elapsedMs < 0) return { elapsed: 0, progress: 0, days: 0, hours: 0, minutes: 0, seconds: 0, formatted: 'T- PENDIENTE' };

    const progress = Math.min(elapsedMs / this.durationMs, 1.0);
    const totalSeconds = Math.floor(elapsedMs / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const formatted = `T+ ${String(days).padStart(2, '0')}:${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

    return { elapsed: elapsedMs, progress, days, hours, minutes, seconds, formatted };
  }

  /**
   * Get simulated telemetry values based on current progress
   */
  getTelemetry() {
    const met = this.getMET();
    const p = met.progress;
    const flybyP = this.config.lunarFlybyProgress;

    // Distance to Earth (km) — rises to max at flyby, drops on return
    let distEarth;
    if (p <= flybyP) {
      // Outbound: accelerating then coasting
      const t = p / flybyP;
      distEarth = this.config.maxDistanceKm * this._easeInOutCubic(t);
    } else {
      // Return: from max distance back
      const t = (p - flybyP) / (1 - flybyP);
      distEarth = this.config.maxDistanceKm * (1 - this._easeInOutCubic(t));
    }

    // Distance to Moon (km)
    let distMoon = Math.abs(this.earthMoonDistance - distEarth);
    // At closest approach, override with flyby distance
    if (Math.abs(p - flybyP) < 0.02) {
      const closeness = 1 - Math.abs(p - flybyP) / 0.02;
      distMoon = distMoon * (1 - closeness) + this.config.lunarFlybyDistanceKm * closeness;
    }

    // Velocity (km/h) — varies through mission
    let velocity;
    if (p < 0.01) {
      velocity = 28000 + p / 0.01 * 7000; // Launch acceleration
    } else if (p < flybyP * 0.3) {
      velocity = 35000 - (p / (flybyP * 0.3)) * 30000; // Slowing down as leaving Earth
    } else if (p < flybyP) {
      velocity = 5000 + Math.abs(p - flybyP) / flybyP * 2000; // Coasting
    } else if (Math.abs(p - flybyP) < 0.03) {
      velocity = 8000 + (1 - Math.abs(p - flybyP) / 0.03) * 2500; // Flyby speed boost
    } else if (p < 0.95) {
      const returnT = (p - flybyP) / (0.95 - flybyP);
      velocity = 5000 + returnT * 30000; // Accelerating on return
    } else {
      velocity = 35000 + (p - 0.95) / 0.05 * 5000; // Reentry speed
    }

    // Add subtle noise
    velocity += (Math.sin(Date.now() / 3000) * 50);
    distEarth += (Math.sin(Date.now() / 5000) * 20);
    distMoon += (Math.cos(Date.now() / 4000) * 15);

    // Altitude (from nearest body)
    const altitude = Math.min(distEarth, distMoon);

    // Acceleration (m/s²) — mostly micro-g during coast
    let acceleration;
    if (p < 0.01 || p > 0.97) {
      acceleration = 2.5 + Math.random() * 1.5; // Launch / reentry
    } else if (Math.abs(p - flybyP) < 0.02) {
      acceleration = 0.01 + Math.random() * 0.02; // Flyby
    } else {
      acceleration = 0.0001 + Math.random() * 0.0005; // Coast (micro-gravity)
    }

    // Exterior temperature (°C)
    let tempExt;
    if (p > 0.97) {
      tempExt = 200 + (p - 0.97) / 0.03 * 2600; // Reentry heating
    } else {
      tempExt = -150 + Math.sin(Date.now() / 10000) * 30; // Deep space
    }

    // Mission phase
    let phase;
    if (p < 0.005) phase = 'LANZAMIENTO';
    else if (p < 0.01) phase = 'INSERCION ORBITAL';
    else if (p < 0.015) phase = 'INYECCION TRANSLUNAR (TLI)';
    else if (p < flybyP - 0.02) phase = 'CRUCERO TRANSLUNAR';
    else if (p < flybyP + 0.02) phase = 'SOBREVUELO LUNAR';
    else if (p < 0.95) phase = 'CRUCERO DE RETORNO';
    else if (p < 0.99) phase = 'REENTRADA ATMOSFERICA';
    else phase = 'AMERIZAJE';

    return {
      met,
      distEarth: Math.max(0, Math.round(distEarth)),
      distMoon: Math.max(0, Math.round(distMoon)),
      velocity: Math.max(0, Math.round(velocity)),
      altitude: Math.max(0, Math.round(altitude)),
      acceleration: acceleration.toFixed(4),
      tempExt: Math.round(tempExt),
      phase
    };
  }

  _easeInOutCubic(t) {
    return t < 0.5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }
}

window.TelemetryEngine = TelemetryEngine;
