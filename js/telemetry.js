/**
 * Telemetry engine for Artemis missions.
 * Fetches REAL data from NASA JPL Horizons API via local proxy.
 */

class TelemetryEngine {
  constructor(config) {
    this.config = config;
    this.launchDate = new Date(config.launchDate);
    this.durationMs = config.durationDays * 24 * 60 * 60 * 1000;
    this.apiBase = '/api/horizons';
    this.spacecraftId = config.horizonsId || '-1024';

    // Data caches
    this.vectorPoints = [];   // from VECTORS queries (Earth + Moon range)
    this.observerData = null; // from OBSERVER query (RA, DEC, constellation, etc.)
    this.lastFetch = 0;
    this.fetchIntervalMs = 5 * 60 * 1000;
    this.fetching = false;
    this.apiAvailable = false;

    this._fetchAll();
  }

  getMET() {
    const now = new Date();
    const elapsedMs = now - this.launchDate;
    if (elapsedMs < 0) {
      return { elapsed: 0, progress: 0, days: 0, hours: 0, minutes: 0, seconds: 0, elapsedSeconds: 0, formatted: 'T- PENDIENTE' };
    }
    const progress = Math.min(elapsedMs / this.durationMs, 1.0);
    const totalSeconds = Math.floor(elapsedMs / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const formatted = `T+ ${String(days).padStart(2, '0')}:${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    return { elapsed: elapsedMs, progress, days, hours, minutes, seconds, elapsedSeconds: totalSeconds, formatted };
  }

  getTelemetry() {
    const met = this.getMET();
    const now = Date.now();

    if (now - this.lastFetch > this.fetchIntervalMs && !this.fetching) {
      this._fetchAll();
    }

    const interp = this._interpolateVectors(now);
    const obs = this.observerData || {};

    const p = met.progress;
    const flybyMET = 434460; // seconds — MET 5/00:31
    const phase = this._getPhase(met.elapsedSeconds);

    return {
      met,
      distEarth: Math.round(interp.distEarth),
      distMoon: Math.round(interp.distMoon),
      velocity: Math.round(interp.velocity),
      rangeRate: interp.rangeRate.toFixed(3),
      ra: obs.ra || '--',
      dec: obs.dec || '--',
      constellation: obs.constellation || '--',
      lightTime: obs.lightTime || '--',
      distSun: obs.distSun || '--',
      phase,
      dataAge: interp.dataAge || 0,
      dataSource: this.apiAvailable
        ? `NASA/JPL Horizons — interpolado entre puntos reales (refresco cada 5 min)`
        : 'Conectando con NASA/JPL Horizons...'
    };
  }

  _getPhase(elapsedSec) {
    if (elapsedSec < 1200) return 'LANZAMIENTO Y ASCENSO';
    if (elapsedSec < 12258) return 'ORBITA TERRESTRE — DESPLIEGUE SOLAR';
    if (elapsedSec < 46500) return 'MANIOBRAS ORBITALES';
    if (elapsedSec < 90840) return 'ORBITA TERRESTRE ALTA';
    if (elapsedSec < 91195) return 'INYECCION TRANSLUNAR (TLI)';
    if (elapsedSec < 361740) return 'CRUCERO TRANSLUNAR';
    if (elapsedSec < 375480) return 'ESFERA DE INFLUENCIA LUNAR';
    if (elapsedSec < 434460 + 1800) return 'SOBREVUELO LUNAR — LADO OCULTO';
    if (elapsedSec < 500520) return 'RETORNO — ESFERA LUNAR';
    if (elapsedSec < 770940) return 'CRUCERO DE RETORNO';
    if (elapsedSec < 772920) return 'REENTRADA ATMOSFERICA';
    return 'AMERIZAJE';
  }

  // ===== Fetch both VECTORS and OBSERVER data =====

  async _fetchAll() {
    if (this.fetching) return;
    this.fetching = true;

    const now = new Date();
    const start = new Date(now.getTime() - 2 * 3600_000);
    const end = new Date(now.getTime() + 2 * 3600_000);

    try {
      // Sequential to avoid JPL rate-limiting (503)
      const earthVec = await this._fetchWithRetry(() => this._fetchVectors('399', start, end));
      await this._sleep(800);
      const moonVec = await this._fetchWithRetry(() => this._fetchVectors('301', start, end));
      await this._sleep(800);
      const obsData = await this._fetchWithRetry(() => this._fetchObserver(start, end));

      if (earthVec && moonVec) {
        this._mergeVectors(earthVec, moonVec);
      }

      if (obsData) {
        this.observerData = obsData;
      }

      if (earthVec || obsData) {
        this.apiAvailable = true;
        console.log('[Horizons] Data refreshed —', this.vectorPoints.length, 'vector points');
      }
    } catch (err) {
      console.warn('[Horizons] Fetch failed:', err.message);
    }

    this.lastFetch = Date.now();
    this.fetching = false;
  }

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  async _fetchWithRetry(fn, retries = 3) {
    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (err) {
        if (i === retries - 1) throw err;
        console.log(`[Horizons] Retry ${i + 1}/${retries} after error:`, err.message);
        await this._sleep(2000 * (i + 1));
      }
    }
  }

  // ===== VECTORS query (position, velocity, range) =====

  async _fetchVectors(center, start, end) {
    const fmt = (d) => `'${d.toISOString().slice(0, 19).replace('T', ' ')}'`;
    const params = new URLSearchParams({
      format: 'json',
      COMMAND: `'${this.spacecraftId}'`,
      CENTER: `'${center}'`,
      EPHEM_TYPE: "'VECTORS'",
      START_TIME: fmt(start),
      STOP_TIME: fmt(end),
      STEP_SIZE: "'10 min'",
      VEC_TABLE: "'3'",
      OUT_UNITS: "'KM-S'",
      REF_PLANE: "'ECLIPTIC'",
      REF_SYSTEM: "'J2000'",
      CSV_FORMAT: "'YES'",
    });

    const resp = await fetch(`${this.apiBase}?${params}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    return this._parseVectors(json.result);
  }

  _parseVectors(text) {
    const soe = text.indexOf('$$SOE');
    const eoe = text.indexOf('$$EOE');
    if (soe === -1 || eoe === -1) return null;

    const lines = text.substring(soe + 5, eoe).trim().split('\n').filter(l => l.trim());
    const points = [];

    for (const line of lines) {
      const c = line.split(',').map(s => s.trim());
      if (c.length < 11) continue;

      const ts = this._parseDate(c[1]);
      if (!ts) continue;

      points.push({
        timestamp: ts,
        vx: parseFloat(c[5]),
        vy: parseFloat(c[6]),
        vz: parseFloat(c[7]),
        range: parseFloat(c[9]),
        rangeRate: parseFloat(c[10]),
        speed: Math.sqrt(parseFloat(c[5]) ** 2 + parseFloat(c[6]) ** 2 + parseFloat(c[7]) ** 2),
      });
    }
    return points;
  }

  // ===== OBSERVER query (RA, DEC, constellation, light-time, solar distance) =====

  async _fetchObserver(start, end) {
    const fmt = (d) => `'${d.toISOString().slice(0, 19).replace('T', ' ')}'`;
    const params = new URLSearchParams({
      format: 'json',
      COMMAND: `'${this.spacecraftId}'`,
      CENTER: "'399'",
      EPHEM_TYPE: "'OBSERVER'",
      START_TIME: fmt(new Date()),
      STOP_TIME: fmt(new Date(Date.now() + 60000)),
      STEP_SIZE: "'1 min'",
      QUANTITIES: "'1,19,21,29'",
      CAL_FORMAT: "'CAL'",
      ANG_FORMAT: "'HMS'",
    });

    const resp = await fetch(`${this.apiBase}?${params}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    return this._parseObserver(json.result);
  }

  _parseObserver(text) {
    const soe = text.indexOf('$$SOE');
    const eoe = text.indexOf('$$EOE');
    if (soe === -1 || eoe === -1) return null;

    const dataLine = text.substring(soe + 5, eoe).trim().split('\n')[0];
    if (!dataLine) return null;

    // Observer format is fixed-width, not CSV. Parse by known column positions.
    // Columns: Date(20) Flag(3) RA(ICRF)(18) DEC(12) r(18) rdot(12) 1-way_LT(14) Cnst(6)
    // We'll use regex to extract key fields.

    const parts = dataLine.trim();

    // RA: HH MM SS.ff  — find first time-like pattern after the date+flag
    const raMatch = parts.match(/\d{2}\s+\d{2}\s+\d{2}\.\d+\s+[+-]?\s*\d{2}\s+\d{2}\s+\d{2}\.\d+/);
    let ra = '--', dec = '--';
    if (raMatch) {
      const nums = raMatch[0].split(/\s+/);
      if (nums.length >= 6) {
        ra = `${nums[0]}h ${nums[1]}m ${nums[2]}s`;
        dec = `${nums[3]}° ${nums[4]}' ${nums[5]}"`;
      }
    }

    // Constellation (3-letter code)
    const cnstMatch = parts.match(/\s([A-Z][a-z]{2})\s*$/);
    const constellation = cnstMatch ? cnstMatch[1] : '--';

    // Solar distance r (AU)
    const rMatch = parts.match(/\d+\.\d{6,}/g);
    let distSun = '--';
    let lightTime = '--';
    if (rMatch && rMatch.length >= 1) {
      const rAU = parseFloat(rMatch[0]);
      distSun = (rAU * 149597870.7).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' km';
    }

    // Light-time (minutes)
    const ltMatch = parts.match(/\d+\.\d{5,}\s*$/m);
    if (!ltMatch) {
      // Try to find it differently — look for small decimal values
      const allDecimals = parts.match(/\d+\.\d{4,}/g);
      if (allDecimals) {
        for (const val of allDecimals) {
          const v = parseFloat(val);
          if (v > 0 && v < 5) { // light-time should be < 2 minutes
            lightTime = (v * 60).toFixed(1) + ' seg';
            break;
          }
        }
      }
    } else {
      lightTime = (parseFloat(ltMatch[0]) * 60).toFixed(1) + ' seg';
    }

    return { ra, dec, constellation, distSun, lightTime };
  }

  // ===== Merge & Interpolate =====

  _mergeVectors(earthPts, moonPts) {
    const merged = [];
    for (const ep of earthPts) {
      let closest = moonPts[0], minDiff = Infinity;
      for (const mp of moonPts) {
        const d = Math.abs(mp.timestamp - ep.timestamp);
        if (d < minDiff) { minDiff = d; closest = mp; }
      }
      merged.push({
        timestamp: ep.timestamp,
        distEarth: ep.range,
        distMoon: closest ? closest.range : 0,
        velocityKms: ep.speed,
        rangeRate: ep.rangeRate,
      });
    }
    this.vectorPoints = merged.sort((a, b) => a.timestamp - b.timestamp);
  }

  _interpolateVectors(nowMs) {
    if (this.vectorPoints.length < 2) {
      return { distEarth: 0, distMoon: 0, velocity: 0, rangeRate: 0, dataAge: 0 };
    }

    // Find bracketing points for interpolation
    let before = this.vectorPoints[0];
    let after = this.vectorPoints[this.vectorPoints.length - 1];

    for (let i = 0; i < this.vectorPoints.length - 1; i++) {
      if (this.vectorPoints[i].timestamp <= nowMs && this.vectorPoints[i + 1].timestamp >= nowMs) {
        before = this.vectorPoints[i];
        after = this.vectorPoints[i + 1];
        break;
      }
    }

    const span = after.timestamp - before.timestamp;
    const t = span > 0 ? Math.max(0, Math.min(1, (nowMs - before.timestamp) / span)) : 0;

    // Age = time since the "before" data point
    const ageMs = nowMs - before.timestamp;
    const ageMins = Math.round(ageMs / 60000);

    return {
      distEarth: before.distEarth + (after.distEarth - before.distEarth) * t,
      distMoon: before.distMoon + (after.distMoon - before.distMoon) * t,
      velocity: (before.velocityKms + (after.velocityKms - before.velocityKms) * t) * 3600,
      rangeRate: before.rangeRate + (after.rangeRate - before.rangeRate) * t,
      dataAge: ageMins,
    };
  }

  // ===== Date parser for Horizons =====

  _parseDate(raw) {
    const cleaned = raw.trim().replace(/A\.D\.\s*/, '').replace(/\.0+$/, '').replace(/\s+/g, ' ').trim();
    const m = cleaned.match(/(\d{4})-(\w{3})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
    if (!m) return null;
    const months = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
    if (!(m[2] in months)) return null;
    return new Date(Date.UTC(+m[1], months[m[2]], +m[3], +m[4], +m[5], +m[6])).getTime();
  }
}

window.TelemetryEngine = TelemetryEngine;
