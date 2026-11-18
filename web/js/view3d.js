// 3D view (three.js): competition field (line spacing from the selected field preset),
// ONE centre rail, robot guided by it (rollers at both axles), measured wheels and line
// sensors, Z column + SCARA arm, LED. 1 scene unit = 1 mm for field and robot alike.
import * as THREE from 'three';
import { OrbitControls } from '../vendor/three/OrbitControls.js';
import { fieldGeometry, robotGeometry } from './params.js';
import { F } from './sim-host.js';

const COLORS = {
  floor: 0xd9dde3, work: 0xc9e3f4, table: 0x2f3b45, rail: 0x9aa4ad, line: 0x111111, start: 0x4caf50,
  green: 0x2e9b57, red: 0xc0392b, chassis: 0x56616b, wheel: 0x1d1f22, sensorOff: 0xf0f0f0, sensorOn: 0xff3b30,
  arm: 0x8d99a6, fork: 0xf3c34b, column: 0x6c7a86,
};

function textSprite(text, size = 64, color = '#111') {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = color;
  g.font = `bold ${size}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  s.scale.set(90, 90, 1);
  return s;
}

export class View3D {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xeef1f4);
    this.camera = new THREE.PerspectiveCamera(40, 1, 5, 20000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.follow = false;
    const hemi = new THREE.HemisphereLight(0xffffff, 0x8a8f99, 1.6);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(900, 2200, 600);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -1600, right: 1600, top: 1600, bottom: -1600, near: 100, far: 5000 });
    this.scene.add(sun);
    this.fieldGroup = new THREE.Group();
    this.scene.add(this.fieldGroup);
    this.robot = new THREE.Group();
    this.scene.add(this.robot);
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => this.render());
  }

  resize() {
    const w = this.container.clientWidth || 600, h = this.container.clientHeight || 400;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  build(params) {
    this.params = params;
    this.geo = fieldGeometry(params);
    const L = this.geo.length;
    this.L = L;
    const g = this.fieldGroup;
    g.clear();
    const box = (w, h, d, color, x, y, z, opts = {}, name = '') => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...opts }));
      m.position.set(x, y, z);
      m.receiveShadow = true;
      if (name) m.name = name;
      g.add(m);
      return m;
    };
    // floor + work area
    box(1200, 10, L, COLORS.floor, 0, -5, 0);
    box(900, 2, L, COLORS.work, 0, 1, 0);
    // side tables (tray strips) - raised
    const tableH = 300;
    for (const sx of [-1, 1]) {
      box(150, tableH, L, COLORS.table, sx * 525, tableH / 2, 0);
    }
    // ONE centre rail along the whole field (the robot's guide rollers straddle it)
    const rg = robotGeometry(params);
    box(rg.rail.width, rg.rail.height, L, COLORS.rail, 0, rg.rail.height / 2, 0, { metalness: 0.4, roughness: 0.4 }, 'rail-center');
    // end frames
    for (const sz of [-1, 1]) box(1200, 60, 30, 0x7b8691, 0, 30, sz * (L / 2 + 15), {}, sz < 0 ? 'end-start' : 'end-far');
    // start zone
    const sz = this.geo.startZone;
    const start = new THREE.Mesh(new THREE.PlaneGeometry(500, sz), new THREE.MeshStandardMaterial({ color: COLORS.start, transparent: true, opacity: 0.55 }));
    start.rotation.x = -Math.PI / 2;
    start.position.set(0, 2.2, -L / 2 + sz / 2);
    g.add(start);
    // black lines + labels
    this.geo.lines.forEach((c, i) => {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(900, this.geo.width), new THREE.MeshBasicMaterial({ color: COLORS.line }));
      line.name = `line-${i}`;
      line.rotation.x = -Math.PI / 2;
      line.position.set(0, 2.6, c - L / 2);
      g.add(line);
      const label = textSprite(String(i));
      label.position.set(-380, 40, c - L / 2 - 45);
      g.add(label);
    });
    // trays: rules fig.5 - one side green/red/green/red/green, other side the opposite
    const shelfMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 });
    this.geo.lines.forEach((c, i) => {
      for (const sx of [-1, 1]) {
        const isGreen = (sx === 1) === (i % 2 === 0);
        const color = isGreen ? COLORS.green : COLORS.red;
        const tray = new THREE.Group();
        const shell = new THREE.Mesh(new THREE.BoxGeometry(110, 215, 120), new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.55, roughness: 0.6 }));
        shell.position.y = 215 / 2;
        tray.add(shell);
        for (let k = 0; k < 10; k++) {
          const shelf = new THREE.Mesh(new THREE.BoxGeometry(112, 2, 122), shelfMat);
          shelf.position.y = 20 + k * 15;
          tray.add(shelf);
        }
        tray.position.set(sx * 525, tableH, c - L / 2);
        g.add(tray);
      }
    });
    this.buildRobot(params);
    this.setCamera('overview');
  }

  buildRobot(p) {
    const r = this.robot;
    r.clear();
    // robot-local frame: origin = motor-axle centre on the floor, +z forward, +x left
    const rg = robotGeometry(p);
    this.rg = rg;
    const len = rg.length, width = rg.width, R = rg.r;
    const mid = (rg.rearEnd + rg.frontEnd) / 2;
    const deckY = 2 * R + 10;
    const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, ...o });
    const add = (mesh, name) => { mesh.name = name; r.add(mesh); return mesh; };
    // chassis: two side beams over the wheels + a deck, open in the middle for the centre rail
    for (const sx of [-1, 1]) {
      const beam = add(new THREE.Mesh(new THREE.BoxGeometry(40, 40, len), mat(COLORS.chassis, { metalness: 0.3 })), sx > 0 ? 'beam-left' : 'beam-right');
      beam.position.set(sx * (width / 2 - 20), deckY - 20, mid);
      beam.castShadow = true;
    }
    // semi-transparent deck so the centre rail, guide rollers and sensors stay visible from above
    const deck = add(new THREE.Mesh(new THREE.BoxGeometry(width, 8, len), mat(0x3d4650, { transparent: true, opacity: 0.45, depthWrite: false })), 'chassis');
    deck.position.set(0, deckY + 4, mid);
    deck.castShadow = true;
    // wheels: driven pair on the motor axle, passive pair (omni) on the other axle
    this.wheels = [];
    this.passiveWheels = [];
    for (const [z, driven, tag] of [[0, true, rg.motorFront ? 'front' : 'rear'], [rg.passiveAxle, false, rg.motorFront ? 'rear' : 'front']]) {
      const wr = driven ? R : rg.passiveR;
      const wheelGeo = new THREE.CylinderGeometry(wr, wr, 30, 40);
      wheelGeo.rotateZ(Math.PI / 2);
      for (const sx of [-1, 1]) {
        const w = add(new THREE.Mesh(wheelGeo, mat(driven ? COLORS.wheel : 0x5f7f99)), `wheel-${tag}-${sx > 0 ? 'L' : 'R'}`);
        w.position.set(sx * (rg.track / 2), wr, z);
        w.castShadow = true;
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(32, wr * 1.4, 8), mat(driven ? 0xb0b8c0 : 0xdfe6ec));
        w.add(spoke);
        (driven ? this.wheels : this.passiveWheels).push(w);
      }
      const axle = add(new THREE.Mesh(new THREE.CylinderGeometry(4, 4, rg.track, 10), mat(0x6f7a85, { metalness: 0.6 })), `axle-${tag}`);
      axle.rotation.z = Math.PI / 2;
      axle.position.set(0, wr, z);
    }
    // centre-rail guide rollers at both axles (one on each side of the rail)
    const rollerGeo = new THREE.CylinderGeometry(9, 9, Math.max(rg.rail.height, 12), 16);
    for (const z of [rg.frontAxle, rg.rearAxle]) {
      for (const sx of [-1, 1]) {
        const roller = add(new THREE.Mesh(rollerGeo, mat(0xf0a030, { metalness: 0.3 })), `guide-${z === rg.frontAxle ? 'front' : 'rear'}-${sx > 0 ? 'L' : 'R'}`);
        roller.position.set(sx * (rg.rail.width / 2 + rg.rail.clearance + 9), rg.rail.height / 2 + 2, z);
      }
      const bracket = add(new THREE.Mesh(new THREE.BoxGeometry(rg.rail.width + 2 * rg.rail.clearance + 50, 6, 24), mat(0x7b8691)), 'guide-bracket');
      bracket.position.set(0, rg.rail.height + 8, z);
    }
    // line sensors (just beside the rail so they see the floor lines)
    this.sensorMeshes = [];
    rg.sensors.forEach((sn, i) => {
      const sm = add(new THREE.Mesh(new THREE.BoxGeometry(24, 14, 24), mat(COLORS.sensorOff, { emissive: 0x000000 })), `sensor-${sn.port}`);
      sm.position.set(rg.sensorLateral, 12, sn.s);
      const lbl = textSprite(String(sn.port), 70, '#c0392b');
      lbl.scale.set(50, 50, 1);
      lbl.position.set(rg.sensorLateral + 40, 30, sn.s);
      r.add(lbl);
      this.sensorMeshes.push(sm);
    });
    // Z column + SCARA arm (visual only; kinematics assumptions in settings)
    const baseZ = Number(p['viz.armBaseMm'] ?? 0);
    const colH = 760;
    const column = new THREE.Mesh(new THREE.BoxGeometry(60, colH, 60), mat(COLORS.column, { metalness: 0.4 }));
    column.position.set(0, deckY + 8 + colH / 2, baseZ);
    column.castShadow = true;
    r.add(column);
    this.carriage = new THREE.Group();
    this.carriage.position.set(0, 0, baseZ);
    r.add(this.carriage);
    const L1 = Number(p['viz.link1Mm'] ?? 232.5), L2 = Number(p['viz.link2Mm'] ?? 175), L3 = Number(p['viz.forkMm'] ?? 195);
    this.j1 = new THREE.Group();
    this.carriage.add(this.j1);
    const link = (len, w, color) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 26, len), mat(color, { metalness: 0.3 }));
      m.position.z = len / 2;
      m.castShadow = true;
      return m;
    };
    this.j1.add(link(L1, 60, COLORS.arm));
    this.j2 = new THREE.Group();
    this.j2.position.z = L1;
    this.j1.add(this.j2);
    this.j2.add(link(L2, 50, COLORS.arm));
    this.wristG = new THREE.Group();
    this.wristG.position.z = L2;
    this.j2.add(this.wristG);
    const fork = link(L3, 70, COLORS.fork);
    fork.scale.y = 0.3;
    this.wristG.add(fork);
    // LED
    this.led = new THREE.Mesh(new THREE.SphereGeometry(16, 20, 14), new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0x000000 }));
    this.led.position.set(-width / 2 + 40, deckY + 25, rg.frontEnd - 60);
    r.add(this.led);
    this.armBaseH = Number(p['viz.armHomeHeightMm'] ?? 524);
  }

  setCamera(mode) {
    const L = this.L || 2000;
    this.follow = mode === 'follow';
    if (mode === 'overview') {
      this.camera.position.set(1500, 1900, -L / 2 - 900);
      this.controls.target.set(0, 150, 0);
    } else if (mode === 'top') {
      this.camera.position.set(0, 2600 + L * 0.3, -1);
      this.controls.target.set(0, 0, 0);
    } else if (mode === 'side') {
      this.camera.position.set(2300, 500, 0);
      this.controls.target.set(0, 150, 0);
    } else if (mode === 'follow') {
      this.camera.position.set(900, 900, this.robot.position.z - 900);
      this.controls.target.copy(this.robot.position).add(new THREE.Vector3(0, 150, 200));
    }
    this.controls.update();
  }

  update(f, p) {
    if (!f || !this.geo) return;
    const L = this.L;
    const prevZ = this.robot.position.z;
    // F.y: left of the travel direction = +x in the scene; yaw CCW from above = +rotation.y
    this.robot.position.set(Number.isFinite(f[F.y]) ? f[F.y] : 0, 0, f[F.x] - L / 2);
    this.robot.rotation.y = Number.isFinite(f[F.yaw]) ? (f[F.yaw] * Math.PI) / 180 : 0;
    if (this.follow) {
      const dz = this.robot.position.z - prevZ;
      this.camera.position.z += dz;
      this.controls.target.z += dz;
    }
    // wheel spin from travel
    const ang = f[F.x] / (this.rg ? this.rg.r : 51.5);
    for (const w of this.wheels) w.rotation.x = ang;
    const angP = f[F.x] / (this.rg ? this.rg.passiveR : 45);
    for (const w of this.passiveWheels || []) w.rotation.x = angP;
    // sensors
    const lv = [f[F.sA], f[F.sB], f[F.sC], f[F.sD]];
    const black = Number(p['sensor.blackLevel'] ?? 1);
    this.sensorMeshes.forEach((m, i) => {
      const on = lv[i] === black;
      m.material.color.setHex(on ? COLORS.sensorOn : COLORS.sensorOff);
      m.material.emissive.setHex(on ? 0x550000 : 0x000000);
    });
    // arm
    const unitsPer90 = Number(p['viz.unitsPer90'] ?? 25000);
    const sign = Number(p['viz.j1Sign'] ?? -1);
    const wsign = Number(p['viz.wristSign'] ?? -1);
    const zero = (Number(p['viz.armZeroDeg'] ?? 0) * Math.PI) / 180;
    const a1 = sign * (f[F.j1] / unitsPer90) * (Math.PI / 2);
    const a2 = sign * (f[F.j2] / unitsPer90) * (Math.PI / 2);
    this.j1.rotation.y = zero + a1;
    this.j2.rotation.y = a2;
    const wristDeg = (f[F.wrist] * 300) / 180 - 150;
    this.wristG.rotation.y = sign * wsign * (wristDeg * Math.PI) / 180;
    this.carriage.position.y = this.armBaseH + f[F.z];
    // LED (pixel 0)
    const c = f[F.led0] | 0;
    this.led.material.color.setHex(c || 0x222222);
    this.led.material.emissive.setHex(c ? c : 0x000000);
  }

  // Read dimensions back from the scene objects themselves (1 unit = 1 mm) for checks.
  measure() {
    this.scene.updateMatrixWorld(true);
    const bb = (o) => new THREE.Box3().setFromObject(o);
    const lines = [], rails = [];
    this.fieldGroup.traverse((o) => {
      if (/^line-\d/.test(o.name)) { const b = bb(o); lines.push({ name: o.name, zMin: b.min.z, zMax: b.max.z }); }
      if (o.isMesh && (/rail/i.test(o.name) || (o.material && o.material.color && o.material.color.getHex() === COLORS.rail))) { const b = bb(o); rails.push({ name: o.name, xMin: b.min.x, xMax: b.max.x, yMax: b.max.y, zLen: b.max.z - b.min.z }); }
    });
    lines.sort((a, b) => a.zMin - b.zMin);
    const get = (n) => this.robot.getObjectByName(n);
    const wp = (o) => o.getWorldPosition(new THREE.Vector3());
    const field0 = -this.L / 2;
    const chassis = bb(get('chassis'));
    const wheels = {};
    this.robot.traverse((o) => {
      if (!/^wheel-/.test(o.name)) return;
      const rad = o.geometry.parameters.radiusTop * o.getWorldScale(new THREE.Vector3()).y; // the cylinder itself, not the spoke
      const c = wp(o);
      wheels[o.name] = { dia: 2 * rad, z: c.z - field0, zFront: c.z + rad - field0, axleHeight: c.y };
    });
    const sensors = {};
    this.robot.traverse((o) => { if (/^sensor-/.test(o.name)) sensors[o.name] = { z: wp(o).z - field0 }; });
    const robotRails = [];
    this.robot.traverse((o) => { if (o.isMesh && (/rail/i.test(o.name) || (o.material && o.material.color && o.material.color.getHex() === COLORS.rail))) robotRails.push(o.name); });
    return {
      fieldLength: this.L, lines: lines.map((l) => ({ name: l.name, near: l.zMin - field0, far: l.zMax - field0, width: l.zMax - l.zMin })),
      rails, robotRails, robotRear: chassis.min.z - field0, robotFront: chassis.max.z - field0, robotWidth: chassis.max.x - chassis.min.x,
      motorAxle: wp(get(`axle-${this.rg.motorFront ? 'front' : 'rear'}`)).z - field0,
      wheels, sensors, robotX: this.robot.position.x, robotYawDeg: (this.robot.rotation.y * 180) / Math.PI,
    };
  }

  render() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
