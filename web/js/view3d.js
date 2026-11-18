// 3D view (three.js): competition field (rules V1.3 layout, line spacing from the
// selected field preset), rail-guided robot, line sensors, Z column + SCARA arm, LED.
import * as THREE from 'three';
import { OrbitControls } from '../vendor/three/OrbitControls.js';
import { fieldGeometry } from './params.js';
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
    const box = (w, h, d, color, x, y, z, opts = {}) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...opts }));
      m.position.set(x, y, z);
      m.receiveShadow = true;
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
    // rails: inner gap 288, width 30 (rules V1.3)
    for (const sx of [-1, 1]) box(30, 18, L, COLORS.rail, sx * 159, 9, 0, { metalness: 0.4, roughness: 0.4 });
    // end frames
    for (const sz of [-1, 1]) box(1200, 60, 30, 0x7b8691, 0, 30, sz * (L / 2 + 15));
    // start zone
    const sz = this.geo.startZone;
    const start = new THREE.Mesh(new THREE.PlaneGeometry(500, sz), new THREE.MeshStandardMaterial({ color: COLORS.start, transparent: true, opacity: 0.55 }));
    start.rotation.x = -Math.PI / 2;
    start.position.set(0, 2.2, -L / 2 + sz / 2);
    g.add(start);
    // black lines + labels
    this.geo.lines.forEach((c, i) => {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(900, this.geo.width), new THREE.MeshBasicMaterial({ color: COLORS.line }));
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
    const len = Number(p['robot.lengthMm']);
    const rear = Number(p['robot.rearOverhangMm']);
    const frontAxle = Number(p['robot.frontAxleMm']);
    const width = 400;
    const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, ...o });
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(width, 40, len), mat(COLORS.chassis, { metalness: 0.3 }));
    chassis.position.set(0, 75, len / 2 - rear);
    chassis.castShadow = true;
    r.add(chassis);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(width - 40, 6, len - 40), mat(0x3d4650));
    deck.position.set(0, 98, len / 2 - rear);
    r.add(deck);
    this.wheels = [];
    const wheelGeo = new THREE.CylinderGeometry(50.8, 50.8, 30, 32);
    wheelGeo.rotateZ(Math.PI / 2);
    for (const [z, driven] of [[0, true], [frontAxle, false]]) {
      for (const sx of [-1, 1]) {
        const w = new THREE.Mesh(wheelGeo, mat(driven ? COLORS.wheel : 0x444a52));
        w.position.set(sx * (width / 2 - 40), 50.8, z);
        w.castShadow = true;
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(32, 70, 8), mat(0xb0b8c0));
        w.add(spoke);
        r.add(w);
        if (driven) this.wheels.push(w);
      }
    }
    // line sensors
    this.sensorMeshes = [];
    for (let i = 0; i < Number(p['sensor.count'] || 2); i++) {
      const off = Number(p[`sensor.${i}.offsetMm`]);
      const s = new THREE.Mesh(new THREE.BoxGeometry(24, 14, 24), mat(COLORS.sensorOff, { emissive: 0x000000 }));
      s.position.set(0, 12, off);
      r.add(s);
      const lbl = textSprite(String(p[`sensor.${i}.port`]), 70, '#c0392b');
      lbl.scale.set(50, 50, 1);
      lbl.position.set(40, 30, off);
      r.add(lbl);
      this.sensorMeshes.push(s);
    }
    // Z column + SCARA arm (visual only; kinematics assumptions in settings)
    const baseZ = Number(p['viz.armBaseMm'] ?? 180);
    const colH = 760;
    const column = new THREE.Mesh(new THREE.BoxGeometry(60, colH, 60), mat(COLORS.column, { metalness: 0.4 }));
    column.position.set(0, 100 + colH / 2, baseZ);
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
    this.led.position.set(-width / 2 + 40, 115, len - rear - 60);
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
    this.robot.position.set(0, 0, f[F.x] - L / 2);
    if (this.follow) {
      const dz = this.robot.position.z - prevZ;
      this.camera.position.z += dz;
      this.controls.target.z += dz;
    }
    // wheel spin from travel
    const ang = (f[F.x] / 50.8);
    for (const w of this.wheels) w.rotation.x = ang;
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

  render() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
