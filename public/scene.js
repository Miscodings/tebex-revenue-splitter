// Atmosphere (crescent moon + stars) and the coin shower used by the payout calculator.
// Everything is optional: no WebGL or "reduce motion" just means a still backdrop and no coins.
import * as THREE from './vendor/three.module.min.js';

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const dpr = () => Math.min(window.devicePixelRatio || 1, 2);

function makeRenderer(canvas) {
  try {
    const r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    r.setClearColor(0x000000, 0);
    return r;
  } catch { return null; }
}
function ortho(w, h) { const c = new THREE.OrthographicCamera(0, w, h, 0, -10, 10); return c; } // y up, origin bottom-left

function radialTexture(stops) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'); const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  stops.forEach(([o, col]) => grd.addColorStop(o, col)); g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// crescent = big circle minus an offset circle
function crescentGeometry(R, r, d) {
  const x = (d * d + R * R - r * r) / (2 * d), y = Math.sqrt(R * R - x * x);
  const th = Math.atan2(y, x), ph = Math.atan2(y, x - d);
  const s = new THREE.Shape();
  s.moveTo(x, y);
  s.absarc(0, 0, R, th, 2 * Math.PI - th, false);
  s.absarc(d, 0, r, -ph, ph, true);
  return new THREE.ShapeGeometry(s, 72);
}

/* ---------- backdrop ---------- */
const bgCanvas = document.getElementById('bg');
const bg = bgCanvas && makeRenderer(bgCanvas);
let W = innerWidth, H = innerHeight;
let bgScene, bgCam, stars, twinkle, moonGroup, glow;

function buildBackdrop() {
  bgScene = new THREE.Scene(); bgCam = ortho(W, H);
  const dot = radialTexture([[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,.7)'], [1, 'rgba(255,255,255,0)']]);
  const n = Math.min(320, Math.floor((W * H) / 5200));
  const pos = new Float32Array(n * 3), pos2 = new Float32Array(48 * 3);
  const rnd = (i) => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }; // stable layout
  for (let i = 0; i < n; i++) { pos[i * 3] = rnd(i) * W; pos[i * 3 + 1] = rnd(i + 999) * H; }
  for (let i = 0; i < 48; i++) { pos2[i * 3] = rnd(i + 5000) * W; pos2[i * 3 + 1] = rnd(i + 7000) * H; }
  const g1 = new THREE.BufferGeometry(); g1.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const g2 = new THREE.BufferGeometry(); g2.setAttribute('position', new THREE.BufferAttribute(pos2, 3));
  stars = new THREE.Points(g1, new THREE.PointsMaterial({ size: 2.4, map: dot, transparent: true, opacity: 0.55, depthWrite: false, color: 0xb9c4ff, sizeAttenuation: false }));
  twinkle = new THREE.Points(g2, new THREE.PointsMaterial({ size: 4.2, map: dot, transparent: true, opacity: 0.8, depthWrite: false, color: 0xfff1cf, sizeAttenuation: false }));
  bgScene.add(stars, twinkle);

  moonGroup = new THREE.Group();
  const k = W < 700 ? 0.42 : W < 1000 ? 0.7 : 1; // smaller on phones so it never sits under text
  const mx = W - Math.max(150, W * 0.12) * (k < 1 ? 0.45 : 1), my = H - Math.max(130, H * 0.16) * (k < 1 ? 0.45 : 1);
  moonGroup.position.set(mx, my, 0);
  moonGroup.scale.setScalar(k);
  glow = new THREE.Mesh(new THREE.PlaneGeometry(520, 520), new THREE.MeshBasicMaterial({
    map: radialTexture([[0, 'rgba(240,196,106,.55)'], [0.4, 'rgba(240,196,106,.12)'], [1, 'rgba(240,196,106,0)']]),
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.35,
  }));
  glow.position.set(-10, 0, -1);
  // dimmed on purpose: text sits over it, so it must stay well below text contrast
  const moon = new THREE.Mesh(crescentGeometry(86, 76, 30), new THREE.MeshBasicMaterial({ color: 0xbdb7a4, transparent: true, opacity: 0.32 }));
  moon.rotation.z = 0.5;
  moonGroup.add(glow, moon);
  bgScene.add(moonGroup);
}

function sizeBackdrop() {
  W = innerWidth; H = innerHeight;
  if (!bg) return;
  bg.setPixelRatio(dpr()); bg.setSize(W, H, false);
  buildBackdrop();
  bg.render(bgScene, bgCam);
}

let mouse = { x: 0.5, y: 0.5 }, last = 0, t0 = performance.now();
function loopBackdrop(now) {
  requestAnimationFrame(loopBackdrop);
  if (document.hidden || now - last < 33) return; // ~30fps is plenty for a slow sky
  last = now; const t = (now - t0) / 1000;
  twinkle.material.opacity = 0.55 + 0.3 * Math.sin(t * 0.9);
  stars.material.opacity = 0.5 + 0.08 * Math.sin(t * 0.4);
  stars.position.x = (mouse.x - 0.5) * -10; stars.position.y = (mouse.y - 0.5) * 6;
  moonGroup.position.y += (Math.sin(t * 0.3) * 0.05); // barely drifts
  glow.material.opacity = 0.33 + 0.05 * Math.sin(t * 0.6);
  bg.render(bgScene, bgCam);
}

if (bg) {
  sizeBackdrop();
  let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(sizeBackdrop, 120); });
  if (!reduce) { addEventListener('pointermove', (e) => { mouse.x = e.clientX / W; mouse.y = e.clientY / H; }, { passive: true }); requestAnimationFrame(loopBackdrop); }
}

/* ---------- coin shower ---------- */
const fxCanvas = document.getElementById('fx');
const fx = fxCanvas && !reduce ? makeRenderer(fxCanvas) : null;
const MAX = 150;
let fxScene, fxCam, rim, face, coins = [], running = false;
const dummy = new THREE.Object3D();
if (fx) {
  fxScene = new THREE.Scene(); fxCam = ortho(W, H);
  const geo = new THREE.CircleGeometry(1, 28);
  rim = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ transparent: true }), MAX);
  face = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ transparent: true }), MAX);
  face.position.z = 0.1;
  [rim, face].forEach((m) => { m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; fxScene.add(m); });
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < MAX; i++) { rim.setMatrixAt(i, zero); face.setMatrixAt(i, zero); rim.setColorAt(i, new THREE.Color(0)); face.setColorAt(i, new THREE.Color(0)); }
  const sizeFx = () => { fx.setPixelRatio(dpr()); fx.setSize(innerWidth, innerHeight, false); fxCam.right = innerWidth; fxCam.top = innerHeight; fxCam.updateProjectionMatrix(); };
  sizeFx(); addEventListener('resize', sizeFx);
}

const ease = (p) => 1 - Math.pow(1 - p, 3);
function tick(now) {
  if (!coins.length) { running = false; fx.clear(); return; }
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const H2 = innerHeight;
  for (let i = 0; i < MAX; i++) {
    const c = coins[i];
    if (!c) { rim.setMatrixAt(i, zero); face.setMatrixAt(i, zero); continue; }
    const p = (now - c.t0) / c.dur;
    if (p < 0) { rim.setMatrixAt(i, zero); face.setMatrixAt(i, zero); continue; }
    if (p >= 1) { coins[i] = null; rim.setMatrixAt(i, zero); face.setMatrixAt(i, zero); continue; }
    const e = ease(p);
    const x = c.x0 + (c.x1 - c.x0) * e;
    const y = (1 - e) * (1 - e) * c.y0 + 2 * (1 - e) * e * c.cy + e * e * c.y1;
    const flip = Math.abs(Math.cos(p * c.spin));
    const fade = p > 0.86 ? 1 - (p - 0.86) / 0.14 : 1;
    const s = c.r * fade;
    dummy.position.set(x, H2 - y, 0); dummy.rotation.z = 0; dummy.scale.set(s, Math.max(0.12, flip) * s, 1); dummy.updateMatrix();
    rim.setMatrixAt(i, dummy.matrix);
    dummy.scale.set(s * 0.74, Math.max(0.12, flip) * s * 0.74, 1); dummy.updateMatrix();
    face.setMatrixAt(i, dummy.matrix);
  }
  rim.instanceMatrix.needsUpdate = true; face.instanceMatrix.needsUpdate = true;
  fx.render(fxScene, fxCam);
  if (coins.every((c) => !c)) { coins = []; fx.clear(); running = false; return; }
  requestAnimationFrame(tick);
}

/**
 * Rain coins from a point into target spots.
 * from: {x,y} in viewport pixels; targets: [{x,y,color,weight}] (weight = share of coins)
 */
function shower(from, targets, total = 60) {
  if (!fx || !targets.length) return;
  const sum = targets.reduce((a, t) => a + Math.max(0, t.weight), 0) || 1;
  const now = performance.now(); let slot = 0;
  coins = new Array(MAX).fill(null);
  for (const t of targets) {
    const n = Math.round(Math.max(0, t.weight) / sum * Math.min(total, MAX));
    const col = new THREE.Color(t.color);
    for (let k = 0; k < n && slot < MAX; k++, slot++) {
      coins[slot] = {
        t0: now + k * 18 + Math.random() * 260, dur: 900 + Math.random() * 500,
        x0: from.x + (Math.random() - 0.5) * 80, y0: from.y,
        x1: t.x + (Math.random() - 0.5) * (t.spread || 60), y1: t.y + (Math.random() - 0.5) * 8,
        cy: from.y - 60 - Math.random() * 90, r: 6 + Math.random() * 3.5, spin: 14 + Math.random() * 18,
      };
      rim.setColorAt(slot, col.clone().multiplyScalar(0.55)); face.setColorAt(slot, col.clone().lerp(new THREE.Color(0xffffff), 0.18));
    }
  }
  rim.instanceColor.needsUpdate = true; face.instanceColor.needsUpdate = true;
  if (!running) { running = true; requestAnimationFrame(tick); }
}

window.RevenueScene = { shower, enabled: !!fx };
