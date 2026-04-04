/**
 * Additional NASA data sources: DSN Now, DONKI Space Weather, NASA Images.
 */

class NASADataSources {
  constructor() {
    this.dsn = null;
    this.spaceWeather = null;
    this.images = null;
    this._dsnInterval = null;

    this.fetchAll();
    // DSN refreshes every 60s, DONKI/Images every 10min
    this._dsnInterval = setInterval(() => this.fetchDSN(), 60_000);
    setInterval(() => { this.fetchDONKI(); this.fetchImages(); }, 600_000);
  }

  async fetchAll() {
    await this.fetchDSN();
    await this.fetchDONKI();
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

      // Radiation risk assessment
      const maxKp = storms.length > 0 ? Math.max(...storms.map(s => s.maxKp)) : 0;
      const hasXFlare = flares.some(f => f.classType && f.classType.startsWith('X'));
      const hasMFlare = flares.some(f => f.classType && f.classType.startsWith('M'));
      let riskLevel = 'BAJO';
      let riskColor = 'green';
      if (hasXFlare || maxKp >= 7) { riskLevel = 'ALTO'; riskColor = 'red'; }
      else if (hasMFlare || maxKp >= 5) { riskLevel = 'MODERADO'; riskColor = 'orange'; }

      this.spaceWeather = {
        flares,
        storms,
        cmeCount,
        notifications,
        maxKp,
        riskLevel,
        riskColor,
        lastUpdate: new Date().toISOString(),
      };

      console.log(`[DONKI] ${flares.length} flares, ${storms.length} storms, ${cmeCount} CMEs, risk: ${riskLevel}`);
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
}

window.NASADataSources = NASADataSources;
