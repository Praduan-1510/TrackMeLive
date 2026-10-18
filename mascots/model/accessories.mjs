// Track Me Live mascot accessories, modeled procedurally for three.js r160:
// over-ear headphones, round tortoiseshell glasses and a headlamp.
// Accessories keep their own colors whatever color the mascot wears.
//
// Nothing is placed by eye alone. Each accessory is fitted to its mascot when it is built: the
// band, the ear cushions, the strap and the temples are measured against the mascot's own
// vertices, so they rest on that character's hair, hood, fur or ears instead of sinking into them.
// FIT holds the few numbers that are a matter of taste: where the ears and eyes are, how far a
// band leans back, how high a strap sits.

export const ACCESSORIES = { headphones: 'Headphones', glasses: 'Glasses', headlamp: 'Headlamp' };

// Which accessories each mascot can wear. This is the source of truth for the app and the renders.
// Left out on purpose: anything that would fight gear a character already has (the Astronaut's
// helmet, the Robot's ear cans, Hero's goggles, Ninja's mask, Neko's hood ears, Ace's aviators,
// and the hat brims of Detective and Cowboy).
export const ACCESSORY_SUPPORT = {
  fox: ['headphones', 'glasses', 'headlamp'],
  ghost: ['headphones', 'glasses', 'headlamp'],
  robot: ['headlamp'],
  astronaut: [],
  hero: ['glasses'],
  star: ['headphones', 'glasses', 'headlamp'],
  ninja: ['headphones'],
  neko: ['glasses', 'headlamp'],
  ace: ['headphones', 'headlamp'],
  detective: ['glasses'],
  cowboy: ['glasses'],
  agent: ['headphones', 'glasses', 'headlamp'],
};

const C = {
  asphalt: 0x2a3236, satin: 0x343e43, cushion: 0x22292d, steel: 0xb4bcc0, amber: 0xf2a033,
  gold: 0xd9bb7a, lamp: 0xf7ae45,
};

// Per-character fitting, in the head's own frame (head radius ~1 at the origin, facing +Z).
//   headphones: ear = where the cup centers on the + side (mirrored), axis = how the cups tip
//               ([down, back] added to the outward axis), lean = how far the band tips back,
//               cupLean = how much of that lean the cups follow (0.4 unless set),
//               slider = how far the sliders reach out of the yokes (0.12).
//   glasses:    eye = lens center on the + side, r = lens radius, bridge = how high the bridge
//               arches above the lens centers, bend = face-form wrap, ear = where each temple
//               ends, tuck = temples slide under the hair rather than over it; also tilt
//               (how far the bottom tips in, 0.1) and gap (clearance in front of the face, 0.028).
//   headlamp:   y = strap height at the sides, tilt = how much higher it sits at the front;
//               also w (strap width, 0.13) and pitch (how far the lamp tips down, 0.1).
const FIT = {
  fox: {
    headphones: { ear: [1.02, -0.02, -0.1], axis: [-0.2, -0.08], lean: 0.62, cupLean: 0.45 },
    glasses: { eye: [0.36, 0.13], r: 0.2, bridge: 0.02, bend: 0.22, ear: [1.0, 0.16, -0.32] },
    headlamp: { y: 0.3, tilt: 0.2 },
  },
  ghost: {
    headphones: { ear: [0.98, 0.42, -0.04], axis: [-0.1, -0.04], lean: 0.08 },
    glasses: { eye: [0.33, 0.5], r: 0.19, bridge: 0.06, bend: 0.2, ear: [0.96, 0.52, -0.3] },
    headlamp: { y: 0.76, tilt: 0.12 },
  },
  robot: {
    headlamp: { y: 0.545, tilt: 0 },
  },
  hero: {
    glasses: { eye: [0.37, -0.1], r: 0.225, bridge: 0.07, bend: 0.2, ear: [0.98, 0.02, -0.12], tuck: true },
  },
  star: {
    headphones: { ear: [0.98, -0.08, -0.08], axis: [-0.12, -0.06], lean: 0.12 },
    glasses: { eye: [0.375, -0.12], r: 0.24, bridge: 0.08, bend: 0.2, ear: [0.98, 0.0, -0.12], tuck: true },
    headlamp: { y: 0.28, tilt: 0.08 },
  },
  ninja: {
    headphones: { ear: [1.0, -0.1, -0.06], axis: [-0.1, -0.04], lean: 0.12 },
  },
  neko: {
    glasses: { eye: [0.33, -0.11], r: 0.19, bridge: 0.06, bend: 0.2, ear: [0.92, -0.02, 0.3], tuck: true },
    headlamp: { y: 0.42, tilt: 0.1 },
  },
  ace: {
    headphones: { ear: [0.97, -0.12, -0.05], axis: [-0.1, -0.04], lean: 0.06 },
    headlamp: { y: 0.3, tilt: 0.18 },
  },
  detective: {
    glasses: { eye: [0.3, -0.06], r: 0.19, bridge: 0.07, bend: 0.2, ear: [0.99, 0.08, -0.06] },
  },
  cowboy: {
    glasses: { eye: [0.3, -0.07], r: 0.19, bridge: 0.07, bend: 0.2, ear: [0.99, 0.08, -0.06] },
  },
  agent: {
    headphones: { ear: [0.97, -0.12, -0.05], axis: [-0.1, -0.04], lean: 0.06 },
    glasses: { eye: [0.3, -0.06], r: 0.19, bridge: 0.07, bend: 0.2, ear: [0.99, 0.08, -0.06] },
    headlamp: { y: 0.3, tilt: 0.18 },
  },
};

// ---------- Small helpers ----------

const ss = (x, a, b) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}
// A superellipse: k = 2 is an ellipse, higher k squares it off.
const se = (a, k) => {
  const c = Math.cos(a), s = Math.sin(a);
  return [Math.sign(c) * Math.abs(c) ** (2 / k), Math.sign(s) * Math.abs(s) ** (2 / k)];
};

function mesh(THREE, geo, mat, o = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = o.cast !== false;
  m.receiveShadow = true;
  if (o.p) m.position.set(o.p[0], o.p[1], o.p[2]);
  if (o.s) m.scale.set(o.s[0], o.s[1], o.s[2]);
  if (o.r) m.rotation.set(o.r[0], o.r[1], o.r[2]);
  return m;
}

// A local frame as a matrix: x, y, z axes and an origin, all THREE.Vector3.
function basis(THREE, x, y, z, o) {
  return new THREE.Matrix4().makeBasis(x, y, z).setPosition(o);
}

// ---------- Measuring the mascot ----------
// Every vertex of the mascot (with its normal) in the head's own frame, hashed into a grid so a
// fit can ask what is solid near a point. The models are dense enough, a few hundredths apart,
// that their vertices stand in for their surfaces.

function measure(THREE, root, keep = () => true) {
  root.updateWorldMatrix(true, true);
  const inv = root.matrixWorld.clone().invert();
  const m = new THREE.Matrix4(), nm = new THREE.Matrix3(), v = new THREE.Vector3(), n = new THREE.Vector3();
  const P = [], N = [];
  root.traverse((o) => {
    if (!o.isMesh || !o.visible || !keep(o)) return;
    m.multiplyMatrices(inv, o.matrixWorld);
    nm.getNormalMatrix(m);
    const pos = o.geometry.attributes.position, nor = o.geometry.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      if (nor) n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize(); else n.set(0, 0, 0);
      P.push(v.x, v.y, v.z);
      N.push(n.x, n.y, n.z);
    }
  });
  const cell = 0.06;
  const key = (i, j, k) => ((i + 200) * 400 + (j + 200)) * 400 + (k + 200);
  const grid = new Map();
  for (let i = 0; i < P.length / 3; i++) {
    const k = key(Math.floor(P[i * 3] / cell), Math.floor(P[i * 3 + 1] / cell), Math.floor(P[i * 3 + 2] / cell));
    let a = grid.get(k);
    if (!a) grid.set(k, (a = []));
    a.push(i);
  }
  return {
    P: new Float32Array(P),
    N: new Float32Array(N),
    // Calls fn(i) for every vertex in the cube of half size r around c.
    near(c, r, fn) {
      const i0 = Math.floor((c.x - r) / cell), i1 = Math.floor((c.x + r) / cell);
      const j0 = Math.floor((c.y - r) / cell), j1 = Math.floor((c.y + r) / cell);
      const k0 = Math.floor((c.z - r) / cell), k1 = Math.floor((c.z + r) / cell);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) {
        const a = grid.get(key(i, j, k));
        if (a) for (const n of a) fn(n);
      }
    },
  };
}

// How far a flat section at P must move along d to clear the mascot. The section lies across b
// (half width hw), runs ds along T, and its inner face looks along -n. Anything up to `over`
// above that face counts as underneath it, so a strap rides over a lock of hair rather than
// through it; anything higher is something else's business.
function clearance(cloud, P, T, n, b, d, { hw, ds = 0.02, gap = 0.004, over = 0.1 }) {
  let need = 0;
  const dn = Math.max(0.3, d.dot(n));
  const A = cloud.P;
  // Only vertices above -gap can push, so the search stays within the section's own reach.
  cloud.near(P, Math.max(hw, ds, over) + 0.01, (i) => {
    const x = A[i * 3] - P.x, y = A[i * 3 + 1] - P.y, z = A[i * 3 + 2] - P.z;
    const up = x * n.x + y * n.y + z * n.z;
    if (up < -gap || up > over) return;
    if (Math.abs(x * T.x + y * T.y + z * T.z) > ds) return;
    if (Math.abs(x * b.x + y * b.y + z * b.z) > hw) return;
    const k = (up + gap) / dn;
    if (k > need) need = k;
  });
  return need;
}

// The average surface normal of what lies within r of P, or null over a gap.
function surfaceNormal(THREE, cloud, P, hint, r = 0.07) {
  const n = new THREE.Vector3();
  let w = 0;
  cloud.near(P, r, (i) => {
    const nx = cloud.N[i * 3], ny = cloud.N[i * 3 + 1], nz = cloud.N[i * 3 + 2];
    if (nx * hint.x + ny * hint.y + nz * hint.z < 0.2) return;
    n.x += nx; n.y += ny; n.z += nz;
    w++;
  });
  return w ? n.normalize() : null;
}

function tangents(THREE, pts, closed) {
  const n = pts.length;
  return pts.map((p, i) => {
    const a = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
    const c = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    return new THREE.Vector3().subVectors(c, a).normalize();
  });
}

// Moving max then moving average over a path's push amounts: the result never drops below the
// input, and bends instead of kinking.
function easeUp(vals, k, closed) {
  const n = vals.length;
  const at = (i) => vals[closed ? ((i % n) + n) % n : clamp(i, 0, n - 1)];
  const mx = vals.map((_, i) => {
    let m = -Infinity;
    for (let j = -k; j <= k; j++) m = Math.max(m, at(i + j));
    return m;
  });
  const at2 = (i) => mx[closed ? ((i % n) + n) % n : clamp(i, 0, n - 1)];
  return mx.map((_, i) => {
    let s = 0;
    for (let j = -k; j <= k; j++) s += at2(i + j);
    return s / (2 * k + 1);
  });
}

// ---------- Geometry ----------

// Sweep a rounded section along a path. Each point has an "out" vector: the section's depth runs
// along it (0..d from the path, or centered), and its width w runs across. k shapes the corners.
// prof(t) scales the section along the path; a profile falling to 0 rounds off the end.
// UVs are in head units: u along the path, v across the width (0..1), so textures keep their scale.
function sweep(THREE, pts, outs, o = {}) {
  const { w, d, k = 4, rad = 24, closed = false, center = false, prof = () => 1, profD = null, uScale = 1 } = o;
  const n = pts.length, rows = closed ? n + 1 : n;
  const T = tangents(THREE, pts, closed);
  const B = new THREE.Vector3(), N = new THREE.Vector3();
  const pos = [], uv = [], idx = [];
  let s = 0;
  for (let i = 0; i < rows; i++) {
    const ii = i % n, p = pts[ii];
    if (i > 0) s += p.distanceTo(pts[(i - 1) % n]);
    B.crossVectors(T[ii], outs[ii]).normalize();
    N.crossVectors(B, T[ii]).normalize();
    const t = closed ? i / n : i / (n - 1);
    const pw = Math.max(0, prof(t)), pd = profD ? Math.max(0, profD(t)) : pw;
    for (let j = 0; j <= rad; j++) {
      const [cx, cy] = se((j / rad) * Math.PI * 2, k);
      const x = cx * w * 0.5 * pw, y = cy * d * 0.5 * pd + (center ? 0 : d * 0.5 * pd);
      pos.push(p.x + B.x * x + N.x * y, p.y + B.y * x + N.y * y, p.z + B.z * x + N.z * y);
      uv.push(s * uScale, 0.5 + cx * 0.5);
    }
  }
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < rad; j++) {
      const a = i * (rad + 1) + j, b = a + 1, c = a + rad + 1, e = c + 1;
      idx.push(a, c, b, b, c, e);
    }
  }
  return seal(THREE, pos, uv, idx, rows, rad + 1, closed);
}

// Build an indexed grid geometry, smooth its normals and weld them across the seams.
function seal(THREE, pos, uv, idx, rows, cols, closedRows) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const nor = geo.attributes.normal;
  const v = new THREE.Vector3(), u = new THREE.Vector3();
  const weld = (a, b) => {
    v.fromBufferAttribute(nor, a).add(u.fromBufferAttribute(nor, b)).normalize();
    nor.setXYZ(a, v.x, v.y, v.z);
    nor.setXYZ(b, v.x, v.y, v.z);
  };
  for (let i = 0; i < rows; i++) weld(i * cols, i * cols + cols - 1);
  if (closedRows) for (let j = 0; j < cols; j++) weld(j, (rows - 1) * cols + j);
  return geo;
}

// A closed rounded form lofted through oval rings: ring = [scale, z]. The last ring at scale 0
// closes it. rx, ry and k set the oval; the form is built in its own frame (oval in x/y, depth z).
function loft(THREE, rings, { rx, ry, k = 2.4, seg = 96 }) {
  const pos = [], uv = [], idx = [];
  rings.forEach(([s, z], i) => {
    for (let j = 0; j <= seg; j++) {
      const [cx, cy] = se((j / seg) * Math.PI * 2, k);
      pos.push(cx * rx * s, cy * ry * s, z);
      uv.push(j / seg, i / (rings.length - 1));
    }
  });
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * (seg + 1) + j, b = a + 1, c = a + seg + 1, e = c + 1;
      idx.push(a, b, c, b, e, c);
    }
  }
  return seal(THREE, pos, uv, idx, rings.length, seg + 1, false);
}

// Split triangles until no edge is longer than maxEdge, then weld, so a flat cut piece can bend.
function tessellate(THREE, geo, maxEdge = 0.02) {
  const src = geo.index ? geo.toNonIndexed() : geo;
  const P = src.attributes.position, U = src.attributes.uv;
  const outP = [], outU = [];
  const emit = (...vs) => vs.forEach((q) => { outP.push(q.p[0], q.p[1], q.p[2]); outU.push(q.u[0], q.u[1]); });
  const mid = (a, b) => ({ p: a.p.map((x, i) => (x + b.p[i]) / 2), u: a.u.map((x, i) => (x + b.u[i]) / 2) });
  const len = (a, b) => Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1], a.p[2] - b.p[2]);
  const split = (a, b, c, dd) => {
    const ab = len(a, b), bc = len(b, c), ca = len(c, a);
    const m = Math.max(ab, bc, ca);
    if (m <= maxEdge || dd > 14) return emit(a, b, c);
    if (m === ab) { const q = mid(a, b); split(a, q, c, dd + 1); split(q, b, c, dd + 1); }
    else if (m === bc) { const q = mid(b, c); split(a, b, q, dd + 1); split(a, q, c, dd + 1); }
    else { const q = mid(c, a); split(a, b, q, dd + 1); split(q, b, c, dd + 1); }
  };
  const V = (i) => ({ p: [P.getX(i), P.getY(i), P.getZ(i)], u: U ? [U.getX(i), U.getY(i)] : [0, 0] });
  for (let i = 0; i < P.count; i += 3) split(V(i), V(i + 1), V(i + 2), 0);
  const keyOf = new Map(), pos = [], uv = [], idx = [];
  for (let i = 0; i < outP.length / 3; i++) {
    const k = `${Math.round(outP[i * 3] * 1e5)},${Math.round(outP[i * 3 + 1] * 1e5)},${Math.round(outP[i * 3 + 2] * 1e5)}`;
    let j = keyOf.get(k);
    if (j === undefined) {
      j = pos.length / 3;
      keyOf.set(k, j);
      pos.push(outP[i * 3], outP[i * 3 + 1], outP[i * 3 + 2]);
      uv.push(outU[i * 2], outU[i * 2 + 1]);
    }
    idx.push(j);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(idx);
  return out;
}

function roundedBox(THREE, w, h, d, r, seg = 12) {
  const g = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
  const pos = g.attributes.position, nor = g.attributes.normal;
  const v = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  const ix = w / 2 - r, iy = h / 2 - r, iz = d / 2 - r;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    c.set(clamp(v.x, -ix, ix), clamp(v.y, -iy, iy), clamp(v.z, -iz, iz));
    n.subVectors(v, c).normalize();
    v.copy(c).addScaledVector(n, r);
    pos.setXYZ(i, v.x, v.y, v.z);
    nor.setXYZ(i, n.x, n.y, n.z);
  }
  return g;
}

// A rounded block between two points, w wide across `side` and t thick.
function bar(THREE, a, b, side, w, t, r) {
  const L = a.distanceTo(b);
  const geo = roundedBox(THREE, t, L, w, Math.min(r, t / 2, w / 2, L / 2) - 1e-4, 8);
  const y = new THREE.Vector3().subVectors(b, a).normalize();
  const z = side.clone().addScaledVector(y, -side.dot(y)).normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  geo.applyMatrix4(basis(THREE, x, y, z, a.clone().add(b).multiplyScalar(0.5)));
  return geo;
}

// ---------- Surfaces ----------

function canvas(w, h = w) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  return cv;
}

function texture(THREE, cv, { srgb = true, repeat = true } = {}) {
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// Dark havana acetate: honey amber clouded with deep brown, a few bright flecks. Tiles seamlessly;
// one tile covers one head unit.
function tortoiseTex(THREE) {
  const S = 512, cv = canvas(S), c = cv.getContext('2d');
  c.fillStyle = '#8a4b1c';
  c.fillRect(0, 0, S, S);
  const r = rng(29);
  const blobs = (n, r0, r1, color, blur, stretch = 1.8) => {
    c.filter = `blur(${blur}px)`;
    c.fillStyle = color;
    for (let k = 0; k < n; k++) {
      const x = r() * S, y = r() * S, rr = mix(r0, r1, r() * r()), a = r() * Math.PI;
      for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) {
        c.beginPath();
        c.ellipse(x + dx, y + dy, rr * stretch, rr, a, 0, Math.PI * 2);
        c.fill();
      }
    }
  };
  blobs(46, 18, 70, 'rgba(52,22,8,0.92)', 10);
  blobs(70, 8, 34, 'rgba(28,11,4,0.9)', 5);
  blobs(50, 6, 22, 'rgba(176,104,38,0.75)', 4, 2.4);
  blobs(70, 2, 7, 'rgba(226,160,80,0.7)', 1.5, 2.8);
  blobs(30, 10, 30, 'rgba(20,8,3,0.6)', 14);
  c.filter = 'none';
  return texture(THREE, cv);
}

// Elastic webbing: lengthwise ribs with a fine weave, darker selvedges and a thin reflective stripe
// down the middle. u runs along the strap (one tile per 0.25 head units), v across it.
// The second canvas packs roughness (green) and metalness (blue) so only the stripe shines.
function webbingTex(THREE) {
  const W = 256, H = 128;
  const cv = canvas(W, H), c = cv.getContext('2d');
  const rm = canvas(W, H), m = rm.getContext('2d');
  c.fillStyle = '#2c3337';
  c.fillRect(0, 0, W, H);
  m.fillStyle = 'rgb(0,220,0)';
  m.fillRect(0, 0, W, H);
  const ribs = 14;
  for (let k = 0; k < ribs; k++) {
    const y0 = (k / ribs) * H, h = H / ribs;
    c.fillStyle = 'rgba(255,255,255,0.05)';
    c.fillRect(0, y0, W, h * 0.35);
    c.fillStyle = 'rgba(0,0,0,0.28)';
    c.fillRect(0, y0 + h * 0.8, W, h * 0.2);
    for (let x = (k % 2) * 4; x < W; x += 8) {
      c.fillStyle = 'rgba(0,0,0,0.16)';
      c.fillRect(x, y0, 2, h);
    }
  }
  c.fillStyle = 'rgba(10,12,14,0.55)';
  c.fillRect(0, 0, W, H * 0.07);
  c.fillRect(0, H * 0.93, W, H * 0.07);
  // The stripe: pale, with a fine prism grid, and smooth enough to catch the light.
  const y0 = H * 0.44, y1 = H * 0.56;
  c.fillStyle = '#c9cfd2';
  c.fillRect(0, y0, W, y1 - y0);
  c.fillStyle = 'rgba(80,90,96,0.35)';
  for (let x = 0; x < W; x += 4) for (let y = y0; y < y1; y += 4) c.fillRect(x + ((y / 4) % 2) * 2, y, 1, 1);
  m.fillStyle = 'rgb(0,70,150)';
  m.fillRect(0, y0, W, y1 - y0);
  return { map: texture(THREE, cv), rough: texture(THREE, rm, { srgb: false }) };
}

// The headlamp's optic: a hot white core spreading through lamplight amber, with the concentric
// rings of a molded lens.
function lampTex(THREE) {
  const S = 256, cv = canvas(S), c = cv.getContext('2d');
  const g = c.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, '#fff8e6');
  g.addColorStop(0.16, '#ffe2a0');
  g.addColorStop(0.45, '#f7ae45');
  g.addColorStop(0.85, '#e8901f');
  g.addColorStop(1, '#b8640e');
  c.fillStyle = g;
  c.fillRect(0, 0, S, S);
  for (let k = 1; k <= 7; k++) {
    const rr = (S / 2) * (0.18 + 0.11 * k);
    c.beginPath();
    c.arc(S / 2, S / 2, rr, 0, Math.PI * 2);
    c.lineWidth = 3;
    c.strokeStyle = 'rgba(255,240,200,0.28)';
    c.stroke();
    c.beginPath();
    c.arc(S / 2, S / 2, rr + 3, 0, Math.PI * 2);
    c.lineWidth = 2;
    c.strokeStyle = 'rgba(150,70,0,0.22)';
    c.stroke();
  }
  return texture(THREE, cv, { repeat: false });
}

// What glass reflects: a dark studio with one softbox. Lenses, tipped in and seen from just above,
// reflect a band just below the horizon facing the camera (u 0.53-0.75, v 0.28-0.45 of this
// panorama, where u 0.75 faces +Z): the softbox sits in its upper right, so each lens carries a
// soft window glint high on its outer side, with a faint sweep along the bottom. The lamp's domed
// cover looks higher up and catches a smaller box there.
function studioTex(THREE) {
  const W = 512, H = 256, cv = canvas(W, H), c = cv.getContext('2d');
  const X = (u) => u * W, Y = (v) => (1 - v) * H;
  c.fillStyle = '#050607';
  c.fillRect(0, 0, W, H);
  const sky = c.createLinearGradient(0, Y(0.62), 0, Y(0.4));
  sky.addColorStop(0, 'rgba(70,76,82,1)');
  sky.addColorStop(1, 'rgba(70,76,82,0)');
  c.fillStyle = sky;
  c.fillRect(0, 0, W, Y(0.4));
  c.filter = 'blur(3px)';
  c.fillStyle = '#ffffff';
  c.beginPath();
  c.roundRect(X(0.545), Y(0.47), X(0.08), Y(0.395) - Y(0.47), 6);
  c.fill();
  c.fillStyle = '#f2f6f8';
  c.beginPath();
  c.roundRect(X(0.565), Y(0.75), X(0.04), Y(0.66) - Y(0.75), 5);
  c.fill();
  c.fillStyle = 'rgba(160,170,178,0.8)';
  c.fillRect(X(0.66), Y(0.3), X(0.08), Y(0.285) - Y(0.3));
  c.filter = 'none';
  const t = texture(THREE, cv, { repeat: false });
  t.mapping = THREE.EquirectangularReflectionMapping;
  return t;
}

const MAT = {
  asphalt: (THREE) => new THREE.MeshPhysicalMaterial({
    color: C.asphalt, roughness: 0.55, clearcoat: 0.18, clearcoatRoughness: 0.5, sheen: 0.45, sheenRoughness: 0.5, sheenColor: 0x5d6b71,
  }),
  satin: (THREE) => new THREE.MeshPhysicalMaterial({ color: C.satin, roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.16 }),
  cushion: (THREE) => new THREE.MeshPhysicalMaterial({
    color: C.cushion, roughness: 0.46, clearcoat: 0.32, clearcoatRoughness: 0.34, sheen: 0.7, sheenRoughness: 0.42, sheenColor: 0x66747a,
  }),
  steel: (THREE) => new THREE.MeshPhysicalMaterial({ color: C.steel, metalness: 1, roughness: 0.3, clearcoat: 0.4, clearcoatRoughness: 0.2 }),
  amber: (THREE) => new THREE.MeshPhysicalMaterial({
    color: C.amber, metalness: 0.3, roughness: 0.28, clearcoat: 0.8, clearcoatRoughness: 0.1, emissive: C.amber, emissiveIntensity: 0.22,
  }),
  gold: (THREE) => new THREE.MeshPhysicalMaterial({ color: C.gold, metalness: 1, roughness: 0.22, clearcoat: 0.6, clearcoatRoughness: 0.12 }),
  tortoise: (THREE, map) => new THREE.MeshPhysicalMaterial({
    map, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 0.08,
  }),
  // Clear glass. What it reflects decides how opaque it is, so a reflection reads at full
  // strength over any mascot while the lens itself stays clear. The color is black so glass adds
  // no haze of its own; the softbox panorama gives it something to reflect.
  glass: (THREE, opacity = 0.05, shine = 5) => {
    const m = new THREE.MeshPhysicalMaterial({
      color: 0x000000, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.03, transparent: true, opacity, depthWrite: false,
      envMap: studioTex(THREE), envMapIntensity: shine,
    });
    m.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `
        float glassLum = dot( outgoingLight, vec3( 0.2126, 0.7152, 0.0722 ) );
        float glassA = clamp( diffuseColor.a + glassLum * 2.5, 0.0, 0.9 );
        gl_FragColor = vec4( outgoingLight / max( glassA, 0.02 ), glassA );
      `);
    };
    m.customProgramCacheKey = () => 'tml-glass';
    return m;
  },
};

// =====================================================================
// Headphones
// =====================================================================
// Matte asphalt over-ears: a padded band that follows the crown, steel sliders and forked yokes,
// pillowy protein-leather cushions that settle against the head, and one amber ring around each
// cap. Cups are measured where they sit, so a cushion presses into hair or fur and wraps the ear.

const CUP = {
  depth: 0.105, shell: 0.15, rx: 0.235, ry: 0.32, k: 2.5,
  ring: [0.175, 0.265], ringW: 0.11, // cushion centerline and width: hole ~0.12 x 0.21, outer ~0.23 x 0.32
};

function headphones(THREE, root, fit) {
  const V = THREE.Vector3;
  const g = new THREE.Group();
  const cloud = measure(THREE, root);
  const asphalt = MAT.asphalt(THREE), satin = MAT.satin(THREE), cushion = MAT.cushion(THREE);
  const steel = MAT.steel(THREE), amber = MAT.amber(THREE);
  const lean = fit.lean ?? 0.1;
  const U = new V(0, Math.cos(lean), -Math.sin(lean));
  const { depth: D, shell: SH, rx: RX, ry: RY, k: K } = CUP;

  const tops = [];
  for (const s of [-1, 1]) {
    // The cup's own frame: Z out from the head, Y up (leaning partway with the band), X across.
    const A = new V(s, fit.axis?.[0] ?? -0.1, fit.axis?.[1] ?? -0.04).normalize();
    const cl = (fit.cupLean ?? 0.4) * lean;
    const up = new V(0, Math.cos(cl), -Math.sin(cl));
    const Y = up.clone().addScaledVector(A, -up.dot(A)).normalize();
    const X = new V().crossVectors(Y, A).normalize();
    const E = new V(s * fit.ear[0], fit.ear[1], fit.ear[2]);

    // A height map of the head under the cup, in steps of 0.02: the outermost surface along Z.
    const HN = 44, HS = 0.02, H0 = -HN * HS / 2;
    const hm = new Float32Array(HN * HN).fill(-Infinity);
    cloud.near(E, 0.6, (i) => {
      const x = cloud.P[i * 3] - E.x, y = cloud.P[i * 3 + 1] - E.y, z = cloud.P[i * 3 + 2] - E.z;
      const u = x * X.x + y * X.y + z * X.z, v = x * Y.x + y * Y.y + z * Y.z, t = x * A.x + y * A.y + z * A.z;
      if (t < -0.45) return;
      const iu = Math.floor((u - H0) / HS), iv = Math.floor((v - H0) / HS);
      if (iu < 0 || iv < 0 || iu >= HN || iv >= HN) return;
      hm[iv * HN + iu] = Math.max(hm[iv * HN + iu], t);
    });
    // Fill pinholes from neighbours, then read conservatively (the highest of a 3x3 patch).
    for (let pass = 0; pass < 3; pass++) {
      const src = hm.slice();
      for (let iv = 0; iv < HN; iv++) for (let iu = 0; iu < HN; iu++) {
        if (src[iv * HN + iu] > -Infinity) continue;
        let m = -Infinity;
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
          const ju = iu + a, jv = iv + b;
          if (ju >= 0 && jv >= 0 && ju < HN && jv < HN) m = Math.max(m, src[jv * HN + ju]);
        }
        hm[iv * HN + iu] = m;
      }
    }
    const height = (u, v) => {
      const iu = Math.floor((u - H0) / HS), iv = Math.floor((v - H0) / HS);
      let m = -Infinity;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        const ju = clamp(iu + a, 0, HN - 1), jv = clamp(iv + b, 0, HN - 1);
        m = Math.max(m, hm[jv * HN + ju]);
      }
      return m;
    };
    // The cushion's face sits on the highest point under its ring (the ear goes in the hole).
    let t0 = -Infinity;
    for (let a = 0; a < 96; a++) for (const f of [0.62, 0.8, 1.0]) {
      const [cx, cy] = se((a / 96) * Math.PI * 2, K);
      t0 = Math.max(t0, height(cx * RX * f, cy * RY * f));
    }
    const O = E.clone().addScaledVector(A, t0);
    const M = basis(THREE, X, Y, A, O);

    // Cushion: a pillow ring. Its face then settles onto the head: wherever the head falls away
    // under it, the leather follows, a little compressed, so no daylight shows at the edges.
    const ringPts = [], ringOut = [];
    for (let a = 0; a < 160; a++) {
      const [cx, cy] = se((a / 160) * Math.PI * 2, K);
      ringPts.push(new V(cx * CUP.ring[0], cy * CUP.ring[1], 0).applyMatrix4(M));
      ringOut.push(A);
    }
    const cg = sweep(THREE, ringPts, ringOut, { w: CUP.ringW, d: D * 1.04, k: 2.6, rad: 28, closed: true });
    const p = cg.attributes.position, q = new V();
    for (let i = 0; i < p.count; i++) {
      q.fromBufferAttribute(p, i).sub(O);
      const u = q.dot(X), v = q.dot(Y), z = q.dot(A);
      const wz = (1 - clamp(z / D, 0, 1)) ** 2;
      const h = height(u, v) - t0;
      const dz = clamp(h - 0.012, -0.075, 0) * wz;
      // Fine gathers in the leather along the inner rim.
      const ang = Math.atan2(v / CUP.ring[1], u / CUP.ring[0]);
      const rr = Math.hypot(u / (CUP.ring[0] + 0.05), v / (CUP.ring[1] + 0.05));
      const pleat = 0.0035 * Math.sin(ang * 46) * (1 - ss(rr, 0.55, 0.75)) * (1 - ss(z / D, 0.5, 0.9));
      const px = X.x * Math.cos(ang) + Y.x * Math.sin(ang), py = X.y * Math.cos(ang) + Y.y * Math.sin(ang), pz = X.z * Math.cos(ang) + Y.z * Math.sin(ang);
      p.setXYZ(i, p.getX(i) + A.x * dz + px * pleat, p.getY(i) + A.y * dz + py * pleat, p.getZ(i) + A.z * dz + pz * pleat);
    }
    cg.computeVertexNormals();
    g.add(mesh(THREE, cg, cushion));

    // Shell: a rounded puck with a lip around a satin cap, and the amber ring set between them.
    const shell = loft(THREE, [[0.72, -0.08], [0.965, -0.03], [0.995, 0.108], [1.0, 0.308], [0.995, 0.538],
      [0.975, 0.731], [0.93, 0.877], [0.865, 0.969], [0.81, 1.0], [0.785, 0.977], [0.775, 0.908]].map(([f, z]) => [f, D + z * SH]), { rx: RX, ry: RY, k: K });
    shell.applyMatrix4(M);
    g.add(mesh(THREE, shell, asphalt));
    const cap = loft(THREE, [[0.745, 0.862], [0.74, 0.938], [0.7, 0.985], [0.55, 1.031], [0.3, 1.054], [0, 1.062]].map(([f, z]) => [f, D + z * SH]), { rx: RX, ry: RY, k: K });
    cap.applyMatrix4(M);
    g.add(mesh(THREE, cap, satin));
    const ring = [];
    for (let a = 0; a < 128; a++) {
      const [cx, cy] = se((a / 128) * Math.PI * 2, K);
      ring.push(new V(cx * RX * 0.76, cy * RY * 0.76, D + 0.938 * SH).applyMatrix4(M));
    }
    g.add(mesh(THREE, sweep(THREE, ring, ring.map(() => A), { w: 0.016, d: 0.012, k: 2, rad: 12, closed: true, center: true }), amber));

    // Yoke: a steel fork around the shell, pinned at front and back.
    const zy = D + 0.385 * SH, off = 0.036;
    const yoke = [], yokeOut = [];
    for (let a = 0; a <= 64; a++) {
      const th = (a / 64) * Math.PI;
      const [cx, cy] = se(th, K);
      yoke.push(new V(cx * (RX + off), cy * (RY + off), zy).applyMatrix4(M));
      yokeOut.push(A);
    }
    g.add(mesh(THREE, sweep(THREE, yoke, yokeOut, { w: 0.026, d: 0.04, k: 6, rad: 20, center: true, prof: (t) => 0.85 + 0.15 * ss(Math.abs(t - 0.5), 0.3, 0.5) }), steel));
    for (const e of [1, -1]) {
      const pin = new THREE.Group();
      pin.add(mesh(THREE, new THREE.CylinderGeometry(0.024, 0.024, off + 0.012, 32), steel, { p: [0, (RX + off / 2), 0] }));
      pin.add(mesh(THREE, new THREE.CylinderGeometry(0.03, 0.03, 0.012, 32), satin, { p: [0, RX + off + 0.006, 0] }));
      pin.applyMatrix4(basis(THREE, Y, X.clone().multiplyScalar(e), A.clone().multiplyScalar(-e), new V(0, 0, 0)));
      pin.position.copy(new V(0, 0, zy).applyMatrix4(M));
      g.add(pin);
    }
    // Hinge block where the fork meets the slider.
    const Q = new V(0, RY + off, zy).applyMatrix4(M);
    const hinge = roundedBox(THREE, 0.05, 0.05, 0.05, 0.016, 6);
    hinge.applyMatrix4(basis(THREE, X, Y, A, Q.clone().addScaledVector(Y, 0.018)));
    g.add(mesh(THREE, hinge, steel));
    tops.push({ s, Q: Q.clone().addScaledVector(Y, 0.04), A, Y });
  }

  // Band. Like a sprung band pressed onto a head, it lies on the crown, runs straight down past
  // the temples and turns upright into the sliders. Where it lies on the head it follows the
  // taut hull, in the plane the band leans in, of the head's slice (as wide as the band). The hull
  // also takes a point above each slider top, and the turn there is filleted generously: the
  // band stays convex and the fillet only cuts the empty corner beside the head. The pad lines
  // the stretch that touches; the shell above keeps one depth throughout.
  const L = fit.slider ?? 0.12;
  const S = tops.map((t) => t.Q.clone().addScaledVector(U, L));
  const O = S[0].clone().add(S[1]).multiplyScalar(0.5);
  const e1 = new V().subVectors(S[1], S[0]).normalize();
  const e2 = U.clone().addScaledVector(e1, -U.dot(e1)).normalize();
  const Nb = new V().crossVectors(e1, e2).normalize();
  const TB = 0.058, TP = 0.072, WB = 0.19, GAP = 0.003, RISE = 0.22;
  const aC = S[0].distanceTo(S[1]) / 2 - (TP + TB / 2);
  const slice = [];
  cloud.near(O.clone().addScaledVector(e2, 0.8), 1.4, (i) => {
    const x = cloud.P[i * 3] - O.x, y = cloud.P[i * 3 + 1] - O.y, z = cloud.P[i * 3 + 2] - O.z;
    if (Math.abs(x * Nb.x + y * Nb.y + z * Nb.z) > WB / 2 + 0.02) return;
    const py = x * e2.x + y * e2.y + z * e2.z;
    if (py > 0.01) slice.push([x * e1.x + y * e1.y + z * e1.z, py]);
  });
  const pool = slice.concat([[-aC, RISE], [aC, RISE]]).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const hull = [];
  const turn = (o, p, q) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  for (const q of pool) {
    while (hull.length >= 2 && turn(hull[hull.length - 2], hull[hull.length - 1], q) >= 0) hull.pop();
    hull.push(q);
  }
  const lie = hull.slice(1, -1);
  const fillet = (prev, corner) => {
    // From the run (coming from prev) into the upright slider below corner.
    const l = Math.hypot(corner[0] - prev[0], corner[1] - prev[1]), f = Math.min(0.2, 0.45 * l, RISE * 0.9);
    const a0 = [corner[0] + ((prev[0] - corner[0]) / l) * f, corner[1] + ((prev[1] - corner[1]) / l) * f];
    const b0 = [corner[0], corner[1] - f];
    const out = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24, m = 1 - t;
      out.push([0, 1].map((d) => m * m * a0[d] + 2 * m * t * corner[d] + t * t * b0[d]));
    }
    return out;
  };
  let line = [[-aC, 0], ...fillet(lie[0], [-aC, RISE]).reverse(), ...lie, ...fillet(lie[lie.length - 1], [aC, RISE]), [aC, 0]];
  // Even spacing, then a light smoothing to soften the faceting of the hull.
  const respace = (pts, step) => {
    const out = [pts[0]];
    let carry = 0;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      const l = Math.hypot(x1 - x0, y1 - y0);
      let t = step - carry;
      while (t <= l) { out.push([mix(x0, x1, t / l), mix(y0, y1, t / l)]); t += step; }
      carry = l - (t - step);
    }
    out.push(pts[pts.length - 1]);
    return out;
  };
  line = respace(line, 0.01);
  for (let it = 0; it < 12; it++) {
    line = line.map((q, i) => (i === 0 || i === line.length - 1 ? q
      : [mix(q[0], (line[i - 1][0] + line[i + 1][0]) / 2, 0.5), mix(q[1], (line[i - 1][1] + line[i + 1][1]) / 2, 0.5)]));
  }
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
  const total = cum[cum.length - 1];
  // The pad lines the stretch that lies on the head, and a little more.
  const near = (q) => lie.some((h) => Math.abs(h[0] - q[0]) < 0.02 && Math.abs(h[1] - q[1]) < 0.02);
  let s0 = Infinity, s1 = -Infinity;
  line.forEach((q, i) => { if (near(q)) { s0 = Math.min(s0, cum[i]); s1 = Math.max(s1, cum[i]); } });
  if (!(s1 > s0)) { s0 = total * 0.3; s1 = total * 0.7; }
  s0 = Math.max(0.15, s0 - 0.08);
  s1 = Math.min(total - 0.15, s1 + 0.08);
  const NS = 180;
  const curve = [], normal = [], arc = [];
  let j = 1;
  for (let i = 0; i <= NS; i++) {
    const target = (i / NS) * total;
    while (j < cum.length - 1 && cum[j] < target) j++;
    const t = (target - cum[j - 1]) / (cum[j] - cum[j - 1] || 1);
    const x = mix(line[j - 1][0], line[j][0], t), y = mix(line[j - 1][1], line[j][1], t);
    const tx = line[j][0] - line[j - 1][0], ty = line[j][1] - line[j - 1][1];
    const nn = new V().addScaledVector(e1, ty).addScaledVector(e2, -tx).normalize();
    if (nn.dot(e1) * x + nn.dot(e2) * y < 0) nn.negate();
    curve.push(O.clone().addScaledVector(e1, x).addScaledVector(e2, y).addScaledVector(nn, GAP));
    normal.push(nn);
    arc.push(target);
  }
  g.userData.band = { span: aC, contact: [+s0.toFixed(3), +s1.toFixed(3)], length: +total.toFixed(3) };
  // Pad: hangs from the shell over the contact, with rounded ends.
  const R = 0.06;
  const padProf = (t) => {
    const d = Math.min(arc[Math.round(t * NS)] - s0, s1 - arc[Math.round(t * NS)]);
    return d <= 0 ? 0 : Math.sqrt(1 - (1 - Math.min(1, d / R)) ** 2);
  };
  // Its top is sunk well into the shell, so only the pillowy underside shows.
  const SINK = 0.03;
  const padPts = curve.map((p, i) => p.clone().addScaledVector(normal[i], TP + SINK));
  g.add(mesh(THREE, sweep(THREE, padPts, normal.map((nn) => nn.clone().negate()),
    { w: 0.178, d: TP + SINK, k: 2.7, rad: 28, prof: (t) => Math.min(1, padProf(t) * 1.4), profD: padProf }), cushion));
  const bandPts = curve.map((p, i) => p.clone().addScaledVector(normal[i], TP + TB / 2));
  g.add(mesh(THREE, sweep(THREE, bandPts, normal, { w: WB, d: TB, k: 5, rad: 28, center: true, prof: (t) => 0.88 + 0.12 * Math.sin(Math.PI * t) }), asphalt));

  // Sliders run from the hinge blocks up into end caps on the band.
  tops.forEach((t, i) => {
    const s = S[i];
    g.add(mesh(THREE, bar(THREE, t.Q.clone().addScaledVector(U, -0.03), s.clone().addScaledVector(U, 0.02), Nb, 0.05, 0.016, 0.007), steel));
    const capGeo = roundedBox(THREE, 0.084, 0.12, 0.18, 0.03, 8);
    capGeo.applyMatrix4(basis(THREE, e1, U.clone().addScaledVector(Nb, -U.dot(Nb)).normalize(), Nb, s.clone().addScaledVector(U, 0.06)));
    g.add(mesh(THREE, capGeo, asphalt));
  });
  return g;
}

// =====================================================================
// Glasses
// =====================================================================
// Round frames cut from dark havana acetate, with a keyhole bridge and two gold rivets at each
// hinge. The front is one bent sheet, like real acetate: pushed out just far enough to clear the
// eyes and brows, its bridge set back to rest on the nose or muzzle. Temples follow the side of the
// head back to the ears (or slip under the hair, for the anime cast).

function glasses(THREE, root, fit) {
  const V = THREE.Vector3;
  const g = new THREE.Group();
  const cloud = measure(THREE, root);
  const skin = fit.tuck ? measure(THREE, root, (o) => o === root.children[0]) : cloud;
  const [ex, ey] = fit.eye;
  const r = fit.r, rim = 0.03, Ro = r + rim;
  const bend = fit.bend ?? 0.2, tilt = fit.tilt ?? 0.1;
  const DEPTH = 0.02, BEV = 0.008;
  const tortoise = MAT.tortoise(THREE, tortoiseTex(THREE));
  const gold = MAT.gold(THREE);

  // The front in 2D, centered on the bridge at lens-center height.
  const phT = 0.62, phB = 0.12;                 // where the bridge meets each rim, top and bottom
  const yk = fit.bridge;                         // top of the keyhole opening
  const yt = yk + 0.034;                         // top edge of the bridge
  const sh = new THREE.Shape();
  const P = (cx, ang) => [cx + Ro * Math.cos(ang), Ro * Math.sin(ang)];
  const rTop = P(ex, Math.PI - phT), lTop = P(-ex, phT), lBot = P(-ex, -phB), rBot = P(ex, Math.PI + phB);
  sh.moveTo(rTop[0], rTop[1]);
  sh.quadraticCurveTo(0, 2 * yt - rTop[1], lTop[0], lTop[1]);
  sh.absarc(-ex, 0, Ro, phT, Math.PI * 2 - phB, false);
  sh.bezierCurveTo(lBot[0] + 0.012, yk - 0.02, -0.05, yk, 0, yk);
  sh.bezierCurveTo(0.05, yk, rBot[0] - 0.012, yk - 0.02, rBot[0], rBot[1]);
  sh.absarc(ex, 0, Ro, Math.PI + phB, Math.PI * 3 - phT, false);
  for (const cx of [-ex, ex]) {
    const hole = new THREE.Path();
    hole.absarc(cx, 0, r, 0, Math.PI * 2, true);
    sh.holes.push(hole);
  }
  let front = new THREE.ExtrudeGeometry(sh, { depth: DEPTH, bevelEnabled: true, bevelThickness: BEV, bevelSize: BEV, bevelSegments: 3, curveSegments: 96 });
  front = tessellate(THREE, front, 0.016);

  // Face form: the sheet wraps around the face and tips its bottom in. z0 is how far forward it
  // has to sit to clear everything behind the lenses; the bridge then sets back toward the nose.
  const wrapZ = (x, y) => -bend * x * x + tilt * y;
  // Only what stands on the face counts (eyes, brows, a muzzle), not a hat brim far in front.
  const head = measure(THREE, root, (o) => o === root.children[0]);
  const inLens = (x, y) => Math.min(Math.hypot(x - ex, y), Math.hypot(x + ex, y)) <= Ro + 0.012;
  let face = -Infinity;
  head.near(new V(0, ey, 0.8), ex + Ro + 0.3, (i) => {
    if (inLens(head.P[i * 3], head.P[i * 3 + 1] - ey)) face = Math.max(face, head.P[i * 3 + 2]);
  });
  let z0 = -Infinity;
  cloud.near(new V(0, ey, 0.8), ex + Ro + 0.3, (i) => {
    const x = cloud.P[i * 3], y = cloud.P[i * 3 + 1] - ey, z = cloud.P[i * 3 + 2];
    if (z < 0.3 || z > face + 0.2 || !inLens(x, y)) return;
    z0 = Math.max(z0, z - wrapZ(x, y));
  });
  z0 += BEV + (fit.gap ?? 0.028);
  let nose = -Infinity;
  cloud.near(new V(0, ey + yk + 0.015, 0.9), 0.3, (i) => {
    const x = cloud.P[i * 3], y = cloud.P[i * 3 + 1] - ey;
    if (Math.abs(x) < 0.05 && y > yk - 0.02 && y < yt + 0.01) nose = Math.max(nose, cloud.P[i * 3 + 2]);
  });
  const xin = ex - Ro + 0.006;
  const setback = clamp(z0 - BEV + wrapZ(0, yk) - (nose + 0.01), 0, 0.09);
  const bridgeZ = (x) => -setback * (1 - ss(Math.abs(x), 0.0, xin));
  const place = (x, y, z) => new V(x, y + ey, z0 + z + wrapZ(x, y) + bridgeZ(x));
  const fp = front.attributes.position;
  for (let i = 0; i < fp.count; i++) {
    const q = place(fp.getX(i), fp.getY(i), fp.getZ(i));
    fp.setXYZ(i, q.x, q.y, q.z);
  }
  front.computeVertexNormals();
  g.add(mesh(THREE, front, tortoise));
  g.userData.fit = { z0, setback, nose };

  // Lenses: domed, sitting in the rim's groove.
  const glass = MAT.glass(THREE);
  for (const cx of [-ex, ex]) {
    const lg = new THREE.CircleGeometry(r + 0.004, 96, 0, Math.PI * 2);
    const lp = lg.attributes.position;
    for (let i = 0; i < lp.count; i++) {
      const x = lp.getX(i), y = lp.getY(i), rr = Math.hypot(x, y) / r;
      const q = place(cx + x, y, DEPTH * 0.45 + 0.022 * (1 - rr * rr));
      lp.setXYZ(i, q.x, q.y, q.z);
    }
    lg.computeVertexNormals();
    g.add(mesh(THREE, lg, glass, { cast: false }));
  }

  // Rivets: two gold pins on each end piece.
  for (const sx of [-1, 1]) {
    for (const da of [-0.13, 0.13]) {
      const ang = 0.16 + da;
      const x = sx * (ex + (r + rim * 0.5) * Math.cos(ang)), y = (r + rim * 0.5) * Math.sin(ang);
      g.add(mesh(THREE, new THREE.SphereGeometry(0.0075, 16, 12), gold, { p: place(x, y, DEPTH + BEV * 0.6).toArray(), s: [1, 1, 0.6], cast: false }));
    }
  }

  // Temples: from each end piece straight back, then hugging the head to the ear and curling
  // down behind it. Pulled taut and pushed clear of the head, hair and ears.
  const radial = (p) => new V(p.x, 0, p.z).normalize();
  for (const sx of [-1, 1]) {
    const ang = 0.16;
    const hx = sx * (ex + Ro * Math.cos(ang) - 0.006), hy = Ro * Math.sin(ang);
    const H0 = place(hx, hy, DEPTH * 0.5);
    const H1 = place(hx, hy, -0.05);
    const E = new V(sx * fit.ear[0], fit.ear[1], fit.ear[2]);
    const NP = 56;
    const a0 = Math.atan2(H1.x, H1.z), a1 = Math.atan2(E.x, E.z);
    const r0 = Math.hypot(H1.x, H1.z), r1 = Math.hypot(E.x, E.z);
    let pts = [H0, H1];
    for (let i = 1; i <= NP; i++) {
      const t = i / NP;
      const aa = mix(a0, a1, t), rr = mix(r0, r1, t);
      pts.push(new V(Math.sin(aa) * rr, mix(H1.y, E.y, t), Math.cos(aa) * rr));
    }
    // The curl behind the ear (a short drop for heads without ears).
    const stiff = pts.length;
    if (!fit.tuck) {
      const rr = Math.hypot(E.x, E.z), aE = Math.atan2(E.x, E.z);
      for (const [da, dy] of [[0.07, -0.03], [0.13, -0.09], [0.17, -0.17]]) {
        const aa = aE + da * sx;
        pts.push(new V(Math.sin(aa) * rr * 0.99, E.y + dy, Math.cos(aa) * rr * 0.99));
      }
    }
    pts = settle(THREE, skin, pts, {
      fixed: 2, stiff, iters: 36, pull: 0.45,
      out: (p) => radial(p), hw: 0.028, gap: 0.006, ds: 0.016, over: 0.08,
    });
    const tip = pts.length;
    g.add(mesh(THREE, sweep(THREE, pts, pts.map((p) => radial(p)), {
      w: 0.056, d: 0.022, k: 3.2, rad: 18, center: true, uScale: 1,
      prof: (t) => (1 - 0.25 * ss(t, 0.05, 0.6)) * (t > 1 - 1.5 / tip ? Math.sqrt(Math.max(0, 1 - ((t - (1 - 1.5 / tip)) / (1.5 / tip)) ** 2)) : 1),
    }), tortoise));
    // Hinge barrel.
    const hb = place(hx, hy, -0.012);
    g.add(mesh(THREE, new THREE.CylinderGeometry(0.0085, 0.0085, 0.034, 16), gold, { p: hb.toArray() }));
  }
  return g;
}

// Pull a rod taut while keeping it clear of the mascot. Each pass smooths the free points toward
// their neighbours, then pushes every point out (along out(p)) of anything it sank into.
function settle(THREE, cloud, pts, o) {
  const { fixed = 1, stiff = pts.length - 1, iters = 30, pull = 0.5, out, hw, gap, ds, over } = o;
  let P = pts.map((p) => p.clone());
  for (let it = 0; it <= iters; it++) {
    if (it > 0) {
      P = P.map((p, i) => {
        if (i < fixed || i >= stiff - 1 || i === P.length - 1) return p;
        const m = P[i - 1].clone().add(P[i + 1]).multiplyScalar(0.5);
        return p.clone().lerp(m, pull);
      });
    }
    const T = tangents(THREE, P, false);
    const push = P.map((p, i) => {
      if (i < fixed) return 0;
      const n = out(p);
      const b = new THREE.Vector3().crossVectors(T[i], n).normalize();
      const nn = new THREE.Vector3().crossVectors(b, T[i]).normalize();
      return clearance(cloud, p, T[i], nn, b, n, { hw, ds, gap, over });
    });
    const eased = easeUp(push, 2, false);
    P = P.map((p, i) => (i < fixed ? p : p.clone().addScaledVector(out(p), eased[i])));
  }
  return P;
}

// =====================================================================
// Headlamp
// =====================================================================
// An elastic strap in dark webbing with a reflective stripe, cinched around the head at forehead
// height, and a rounded asphalt lamp that tilts on a bracket. Its lens glows lamplight, the sharer's
// color. The strap is a closed loop that tightens until it rests on whatever is under it.

function headlamp(THREE, root, fit) {
  const V = THREE.Vector3;
  const g = new THREE.Group();
  const cloud = measure(THREE, root);
  const W = fit.w ?? 0.13, TH = 0.024;
  const tilt = fit.tilt ?? 0.1;
  const nP = new V(0, 1, -Math.tan(tilt)).normalize();
  const O = new V(0, fit.y, 0);
  const e1 = new V(1, 0, 0), e2 = new V().crossVectors(e1, nP).negate().normalize();
  if (e2.z < 0) e2.negate();
  const NS = 200;
  const er = (i) => {
    const a = (i / NS) * Math.PI * 2;
    return e1.clone().multiplyScalar(Math.cos(a)).addScaledVector(e2, Math.sin(a));
  };
  // Start from the outermost solid in each direction around the plane, a little outside it.
  const rho = new Float32Array(NS).fill(0.6);
  cloud.near(O, 1.7, (i) => {
    const x = cloud.P[i * 3] - O.x, y = cloud.P[i * 3 + 1] - O.y, z = cloud.P[i * 3 + 2] - O.z;
    const h = x * nP.x + y * nP.y + z * nP.z;
    if (Math.abs(h) > W / 2) return;
    const u = x * e1.x + y * e1.y + z * e1.z, v = x * e2.x + y * e2.y + z * e2.z;
    let k = Math.round((Math.atan2(v, u) / (Math.PI * 2)) * NS);
    k = ((k % NS) + NS) % NS;
    rho[k] = Math.max(rho[k], Math.hypot(u, v));
  });
  let R = Array.from(rho, (x) => x + 0.06);
  R = easeUp(R, 3, true);
  // Tighten: shrink the loop, pull it smooth, push it out of anything it cuts into. The strap's
  // section leans with the surface under it, so it lies flat on a sloping forehead.
  let tiltN = new Array(NS).fill(null);
  for (let it = 0; it < 40; it++) {
    R = R.map((x, i) => mix(x, (R[(i - 1 + NS) % NS] + R[(i + 1) % NS]) / 2, 0.35) - 0.006);
    const pts = R.map((x, i) => O.clone().addScaledVector(er(i), x));
    const T = tangents(THREE, pts, true);
    if (it % 5 === 0) {
      tiltN = pts.map((p, i) => {
        const s = surfaceNormal(THREE, cloud, p, er(i), 0.08);
        if (!s) return er(i);
        const c = s.addScaledVector(T[i], -s.dot(T[i])).normalize();
        const cosA = c.dot(er(i));
        return cosA < Math.cos(0.6) ? er(i).lerp(c, 0.5).normalize() : c;
      });
      const sm = tiltN.map((_, i) => {
        const a = new V();
        for (let j = -6; j <= 6; j++) a.add(tiltN[(i + j + NS) % NS]);
        return a.normalize();
      });
      tiltN = sm;
    }
    const push = pts.map((p, i) => {
      const n = tiltN[i].clone().addScaledVector(T[i], -tiltN[i].dot(T[i])).normalize();
      const b = new V().crossVectors(T[i], n).normalize();
      return clearance(cloud, p, T[i], n, b, er(i), { hw: W / 2, ds: 0.02, gap: 0.003, over: 0.09 });
    });
    const eased = easeUp(push, 2, true);
    R = R.map((x, i) => x + eased[i]);
  }
  const pts = R.map((x, i) => O.clone().addScaledVector(er(i), x));
  const T = tangents(THREE, pts, true);
  const outs = pts.map((p, i) => tiltN[i].clone().addScaledVector(T[i], -tiltN[i].dot(T[i])).normalize());
  const web = webbingTex(THREE);
  web.map.repeat.set(4, 1);
  web.rough.repeat.set(4, 1);
  const strapMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, map: web.map, roughnessMap: web.rough, metalnessMap: web.rough, roughness: 1, metalness: 1,
    sheen: 0.5, sheenRoughness: 0.6, sheenColor: 0x56636a,
  });
  g.add(mesh(THREE, sweep(THREE, pts, outs, { w: W, d: TH, k: 7, rad: 28, closed: true }), strapMat));

  // The lamp sits on the strap at the front.
  const fi = Math.round(NS / 4);
  const Pf = pts[fi].clone(), Nf = outs[fi].clone();
  const Xf = T[fi].clone();
  if (Xf.x < 0) Xf.negate();
  const Yf = new V().crossVectors(Nf, Xf).normalize();
  const lamp = new THREE.Group();
  const asphalt = MAT.asphalt(THREE), satin = MAT.satin(THREE), steel = MAT.steel(THREE);
  // Bracket: a plate bent to the curve of the strap it clips onto.
  const curv = 1 / Math.max(0.6, R[fi]);
  const plate = roundedBox(THREE, 0.34, 0.21, 0.024, 0.012, 16);
  const pp = plate.attributes.position;
  for (let i = 0; i < pp.count; i++) pp.setZ(i, pp.getZ(i) + 0.012 - 0.5 * curv * pp.getX(i) ** 2);
  plate.computeVertexNormals();
  lamp.add(mesh(THREE, plate, asphalt, { p: [0, 0, TH] }));
  // Body: a rounded pebble on side pivots, tipped down a little, with a steel bezel and the
  // glowing lens behind a clear domed cover. The glow is left to the lens itself: a halo drawn
  // with alpha could only grey whatever is behind it, never brighten it.
  const body = new THREE.Group();
  const BX = 0.23, BY = 0.142, BZ = 0.15;
  const shell = loft(THREE, [[0.6, 0], [0.92, 0.07], [0.99, 0.25], [1.0, 0.5], [0.98, 0.75], [0.93, 0.9], [0.86, 0.98], [0.8, 1.0]].map(([f, z]) => [f, z * BZ]), { rx: BX, ry: BY, k: 3 });
  body.add(mesh(THREE, shell, asphalt));
  const LR = 0.1;
  // The bezel is lit from inside by the lens it holds.
  const bezel = MAT.steel(THREE);
  bezel.emissive.setHex(C.lamp);
  bezel.emissiveIntensity = 0.28;
  body.add(mesh(THREE, new THREE.TorusGeometry(LR + 0.009, 0.012, 16, 64), bezel, { p: [0, 0, BZ] }));
  body.add(mesh(THREE, new THREE.CircleGeometry(BX * 0.8, 64), asphalt, { p: [0, 0, BZ - 0.0005], s: [1, BY / BX, 1] }));
  // The lens is light, not a lit surface: it keeps its exact lamplight color, untouched by tone mapping.
  const lensMat = new THREE.MeshBasicMaterial({ map: lampTex(THREE), toneMapped: false });
  body.add(mesh(THREE, new THREE.CircleGeometry(LR + 0.002, 64), lensMat, { p: [0, 0, BZ + 0.002], cast: false }));
  const cover = new THREE.SphereGeometry(LR / Math.sin(0.5), 48, 12, 0, Math.PI * 2, 0, 0.5);
  cover.rotateX(Math.PI / 2);
  cover.translate(0, 0, BZ + 0.003 - (LR / Math.sin(0.5)) * Math.cos(0.5));
  body.add(mesh(THREE, cover, MAT.glass(THREE, 0.0, 1.6), { cast: false }));
  for (const sx of [-1, 1]) {
    body.add(mesh(THREE, new THREE.CylinderGeometry(0.026, 0.026, 0.018, 32), steel, { p: [sx * (BX + 0.002), 0, BZ * 0.45], r: [0, 0, Math.PI / 2] }));
  }
  body.add(mesh(THREE, new THREE.CylinderGeometry(0.02, 0.022, 0.012, 24), satin, { p: [0.08, BY, BZ * 0.5] }));
  const pivot = new THREE.Group();
  pivot.position.set(0, 0, TH + 0.03 + BZ * 0.45);
  pivot.rotation.x = fit.pitch ?? 0.1;
  body.position.set(0, 0, -BZ * 0.45);
  pivot.add(body);
  lamp.add(pivot);
  lamp.applyMatrix4(basis(THREE, Xf, Yf, Nf, Pf));
  g.add(lamp);
  return g;
}

const BUILD = { headphones, glasses, headlamp };

// Fit an accessory to a mascot and add it to the mascot's group. mascotGroup is the builder's own
// group (head at the origin, facing +Z), before buildMascot turns it; returns the accessory group.
export function addAccessory(THREE, mascotGroup, mascotName, accessory) {
  if (!ACCESSORY_SUPPORT[mascotName]?.includes(accessory)) throw new Error(`${mascotName} does not wear ${accessory}`);
  const acc = BUILD[accessory](THREE, mascotGroup, FIT[mascotName][accessory]);
  acc.name = `${mascotName}-${accessory}`;
  acc.userData.accessory = accessory;
  mascotGroup.add(acc);
  return acc;
}
