import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/**
 * 3D Trajectory renderer using real JPL Horizons data.
 * Earth/Moon with NASA textures, real trajectory path, interactive camera.
 */

class Trajectory3D {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.scene = new THREE.Scene();
    this.clock = new THREE.Clock();

    // State
    this._realTrajectory = null;
    this._moonPositions = null;
    this._loaded = false;
    this._loading = false;
    this._currentIdx = 0;

    // Objects
    this._earth = null;
    this._moon = null;
    this._orion = null;
    this._orionGlow = null;
    this._traveledLine = null;
    this._plannedLine = null;
    this._tliMarker = null;
    this._labels = [];

    this._init();
  }

  _init() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.container.appendChild(this.renderer.domElement);

    // Camera (will be repositioned when trajectory loads)
    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 5000);
    this.camera.position.set(0, 300, 0);

    // Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 2000;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.3;
    this.controls.target.set(0, 0, 0);

    // Lighting — placeholder, will be repositioned with real Sun data
    this._sunLight = new THREE.DirectionalLight(0xfff5e0, 3.0);
    this._sunLight.position.set(-500, 100, 300);
    this.scene.add(this._sunLight);
    this.scene.add(new THREE.AmbientLight(0x0a0a1a, 0.3));

    // Starfield background
    this._createStarfield();

    // Earth
    this._createEarth();

    // Moon (placeholder, will be repositioned with real data)
    this._createMoon();

    // Info labels (HTML overlay)
    this._createLabels();

    // Loading text
    this._loadingMesh = this._createTextSprite('Cargando trayectoria NASA/JPL...', 0x06d6d6);
    this._loadingMesh.position.set(200, 30, 0);
    this.scene.add(this._loadingMesh);

    // Resize handler
    window.addEventListener('resize', () => this._onResize());

    // Animate
    this._animate();
  }

  _createStarfield() {
    const geo = new THREE.BufferGeometry();
    const verts = [];
    for (let i = 0; i < 6000; i++) {
      const r = 1500 + Math.random() * 1500;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      verts.push(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.sin(phi) * Math.sin(theta),
        r * Math.cos(phi)
      );
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    const mat = new THREE.PointsMaterial({ color: 0xaabbff, size: 0.8, sizeAttenuation: true });
    this.scene.add(new THREE.Points(geo, mat));
  }

  _fixTex(tex) {
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  _createEarth() {
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    const segs = isMobile ? 32 : 64;
    const geo = new THREE.SphereGeometry(6.371, segs, segs);
    const loader = new THREE.TextureLoader();
    const suffix = isMobile ? '_1k.jpg' : '.jpg';
    const TEX = 'assets/textures/';

    // Create Earth immediately with fallback color, update when texture loads
    const mat = new THREE.MeshPhongMaterial({ color: 0x2563eb, specular: new THREE.Color(0x222244), shininess: 15 });
    this._earth = new THREE.Mesh(geo, mat);
    this.scene.add(this._earth);

    // Atmosphere glow (no texture needed)
    const atmosMat = new THREE.ShaderMaterial({
      vertexShader: `
        varying vec3 vNormal;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        varying vec3 vNormal;
        void main() {
          float intensity = pow(0.65 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.5);
          gl_FragColor = vec4(0.3, 0.6, 1.0, intensity * 0.4);
        }`,
      transparent: true, side: THREE.BackSide, depthWrite: false,
    });
    this._earth.add(new THREE.Mesh(new THREE.SphereGeometry(7.0, 32, 32), atmosMat));

    // Load day texture
    loader.load(TEX + 'earth_daymap' + suffix, (tex) => {
      this._fixTex(tex);
      this._earth.material.map = tex;
      this._earth.material.color.set(0xffffff);
      this._earth.material.needsUpdate = true;
      console.log('[3D] Earth day texture loaded');
    }, undefined, (e) => console.warn('[3D] Earth day texture failed', e));

    // Cloud layer
    loader.load(TEX + 'earth_clouds' + suffix, (tex) => {
      this._fixTex(tex);
      const cloudMat = new THREE.MeshPhongMaterial({ map: tex, transparent: true, opacity: 0.35, depthWrite: false });
      this._earthClouds = new THREE.Mesh(new THREE.SphereGeometry(6.42, 48, 48), cloudMat);
      this._earth.add(this._earthClouds);
      console.log('[3D] Earth clouds loaded');
    }, undefined, () => {});

    // Night lights
    loader.load(TEX + 'earth_nightmap' + suffix, (tex) => {
      this._fixTex(tex);
      const nightMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false });
      this._earthNight = new THREE.Mesh(new THREE.SphereGeometry(6.375, 64, 64), nightMat);
      this._earth.add(this._earthNight);
      console.log('[3D] Earth night texture loaded');
    }, undefined, () => {});
  }

  _createMoon() {
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    const geo = new THREE.SphereGeometry(1.737, 32, 32);
    const loader = new THREE.TextureLoader();
    const suffix = isMobile ? '_1k.jpg' : '.jpg';

    // Create Moon immediately with fallback color
    const mat = new THREE.MeshPhongMaterial({ color: 0x94a3b8, shininess: 2, specular: new THREE.Color(0x111111) });
    this._moon = new THREE.Mesh(geo, mat);
    this._moon.rotation.y = Math.PI * 0.5;
    this.scene.add(this._moon);

    loader.load('assets/textures/moon' + suffix, (tex) => {
      this._fixTex(tex);
      this._moon.material.map = tex;
      this._moon.material.bumpMap = tex;
      this._moon.material.bumpScale = 0.2;
      this._moon.material.color.set(0xffffff);
      this._moon.material.needsUpdate = true;
      console.log('[3D] Moon texture loaded');
    }, undefined, (e) => console.warn('[3D] Moon texture failed', e));
  }

  _createLabels() {
    // Earth label
    const earthLabel = this._createTextSprite('TIERRA', 0x4488ff);
    earthLabel.position.set(0, 12, 0);
    this.scene.add(earthLabel);
    this._labels.push(earthLabel);
  }

  _createTextSprite(text, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.font = 'bold 24px Orbitron, monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
    ctx.fillText(text, 128, 40);

    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(30, 7.5, 1);
    return sprite;
  }

  // ===== Load trajectory from JPL Horizons =====

  async loadTrajectory(config) {
    if (this._loading || this._loaded) return;
    this._loading = true;

    const base = 'api/horizons';
    try {
      // Spacecraft trajectory (Earth-centered)
      const params = new URLSearchParams({
        format: 'json', COMMAND: `'${config.horizonsId}'`, CENTER: "'@399'",
        EPHEM_TYPE: "'VECTORS'", START_TIME: "'2026-04-02 02:00'",
        STOP_TIME: "'2026-04-10 23:50'", STEP_SIZE: "'1 h'",
        VEC_TABLE: "'3'", OUT_UNITS: "'KM-S'",
        REF_PLANE: "'ECLIPTIC'", REF_SYSTEM: "'J2000'", CSV_FORMAT: "'YES'",
      });
      const resp = await fetch(`${base}?${params}`);
      const json = await resp.json();
      this._realTrajectory = this._parseVectors(json.result);

      // Moon position
      await new Promise(r => setTimeout(r, 800));
      const moonParams = new URLSearchParams({
        format: 'json', COMMAND: "'301'", CENTER: "'@399'",
        EPHEM_TYPE: "'VECTORS'", START_TIME: "'2026-04-02 02:00'",
        STOP_TIME: "'2026-04-10 23:50'", STEP_SIZE: "'6 h'",
        VEC_TABLE: "'2'", OUT_UNITS: "'KM-S'",
        REF_PLANE: "'ECLIPTIC'", REF_SYSTEM: "'J2000'", CSV_FORMAT: "'YES'",
      });
      const moonResp = await fetch(`${base}?${moonParams}`);
      const moonJson = await moonResp.json();
      this._moonPositions = this._parseVectors(moonJson.result);

      // Full Moon orbit (~27 days) for orbital path visualization
      await new Promise(r => setTimeout(r, 800));
      const moonOrbitParams = new URLSearchParams({
        format: 'json', COMMAND: "'301'", CENTER: "'@399'",
        EPHEM_TYPE: "'VECTORS'", START_TIME: "'2026-03-20 00:00'",
        STOP_TIME: "'2026-04-16 08:00'", STEP_SIZE: "'8 h'",
        VEC_TABLE: "'2'", OUT_UNITS: "'KM-S'",
        REF_PLANE: "'ECLIPTIC'", REF_SYSTEM: "'J2000'", CSV_FORMAT: "'YES'",
      });
      const moonOrbitResp = await fetch(`${base}?${moonOrbitParams}`);
      const moonOrbitJson = await moonOrbitResp.json();
      this._moonOrbit = this._parseVectors(moonOrbitJson.result);

      // Sun position (geocentric, for correct lighting)
      await new Promise(r => setTimeout(r, 800));
      const sunParams = new URLSearchParams({
        format: 'json', COMMAND: "'10'", CENTER: "'@399'",
        EPHEM_TYPE: "'VECTORS'", START_TIME: "'2026-04-06 12:00'",
        STOP_TIME: "'2026-04-06 13:00'", STEP_SIZE: "'1 h'",
        VEC_TABLE: "'2'", OUT_UNITS: "'KM-S'",
        REF_PLANE: "'ECLIPTIC'", REF_SYSTEM: "'J2000'", CSV_FORMAT: "'YES'",
      });
      const sunResp = await fetch(`${base}?${sunParams}`);
      const sunJson = await sunResp.json();
      this._sunPosition = this._parseVectors(sunJson.result);

      if (this._realTrajectory?.length > 0) {
        this._loaded = true;
        this._buildTrajectoryMesh();
        this._positionSun();
        if (this._loadingMesh) {
          this.scene.remove(this._loadingMesh);
          this._loadingMesh = null;
        }
        console.log(`[3D] Loaded ${this._realTrajectory.length} trajectory points`);
      }
    } catch (err) {
      console.warn('[3D] Load failed:', err.message);
    }
    this._loading = false;
  }

  _parseVectors(text) {
    const soe = text.indexOf('$$SOE');
    const eoe = text.indexOf('$$EOE');
    if (soe === -1 || eoe === -1) return null;
    const lines = text.substring(soe + 5, eoe).trim().split('\n').filter(l => l.trim());
    return lines.map(line => {
      const c = line.split(',').map(s => s.trim());
      if (c.length < 5) return null;
      const ts = this._parseDate(c[1]);
      if (!ts) return null;
      // Convert km to scene units (1 unit = 1000 km)
      return {
        timestamp: ts,
        x: parseFloat(c[2]) / 1000,
        y: parseFloat(c[3]) / 1000,
        z: parseFloat(c[4]) / 1000,
        range: c.length >= 10 ? parseFloat(c[9]) : 0,
      };
    }).filter(Boolean);
  }

  _parseDate(raw) {
    const cleaned = raw.trim().replace(/A\.D\.\s*/, '').replace(/\.0+$/, '').replace(/\s+/g, ' ').trim();
    const m = cleaned.match(/(\d{4})-(\w{3})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
    if (!m) return null;
    const months = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
    if (!(m[2] in months)) return null;
    return new Date(Date.UTC(+m[1], months[m[2]], +m[3], +m[4], +m[5], +m[6])).getTime();
  }

  // ===== Build 3D meshes from trajectory data =====

  _buildTrajectoryMesh() {
    const traj = this._realTrajectory;

    // Full planned path (thin gray)
    const plannedPts = traj.map(p => new THREE.Vector3(p.x, p.z, -p.y)); // swap Y/Z for 3D
    const plannedGeo = new THREE.BufferGeometry().setFromPoints(plannedPts);
    this._plannedLine = new THREE.Line(plannedGeo, new THREE.LineBasicMaterial({
      color: 0x334466, transparent: true, opacity: 0.3,
    }));
    this.scene.add(this._plannedLine);

    // Traveled path (orange, will update length)
    const traveledGeo = new THREE.BufferGeometry().setFromPoints(plannedPts);
    this._traveledLine = new THREE.Line(traveledGeo, new THREE.LineBasicMaterial({
      color: 0xf97316, linewidth: 2,
    }));
    this.scene.add(this._traveledLine);

    // Orion MPCV capsule model — scaled down (real ~5m, Moon ~1737km)
    // Using scale 0.15 so it's visible but much smaller than the Moon
    this._orion = new THREE.Group();
    const S = 0.15; // capsule scale factor

    // Command Module — truncated cone (wider heat shield at bottom)
    const cmGeo = new THREE.CylinderGeometry(0.8 * S, 2.0 * S, 2.5 * S, 20);
    const cmMat = new THREE.MeshPhongMaterial({ color: 0xcccccc, shininess: 30, specular: 0x444444 });
    const cm = new THREE.Mesh(cmGeo, cmMat);
    cm.position.y = 2.2 * S;
    this._orion.add(cm);

    // Heat shield (dark disk at bottom of CM)
    const shieldGeo = new THREE.CylinderGeometry(2.0 * S, 2.0 * S, 0.3 * S, 20);
    const shieldMat = new THREE.MeshPhongMaterial({ color: 0x3a2a1a, shininess: 10 });
    const shield = new THREE.Mesh(shieldGeo, shieldMat);
    shield.position.y = 0.85 * S;
    this._orion.add(shield);

    // ESM — European Service Module (cylinder)
    const esmGeo = new THREE.CylinderGeometry(1.9 * S, 1.9 * S, 3.5 * S, 20);
    const esmMat = new THREE.MeshPhongMaterial({ color: 0xb8a060, shininess: 50, specular: 0x665533 });
    const esm = new THREE.Mesh(esmGeo, esmMat);
    esm.position.y = -1.1 * S;
    this._orion.add(esm);

    // Engine nozzle
    const nozzleGeo = new THREE.CylinderGeometry(0.5 * S, 0.8 * S, 1.0 * S, 12);
    const nozzleMat = new THREE.MeshPhongMaterial({ color: 0x555555, shininess: 60 });
    const nozzle = new THREE.Mesh(nozzleGeo, nozzleMat);
    nozzle.position.y = -3.3 * S;
    this._orion.add(nozzle);

    // 4 Solar panels in X configuration (Orion's distinctive feature)
    const panelGeo = new THREE.BoxGeometry(7 * S, 0.08 * S, 1.0 * S);
    const panelMat = new THREE.MeshPhongMaterial({ color: 0x162d50, shininess: 90, specular: 0x3366aa });
    for (let i = 0; i < 4; i++) {
      const panel = new THREE.Mesh(panelGeo, panelMat);
      panel.position.y = -1.1 * S;
      panel.rotation.y = (i * Math.PI) / 4;
      this._orion.add(panel);
    }

    this.scene.add(this._orion);

    // Orion glow (smaller)
    const glowGeo = new THREE.SphereGeometry(1.5, 16, 16);
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xf97316, transparent: true, opacity: 0.15,
    });
    this._orionGlow = new THREE.Mesh(glowGeo, glowMat);
    this.scene.add(this._orionGlow);

    // Orion label
    const orionLabel = this._createTextSprite('ORION', 0xf97316);
    orionLabel.position.set(0, 3, 0);
    this._orion.add(orionLabel);

    // TLI marker
    const launchMs = new Date('2026-04-01T22:35:12Z').getTime();
    const tliMs = launchMs + 90840 * 1000;
    let tliPt = null;
    for (const p of traj) {
      if (!tliPt || Math.abs(p.timestamp - tliMs) < Math.abs(tliPt.timestamp - tliMs)) {
        tliPt = p;
      }
    }
    if (tliPt) {
      const tliGeo = new THREE.OctahedronGeometry(2, 0);
      const tliMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24 });
      this._tliMarker = new THREE.Mesh(tliGeo, tliMat);
      this._tliMarker.position.set(tliPt.x, tliPt.z, -tliPt.y);
      this.scene.add(this._tliMarker);

      const tliLabel = this._createTextSprite('TLI', 0xfbbf24);
      tliLabel.position.set(0, 6, 0);
      this._tliMarker.add(tliLabel);
    }

    // Position Moon: use moon data if available, otherwise use the farthest trajectory point (flyby ≈ Moon location)
    if (this._moon) {
      if (this._moonPositions?.length > 0) {
        const mid = this._moonPositions[Math.floor(this._moonPositions.length / 2)];
        this._moon.position.set(mid.x, mid.z, -mid.y);
      } else {
        // Fallback: farthest point from Earth on the trajectory ≈ near the Moon
        let maxRange = 0, farthest = traj[0];
        for (const p of traj) {
          if (p.range > maxRange) { maxRange = p.range; farthest = p; }
        }
        this._moon.position.set(farthest.x, farthest.z, -farthest.y);
      }

      const moonLabel = this._createTextSprite('LUNA', 0x94a3b8);
      moonLabel.position.set(0, 6, 0);
      this._moon.add(moonLabel);
    }

    // Earth-Moon line (subtle)
    if (this._moon) {
      const lineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        this._moon.position.clone(),
      ]);
      const lineMat = new THREE.LineBasicMaterial({ color: 0x1a2744, transparent: true, opacity: 0.3 });
      this._emLine = new THREE.Line(lineGeo, lineMat);
      this.scene.add(this._emLine);
    }

    // ===== Moon orbit (full ~27-day path) =====
    if (this._moonOrbit?.length > 1) {
      const orbitPts = this._moonOrbit.map(p => new THREE.Vector3(p.x, p.z, -p.y));
      // Close the loop
      orbitPts.push(orbitPts[0].clone());

      const orbitGeo = new THREE.BufferGeometry().setFromPoints(orbitPts);
      const orbitMat = new THREE.LineDashedMaterial({
        color: 0x94a3b8, transparent: true, opacity: 0.15,
        dashSize: 3, gapSize: 3,
      });
      const orbitLine = new THREE.Line(orbitGeo, orbitMat);
      orbitLine.computeLineDistances(); // needed for dashed material
      this.scene.add(orbitLine);

      // "ORBITA LUNAR" label at top of orbit
      let topPt = orbitPts[0];
      for (const p of orbitPts) { if (p.y > topPt.y) topPt = p; }
      const orbitLabel = this._createTextSprite('ORBITA LUNAR', 0x64748b);
      orbitLabel.position.copy(topPt);
      orbitLabel.position.y += 8;
      this.scene.add(orbitLabel);

      console.log(`[3D] Moon orbit: ${orbitPts.length} points`);
    }

    // ===== Flyby marker — Moon position at closest approach =====
    if (this._moonPositions?.length > 0) {
      const flybyMs = new Date('2026-04-06T23:06:00Z').getTime();
      let flybyMoon = this._moonPositions[0];
      for (const m of this._moonPositions) {
        if (Math.abs(m.timestamp - flybyMs) < Math.abs(flybyMoon.timestamp - flybyMs)) flybyMoon = m;
      }

      // Purple marker at flyby location
      const flybyGeo = new THREE.RingGeometry(3, 4.5, 32);
      const flybyMat = new THREE.MeshBasicMaterial({ color: 0x8b5cf6, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
      const flybyMarker = new THREE.Mesh(flybyGeo, flybyMat);
      flybyMarker.position.set(flybyMoon.x, flybyMoon.z, -flybyMoon.y);
      flybyMarker.lookAt(0, 0, 0); // face Earth
      this.scene.add(flybyMarker);

      const flybyLabel = this._createTextSprite('FLYBY 6-7 ABR', 0x8b5cf6);
      flybyLabel.position.set(flybyMoon.x, flybyMoon.z + 8, -flybyMoon.y);
      this.scene.add(flybyLabel);
    }

    // ===== Auto-center camera on trajectory + Moon orbit =====
    if (this._moon) {
      plannedPts.push(this._moon.position.clone());
    }
    if (this._moonOrbit) {
      for (const p of this._moonOrbit) {
        plannedPts.push(new THREE.Vector3(p.x, p.z, -p.y));
      }
    }
    this._centerCamera(plannedPts);
  }

  _positionSun() {
    if (!this._sunPosition?.length) return;
    const s = this._sunPosition[0];
    // Sun is ~150M km away; normalize direction and place light + visual at scene edge
    const dir = new THREE.Vector3(s.x, s.z, -s.y).normalize();

    // Remove the DirectionalLight (limited frustum), use a single light
    // that illuminates everything from the Sun's direction
    this.scene.remove(this._sunLight);

    // PointLight very far away simulates sunlight on all objects regardless of position
    this._sunLight = new THREE.PointLight(0xfff5e0, 8.0, 0, 0); // no decay
    this._sunLight.position.copy(dir.clone().multiplyScalar(1200));
    this.scene.add(this._sunLight);

    // Visible Sun (billboard sprite at edge of scene)
    const sunPos = dir.clone().multiplyScalar(800);
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,250,220,1)');
    grad.addColorStop(0.15, 'rgba(255,220,100,0.9)');
    grad.addColorStop(0.4, 'rgba(255,180,50,0.3)');
    grad.addColorStop(1, 'rgba(255,150,30,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    const sunTex = new THREE.CanvasTexture(canvas);
    const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: sunTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    sunSprite.position.copy(sunPos);
    sunSprite.scale.set(200, 200, 1);
    this.scene.add(sunSprite);

    // Sun label
    const label = this._createTextSprite('SOL', 0xffcc44);
    label.position.copy(sunPos);
    label.position.y += 110;
    this.scene.add(label);

    // Sun-Earth direction line (very subtle)
    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      dir.clone().multiplyScalar(100),
    ]);
    const lineMat = new THREE.LineDashedMaterial({
      color: 0xffcc44, transparent: true, opacity: 0.1,
      dashSize: 4, gapSize: 4,
    });
    const sunLine = new THREE.Line(lineGeo, lineMat);
    sunLine.computeLineDistances();
    this.scene.add(sunLine);

    console.log(`[3D] Sun positioned at direction (${dir.x.toFixed(2)}, ${dir.y.toFixed(2)}, ${dir.z.toFixed(2)})`);
  }

  _centerCamera(pts) {
    // Compute bounding box of trajectory
    const box = new THREE.Box3();
    for (const p of pts) box.expandByPoint(p);
    // Include Earth (0,0,0)
    box.expandByPoint(new THREE.Vector3(0, 0, 0));

    const center = new THREE.Vector3();
    box.getCenter(center);

    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);

    // Point camera at the center of the trajectory, from above
    this.controls.target.copy(center);
    this.camera.position.set(
      center.x,
      center.y + maxDim * 0.9,  // above
      center.z + maxDim * 0.15  // slightly offset for perspective
    );
    this.camera.lookAt(center);
    this.controls.update();

    console.log(`[3D] Camera centered — box size: ${maxDim.toFixed(0)}, center: (${center.x.toFixed(0)}, ${center.y.toFixed(0)}, ${center.z.toFixed(0)})`);
  }

  // ===== Update per frame =====

  update(progress, config) {
    if (!this._loaded && !this._loading) {
      this.loadTrajectory(config);
    }

    if (!this._loaded || !this._realTrajectory) return;

    const traj = this._realTrajectory;
    const nowMs = Date.now();

    // Find current index
    let idx = 0;
    for (let i = 0; i < traj.length; i++) {
      if (traj[i].timestamp <= nowMs) idx = i;
    }
    this._currentIdx = idx;

    // Update Orion position and orientation
    if (this._orion && idx < traj.length) {
      const p = traj[idx];
      this._orion.position.set(p.x, p.z, -p.y);

      // Orient capsule along trajectory direction
      if (idx < traj.length - 1) {
        const next = traj[idx + 1];
        const dir = new THREE.Vector3(next.x - p.x, next.z - p.z, -(next.y - p.y)).normalize();
        const up = new THREE.Vector3(0, 1, 0);
        const quat = new THREE.Quaternion().setFromUnitVectors(up, dir);
        this._orion.quaternion.copy(quat);
      }

      if (this._orionGlow) {
        this._orionGlow.position.copy(this._orion.position);
        const t = this.clock.getElapsedTime();
        this._orionGlow.scale.setScalar(0.9 + 0.15 * Math.sin(t * 2));
      }
    }

    // Update traveled line (show only up to current index)
    if (this._traveledLine) {
      this._traveledLine.geometry.setDrawRange(0, idx + 1);
    }

    // Update Moon position — interpolate between data points for smooth movement
    if (this._moon && this._moonPositions?.length > 1) {
      let before = this._moonPositions[0];
      let after = this._moonPositions[this._moonPositions.length - 1];

      for (let i = 0; i < this._moonPositions.length - 1; i++) {
        if (this._moonPositions[i].timestamp <= nowMs && this._moonPositions[i + 1].timestamp >= nowMs) {
          before = this._moonPositions[i];
          after = this._moonPositions[i + 1];
          break;
        }
      }

      const span = after.timestamp - before.timestamp;
      const t = span > 0 ? Math.max(0, Math.min(1, (nowMs - before.timestamp) / span)) : 0;

      const mx = before.x + (after.x - before.x) * t;
      const my = before.y + (after.y - before.y) * t;
      const mz = before.z + (after.z - before.z) * t;

      this._moon.position.set(mx, mz, -my);

      // Update Earth-Moon line
      if (this._emLine) {
        const pts = [new THREE.Vector3(0, 0, 0), this._moon.position.clone()];
        this._emLine.geometry.setFromPoints(pts);
      }

      // Update Moon trail (past positions during mission)
      if (!this._moonTrail) {
        const trailMat = new THREE.LineBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.25 });
        const trailGeo = new THREE.BufferGeometry();
        this._moonTrail = new THREE.Line(trailGeo, trailMat);
        this.scene.add(this._moonTrail);
      }
      const trailPts = [];
      for (const m of this._moonPositions) {
        if (m.timestamp <= nowMs) {
          trailPts.push(new THREE.Vector3(m.x, m.z, -m.y));
        }
      }
      trailPts.push(this._moon.position.clone());
      this._moonTrail.geometry.setFromPoints(trailPts);
    }

    // Rotate Earth slowly
    if (this._earth) {
      this._earth.rotation.y += 0.001;
      if (this._earthClouds) this._earthClouds.rotation.y += 0.0003;
    }

    // Crew view from Orion
    this._updateOrionPOV();
  }

  _animate() {
    requestAnimationFrame(() => this._animate());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  // ===== Camera focus modes =====

  focusOrion() {
    if (!this._orion || !this._loaded) return;
    this._orionPOV = false;
    const pos = this._orion.position.clone();
    this.controls.autoRotate = false;

    // Animate to Orion: target = Orion, camera offset for close-up
    const targetDist = 40;
    this.controls.target.copy(pos);
    this.camera.position.set(
      pos.x + targetDist * 0.3,
      pos.y + targetDist * 0.7,
      pos.z + targetDist * 0.5
    );
    this.camera.lookAt(pos);
    this.controls.update();
  }

  focusOrionPOV() {
    if (!this._orion || !this._loaded) return;
    this._orionPOV = true;
    this.controls.autoRotate = false;
    // Camera will be updated each frame in update()
  }

  _updateOrionPOV() {
    if (!this._orionPOV || !this._orion || !this._moon) return;
    const traj = this._realTrajectory;
    const idx = this._currentIdx;
    if (!traj || idx >= traj.length) return;

    const p = traj[idx];
    const pos = new THREE.Vector3(p.x, p.z, -p.y);
    const moonPos = this._moon.position.clone();

    // Camera at Orion, looking toward the Moon (crew window view)
    const toMoon = moonPos.clone().sub(pos).normalize();
    const camPos = pos.clone().add(toMoon.clone().multiplyScalar(0.5));

    this.camera.position.copy(camPos);
    this.camera.lookAt(moonPos);
    this.controls.target.copy(moonPos);
    this.controls.update();
  }

  focusAll() {
    if (!this._loaded || !this._realTrajectory) return;
    this._orionPOV = false;
    this.controls.autoRotate = true;

    // Rebuild the full bounding box like _buildTrajectoryMesh does
    const pts = this._realTrajectory.map(p => new THREE.Vector3(p.x, p.z, -p.y));
    if (this._moon) pts.push(this._moon.position.clone());
    if (this._moonOrbit) {
      for (const p of this._moonOrbit) {
        pts.push(new THREE.Vector3(p.x, p.z, -p.y));
      }
    }
    this._centerCamera(pts);
  }

  _onResize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }
}

window.Trajectory3D = Trajectory3D;
window.dispatchEvent(new Event('trajectory3d-ready'));
