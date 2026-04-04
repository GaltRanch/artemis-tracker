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
    this.controls.minDistance = 20;
    this.controls.maxDistance = 2000;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.3;
    this.controls.target.set(0, 0, 0);

    // Lighting
    const sun = new THREE.DirectionalLight(0xffffff, 2.5);
    sun.position.set(-500, 100, 300);
    this.scene.add(sun);
    this.scene.add(new THREE.AmbientLight(0x1a1a3a, 0.6));

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

  _createEarth() {
    const loader = new THREE.TextureLoader();
    const geo = new THREE.SphereGeometry(6.371, 64, 64); // radius = 6.371 (1 unit = 1000 km)

    loader.load('https://www.solarsystemscope.com/textures/download/2k_earth_daymap.jpg', (tex) => {
      const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, metalness: 0.1 });
      this._earth = new THREE.Mesh(geo, mat);
      this._earth.position.set(0, 0, 0);
      this.scene.add(this._earth);

      // Atmosphere glow
      const atmosGeo = new THREE.SphereGeometry(6.8, 32, 32);
      const atmosMat = new THREE.MeshBasicMaterial({
        color: 0x4488ff, transparent: true, opacity: 0.08, side: THREE.BackSide,
      });
      const atmos = new THREE.Mesh(atmosGeo, atmosMat);
      this._earth.add(atmos);
    }, undefined, () => {
      // Fallback
      const mat = new THREE.MeshStandardMaterial({ color: 0x2563eb, roughness: 0.6 });
      this._earth = new THREE.Mesh(geo, mat);
      this.scene.add(this._earth);
    });
  }

  _createMoon() {
    const loader = new THREE.TextureLoader();
    const geo = new THREE.SphereGeometry(1.737, 32, 32);

    loader.load('https://www.solarsystemscope.com/textures/download/2k_moon.jpg', (tex) => {
      const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, metalness: 0 });
      this._moon = new THREE.Mesh(geo, mat);
      this._moon = new THREE.Mesh(geo, mat);
      this.scene.add(this._moon);
    }, undefined, () => {
      const mat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.8 });
      this._moon = new THREE.Mesh(geo, mat);
      this.scene.add(this._moon);
    });
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

    const base = '/api/horizons';
    try {
      // Spacecraft trajectory (Earth-centered)
      const params = new URLSearchParams({
        format: 'json', COMMAND: `'${config.horizonsId}'`, CENTER: "'399'",
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
        format: 'json', COMMAND: "'301'", CENTER: "'399'",
        EPHEM_TYPE: "'VECTORS'", START_TIME: "'2026-04-02 02:00'",
        STOP_TIME: "'2026-04-10 23:50'", STEP_SIZE: "'6 h'",
        VEC_TABLE: "'2'", OUT_UNITS: "'KM-S'",
        REF_PLANE: "'ECLIPTIC'", REF_SYSTEM: "'J2000'", CSV_FORMAT: "'YES'",
      });
      const moonResp = await fetch(`${base}?${moonParams}`);
      const moonJson = await moonResp.json();
      this._moonPositions = this._parseVectors(moonJson.result);

      if (this._realTrajectory?.length > 0) {
        this._loaded = true;
        this._buildTrajectoryMesh();
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
      if (c.length < 11) return null;
      const ts = this._parseDate(c[1]);
      if (!ts) return null;
      // Convert km to scene units (1 unit = 1000 km)
      return {
        timestamp: ts,
        x: parseFloat(c[2]) / 1000,
        y: parseFloat(c[3]) / 1000,
        z: parseFloat(c[4]) / 1000,
        range: parseFloat(c[9]),
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

    // Orion marker (glowing sphere)
    const orionGeo = new THREE.SphereGeometry(2, 16, 16);
    const orionMat = new THREE.MeshBasicMaterial({ color: 0xf97316 });
    this._orion = new THREE.Mesh(orionGeo, orionMat);
    this.scene.add(this._orion);

    // Orion glow
    const glowGeo = new THREE.SphereGeometry(5, 16, 16);
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xf97316, transparent: true, opacity: 0.15,
    });
    this._orionGlow = new THREE.Mesh(glowGeo, glowMat);
    this.scene.add(this._orionGlow);

    // Orion label
    const orionLabel = this._createTextSprite('ORION', 0xf97316);
    orionLabel.position.set(0, 8, 0);
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

    // ===== Auto-center camera on trajectory + Moon =====
    if (this._moon) {
      plannedPts.push(this._moon.position.clone());
    }
    this._centerCamera(plannedPts);
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

    // Update Orion position
    if (this._orion && idx < traj.length) {
      const p = traj[idx];
      this._orion.position.set(p.x, p.z, -p.y);
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

    // Update Moon position
    if (this._moon && this._moonPositions?.length > 0) {
      let mp = this._moonPositions[0];
      for (const m of this._moonPositions) {
        if (m.timestamp <= nowMs) mp = m;
      }
      this._moon.position.set(mp.x, mp.z, -mp.y);

      // Update Earth-Moon line
      if (this._emLine) {
        const pts = [new THREE.Vector3(0, 0, 0), this._moon.position.clone()];
        this._emLine.geometry.setFromPoints(pts);
      }
    }

    // Rotate Earth slowly
    if (this._earth) {
      this._earth.rotation.y += 0.001;
    }
  }

  _animate() {
    requestAnimationFrame(() => this._animate());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
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
