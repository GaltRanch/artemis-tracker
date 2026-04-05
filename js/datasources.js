/**
 * Additional NASA data sources: DSN Now, DONKI Space Weather, NASA Images.
 */

class NASADataSources {
  constructor() {
    this.dsn = null;
    this.spaceWeather = null;
    this.images = null;
    this.epic = null;
    this.apod = null;
    this.neo = null;
    this.cad = null;
    this.sentry = null;

    this.fetchAll();
    setInterval(() => this.fetchDSN(), 60_000);
    setInterval(() => { this.fetchDONKI(); this.fetchEPIC(); this.fetchAPOD(); this.fetchNEO(); this.fetchCAD(); this.fetchImages(); }, 600_000);
    setInterval(() => this.fetchSentry(), 6 * 3600_000); // Sentry updates daily
  }

  async fetchAll() {
    await this.fetchDSN();
    await this.fetchDONKI();
    await this.fetchEPIC();
    await this.fetchAPOD();
    await this.fetchNEO();
    await this.fetchCAD();
    await this.fetchSentry();
    await this.fetchImages();
  }

  // ===== Deep Space Network =====

  async fetchDSN() {
    try {
      const resp = await fetch('/api/dsn');
      const text = await resp.text();
      this.dsn = this._parseDSN(text);
    } catch (err) {
      console.warn('[DSN] Fetch failed:', err.message);
    }
  }

  _parseDSN(xml) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'text/xml');
    const stations = [];
    let currentStation = null;

    // Iterate children of <dsn>
    const dsn = doc.querySelector('dsn');
    if (!dsn) return null;

    const em2Dishes = [];

    for (const node of dsn.children) {
      if (node.tagName === 'station') {
        currentStation = {
          name: node.getAttribute('friendlyName') || node.getAttribute('name'),
          code: node.getAttribute('name'),
        };
        stations.push(currentStation);
      } else if (node.tagName === 'dish') {
        const dish = {
          name: node.getAttribute('name'),
          azimuth: parseFloat(node.getAttribute('azimuthAngle')) || 0,
          elevation: parseFloat(node.getAttribute('elevationAngle')) || 0,
          windSpeed: parseFloat(node.getAttribute('windSpeed')) || 0,
          activity: node.getAttribute('activity') || '',
          station: currentStation ? currentStation.name : 'Unknown',
          stationCode: currentStation ? currentStation.code : '',
          signals: [],
          targets: [],
        };

        for (const child of node.children) {
          if (child.tagName === 'downSignal' || child.tagName === 'upSignal') {
            dish.signals.push({
              direction: child.tagName === 'upSignal' ? 'up' : 'down',
              active: child.getAttribute('active') === 'true',
              type: child.getAttribute('signalType'),
              dataRate: parseFloat(child.getAttribute('dataRate')) || 0,
              band: child.getAttribute('band'),
              power: parseFloat(child.getAttribute('power')) || 0,
              spacecraft: child.getAttribute('spacecraft'),
              spacecraftID: child.getAttribute('spacecraftID'),
            });
          } else if (child.tagName === 'target') {
            dish.targets.push({
              name: child.getAttribute('name'),
              id: child.getAttribute('id'),
              uplegRange: parseFloat(child.getAttribute('uplegRange')) || 0,
              downlegRange: parseFloat(child.getAttribute('downlegRange')) || 0,
              rtlt: parseFloat(child.getAttribute('rtlt')) || 0,
            });
          }
        }

        // Check if this dish is tracking EM2 (Artemis II)
        const isEM2 = dish.targets.some(t => t.name === 'EM2') ||
                      dish.signals.some(s => s.spacecraft === 'EM2');
        if (isEM2) {
          em2Dishes.push(dish);
        }
      }
    }

    // Extract EM2-specific data
    const em2Target = em2Dishes.length > 0
      ? em2Dishes[0].targets.find(t => t.name === 'EM2')
      : null;

    const activeSignals = em2Dishes.flatMap(d =>
      d.signals.filter(s => s.active && s.spacecraft === 'EM2')
    );

    return {
      stations,
      em2Dishes,
      em2Target,
      activeSignals,
      dishCount: em2Dishes.length,
      stationsTracking: [...new Set(em2Dishes.map(d => d.station))],
      range: em2Target ? em2Target.downlegRange : null,
      rtlt: em2Target ? em2Target.rtlt : null,
      bands: [...new Set(activeSignals.map(s => s.band))],
      maxDataRate: Math.max(0, ...activeSignals.map(s => s.dataRate)),
    };
  }

  // ===== DONKI Space Weather =====

  async fetchDONKI() {
    const end = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);

    try {
      // Sequential to avoid 429 rate limiting with DEMO_KEY
      const flrResp = await fetch(`/api/donki/FLR?startDate=${start}&endDate=${end}`).then(r => r.ok ? r.json() : []).catch(() => []);
      await new Promise(r => setTimeout(r, 1200));
      const gstResp = await fetch(`/api/donki/GST?startDate=${start}&endDate=${end}`).then(r => r.ok ? r.json() : []).catch(() => []);
      await new Promise(r => setTimeout(r, 1200));
      const cmeResp = await fetch(`/api/donki/CME?startDate=${start}&endDate=${end}`).then(r => r.ok ? r.json() : []).catch(() => []);
      await new Promise(r => setTimeout(r, 1200));
      const notifResp = await fetch(`/api/donki/notifications?startDate=${start}&endDate=${end}&type=all`).then(r => r.ok ? r.json() : []).catch(() => []);
      await new Promise(r => setTimeout(r, 1200));
      const rbeResp = await fetch(`/api/donki/RBE?startDate=${start}&endDate=${end}`).then(r => r.ok ? r.json() : []).catch(() => []);
      await new Promise(r => setTimeout(r, 1200));
      const ipsResp = await fetch(`/api/donki/IPS?startDate=${start}&endDate=${end}`).then(r => r.ok ? r.json() : []).catch(() => []);

      // Process flares
      const flares = (Array.isArray(flrResp) ? flrResp : []).map(f => ({
        id: f.flrID,
        begin: f.beginTime,
        peak: f.peakTime,
        end: f.endTime,
        classType: f.classType,
        sourceLocation: f.sourceLocation,
        region: f.activeRegionNum,
        link: f.link,
      })).sort((a, b) => new Date(b.peak) - new Date(a.peak));

      // Process geomagnetic storms
      const storms = (Array.isArray(gstResp) ? gstResp : []).map(g => ({
        id: g.gstID,
        start: g.startTime,
        kpIndices: (g.allKpIndex || []).map(k => ({
          time: k.observedTime,
          kp: k.kpIndex,
        })),
        maxKp: Math.max(0, ...(g.allKpIndex || []).map(k => k.kpIndex)),
        link: g.link,
      }));

      // CME count
      const cmeCount = Array.isArray(cmeResp) ? cmeResp.length : 0;

      // Notifications
      const notifications = (Array.isArray(notifResp) ? notifResp : []).map(n => ({
        type: n.messageType,
        time: n.messageIssueTime,
        url: n.messageURL,
        body: (n.messageBody || '').slice(0, 200),
      })).sort((a, b) => new Date(b.time) - new Date(a.time));

      // RBE — Radiation Belt Enhancement
      const rbeCount = Array.isArray(rbeResp) ? rbeResp.length : 0;
      const rbeEvents = (Array.isArray(rbeResp) ? rbeResp : []).map(r => ({
        time: r.eventTime,
        instruments: (r.instruments || []).map(i => i.displayName).join(', '),
      }));

      // IPS — Interplanetary Shocks
      const ipsEvents = (Array.isArray(ipsResp) ? ipsResp : []).map(i => ({
        time: i.eventTime,
        location: i.location,
        instruments: (i.instruments || []).map(x => x.displayName).join(', '),
      }));

      // Radiation risk assessment
      const maxKp = storms.length > 0 ? Math.max(...storms.map(s => s.maxKp)) : 0;
      const hasXFlare = flares.some(f => f.classType && f.classType.startsWith('X'));
      const hasMFlare = flares.some(f => f.classType && f.classType.startsWith('M'));
      const hasRBE = rbeCount > 0;
      let riskLevel = 'BAJO';
      let riskColor = 'green';
      if (hasXFlare || maxKp >= 7) { riskLevel = 'ALTO'; riskColor = 'red'; }
      else if (hasMFlare || maxKp >= 5 || hasRBE) { riskLevel = 'MODERADO'; riskColor = 'orange'; }

      this.spaceWeather = {
        flares, storms, cmeCount, notifications,
        rbeEvents, rbeCount, ipsEvents,
        maxKp, riskLevel, riskColor,
        lastUpdate: new Date().toISOString(),
      };

      console.log(`[DONKI] ${flares.length} flares, ${storms.length} storms, ${cmeCount} CMEs, ${rbeCount} RBE, ${ipsEvents.length} IPS, risk: ${riskLevel}`);
    } catch (err) {
      console.warn('[DONKI] Fetch failed:', err.message);
    }
  }

  // ===== NASA Images =====

  async fetchImages() {
    try {
      const resp = await fetch('/api/images?q=artemis+II&media_type=image&year_start=2026');
      const json = await resp.json();
      const items = (json.collection?.items || []).slice(0, 20).map(item => {
        const data = item.data?.[0] || {};
        const thumb = item.links?.find(l => l.rel === 'preview')?.href || '';
        const medium = item.links?.find(l => l.render === 'image' && l.href?.includes('medium'))?.href || thumb;
        return {
          id: data.nasa_id,
          title: data.title,
          description: data.description?.slice(0, 150),
          date: data.date_created,
          photographer: data.photographer,
          thumb,
          medium,
        };
      });

      this.images = items;
      console.log(`[Images] Loaded ${items.length} Artemis II photos`);
    } catch (err) {
      console.warn('[Images] Fetch failed:', err.message);
    }
  }

  // ===== EPIC — Earth from deep space =====

  async fetchEPIC() {
    try {
      const resp = await fetch('/api/epic/api/natural');
      const data = await resp.json();
      if (!Array.isArray(data) || data.length === 0) return;

      this.epic = data.slice(0, 6).map(item => {
        const d = item.date.split(' ')[0].split('-'); // YYYY-MM-DD
        return {
          date: item.date,
          caption: item.caption,
          image: item.image,
          url: `https://epic.gsfc.nasa.gov/archive/natural/${d[0]}/${d[1]}/${d[2]}/thumbs/${item.image}.jpg`,
          urlFull: `https://epic.gsfc.nasa.gov/archive/natural/${d[0]}/${d[1]}/${d[2]}/png/${item.image}.png`,
          centroid: item.centroid_coordinates,
          dscovrPos: item.dscovr_j2000_position,
          lunarPos: item.lunar_j2000_position,
        };
      });

      console.log(`[EPIC] Loaded ${this.epic.length} Earth images from DSCOVR`);
    } catch (err) {
      console.warn('[EPIC] Fetch failed:', err.message);
    }
  }

  // ===== APOD — Astronomy Picture of the Day =====

  async fetchAPOD() {
    try {
      const resp = await fetch('/api/apod');
      const data = await resp.json();
      this.apod = {
        title: data.title,
        explanation: data.explanation,
        url: data.url,
        hdurl: data.hdurl,
        date: data.date,
        mediaType: data.media_type,
      };
      console.log(`[APOD] "${data.title}" (${data.date})`);
    } catch (err) {
      console.warn('[APOD] Fetch failed:', err.message);
    }
  }

  // ===== NeoWs — Near Earth Objects (7-day feed) =====

  async fetchNEO() {
    try {
      // 7-day window for upcoming close approaches
      const today = new Date().toISOString().slice(0, 10);
      const end = new Date(Date.now() + 6 * 86400_000).toISOString().slice(0, 10);
      const resp = await fetch(`/api/neo?start_date=${today}&end_date=${end}`);
      const data = await resp.json();

      // Flatten all NEOs across days
      const allNeos = [];
      for (const [date, list] of Object.entries(data.near_earth_objects || {})) {
        for (const n of list) allNeos.push(n);
      }

      // Parse and sort by closest approach time
      const parsed = allNeos.map(n => {
        const ca = n.close_approach_data?.[0] || {};
        const diamMin = n.estimated_diameter?.meters?.estimated_diameter_min || 0;
        const diamMax = n.estimated_diameter?.meters?.estimated_diameter_max || 0;
        const diamAvg = (diamMin + diamMax) / 2;
        return {
          name: n.name,
          id: n.id,
          designation: n.designation,
          diamMin: Math.round(diamMin),
          diamMax: Math.round(diamMax),
          diamAvg: Math.round(diamAvg),
          magnitude: n.absolute_magnitude_h,
          hazardous: n.is_potentially_hazardous_asteroid,
          sentry: n.is_sentry_object,
          jplUrl: n.nasa_jpl_url,
          velocityKmh: ca.relative_velocity?.kilometers_per_hour
            ? parseFloat(ca.relative_velocity.kilometers_per_hour) : 0,
          velocityKms: ca.relative_velocity?.kilometers_per_second
            ? parseFloat(ca.relative_velocity.kilometers_per_second) : 0,
          missDistanceKm: ca.miss_distance?.kilometers
            ? parseFloat(ca.miss_distance.kilometers) : 0,
          missDistanceLD: ca.miss_distance?.lunar
            ? parseFloat(ca.miss_distance.lunar) : 0,
          approachDateStr: ca.close_approach_date_full || '',
          approachTimeMs: ca.epoch_date_close_approach || 0,
        };
      });

      // Sort chronologically
      parsed.sort((a, b) => a.approachTimeMs - b.approachTimeMs);

      // Upcoming (future approach)
      const now = Date.now();
      const upcoming = parsed.filter(n => n.approachTimeMs > now);
      const past = parsed.filter(n => n.approachTimeMs <= now);
      const hazardous = parsed.filter(n => n.hazardous);
      const sentry = parsed.filter(n => n.sentry);

      // Next closest approach
      const nextApproach = upcoming[0] || null;

      // Closest this week
      const closest = [...parsed].sort((a, b) => a.missDistanceLD - b.missDistanceLD)[0] || null;

      // Biggest this week
      const biggest = [...parsed].sort((a, b) => b.diamAvg - a.diamAvg)[0] || null;

      // Fastest
      const fastest = [...parsed].sort((a, b) => b.velocityKmh - a.velocityKmh)[0] || null;

      this.neo = {
        count: data.element_count || parsed.length,
        hazardousCount: hazardous.length,
        sentryCount: sentry.length,
        upcomingCount: upcoming.length,
        pastCount: past.length,
        all: parsed,
        upcoming: upcoming.slice(0, 15),
        hazardous: hazardous.slice(0, 10),
        nextApproach,
        closest,
        biggest,
        fastest,
        objects: parsed.slice(0, 15),
      };

      console.log(`[NEO] 7d: ${this.neo.count} total, ${this.neo.hazardousCount} hazardous, ${this.neo.sentryCount} sentry, ${this.neo.upcomingCount} upcoming`);
    } catch (err) {
      console.warn('[NEO] Fetch failed:', err.message);
    }
  }

  // ===== CNEOS Close Approach Data (alternate source, more detail) =====

  async fetchCAD() {
    try {
      const resp = await fetch('/api/cad?dist-max=10LD&date-min=now&date-max=%2B30&fullname=true&sort=date');
      const data = await resp.json();
      if (!data.data) return;

      const fields = data.fields;
      const fi = (name) => fields.indexOf(name);

      this.cad = data.data.slice(0, 30).map(row => ({
        designation: row[fi('des')]?.trim(),
        fullname: row[fi('fullname')]?.trim(),
        date: row[fi('cd')],
        distAU: parseFloat(row[fi('dist')]),
        distLD: parseFloat(row[fi('dist')]) * 389.172, // 1 AU = 389.172 LD
        distKm: parseFloat(row[fi('dist')]) * 149597870.7,
        vRelKms: parseFloat(row[fi('v_rel')]),
        magnitude: parseFloat(row[fi('h')]),
      }));

      console.log(`[CAD] ${this.cad.length} approaches (30 days)`);
    } catch (err) {
      console.warn('[CAD] Fetch failed:', err.message);
    }
  }

  // ===== CNEOS Sentry — impact risk monitoring =====

  async fetchSentry() {
    try {
      const resp = await fetch('/api/sentry');
      const data = await resp.json();
      if (!data.data) return;

      // Parse and filter for highest risk objects
      const parsed = data.data.map(s => ({
        designation: s.des,
        fullname: s.fullname?.trim(),
        diameterKm: parseFloat(s.diameter) || 0,
        magnitude: parseFloat(s.h),
        impactProb: parseFloat(s.ip),
        cumulativeProb: parseFloat(s.ps_cum),
        maxTorino: parseInt(s.ts_max) || 0,
        maxPalermo: parseFloat(s.ps_max),
        impacts: parseInt(s.n_imp) || 0,
        range: s.range,
        velocityKms: parseFloat(s.v_inf),
      }));

      // Sort by cumulative Palermo scale (most concerning first)
      parsed.sort((a, b) => b.cumulativeProb - a.cumulativeProb);

      this.sentry = {
        total: data.count || parsed.length,
        top10: parsed.slice(0, 10),
        withTorino: parsed.filter(s => s.maxTorino > 0),
      };

      console.log(`[Sentry] ${this.sentry.total} monitored objects`);
    } catch (err) {
      console.warn('[Sentry] Fetch failed:', err.message);
    }
  }
}

window.NASADataSources = NASADataSources;
