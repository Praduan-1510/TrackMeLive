// Track Me Live mascots, modeled procedurally for three.js r160.
// Each builder returns a THREE.Group roughly 2.4 units tall, facing +Z.
// The Classics live here; the Anime and Movie night sets live in cast.mjs.

import { CAST, ACCENTS } from './cast.mjs';
import { addAccessory } from './accessories.mjs';

const C = {
  foxOrange: 0xec8e2c, foxCream: 0xfff1de, foxDark: 0x3b2313, foxInner: 0xf4c2a6,
  ink: 0x16100b,
  ghost: 0xeef5f2, ghostSheen: 0xdffbf0, blush: 0xf4a99f,
  steel: 0xafc2cb, gunmetal: 0x4a565c, visor: 0x0c1215, eye: 0x7fe6f2,
  lamp: 0xf2a033,
  helmet: 0xf3f5f4, collar: 0xd5dcd9, glass: 0x1a2a38,
};

function mesh(THREE, geo, mat, o = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  if (o.p) m.position.set(o.p[0], o.p[1], o.p[2]);
  if (o.s) m.scale.set(o.s[0], o.s[1], o.s[2]);
  if (o.r) m.rotation.set(o.r[0], o.r[1], o.r[2]);
  return m;
}

export function roundedBox(THREE, w, h, d, r, seg = 48) {
  const g = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const v = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  const ix = w / 2 - r, iy = h / 2 - r, iz = d / 2 - r;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    c.set(Math.max(-ix, Math.min(ix, v.x)), Math.max(-iy, Math.min(iy, v.y)), Math.max(-iz, Math.min(iz, v.z)));
    n.subVectors(v, c).normalize();
    v.copy(c).addScaledVector(n, r);
    pos.setXYZ(i, v.x, v.y, v.z);
    nor.setXYZ(i, n.x, n.y, n.z);
  }
  pos.needsUpdate = true;
  nor.needsUpdate = true;
  return g;
}

function gloss(THREE, color) {
  return new THREE.MeshPhysicalMaterial({ color, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.04 });
}

function sparkle(THREE) {
  return new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
}

function fur(THREE, color, sheenColor) {
  return new THREE.MeshPhysicalMaterial({ color, roughness: 0.58, sheen: 1, sheenRoughness: 0.42, sheenColor });
}

// The fox's fur in one of the picker colors. Original keeps its own values. A swatch paints the
// coat in its bright tone and the crown half way to its deep tone (the original crown sits about
// as far below its orange), and the ear tips darken to a shade of the deep tone, as the
// original's darken to brown. The sheens are a pale wash of the coat, as the original's are of
// its orange, so no orange glow is left on a green or blue coat.
function foxFur(THREE, accent, deep) {
  if (accent === undefined) return { coat: C.foxOrange, crown: 0xd9731f, tip: C.foxDark, sheen: 0xffd9b0, earSheen: 0xffc98a };
  const coat = new THREE.Color(accent), white = new THREE.Color(0xffffff);
  return {
    coat,
    crown: coat.clone().lerp(new THREE.Color(deep), 0.5),
    tip: new THREE.Color(deep).multiplyScalar(0.18),
    sheen: white.clone().lerp(coat, 0.65),
    earSheen: white.clone().lerp(coat, 0.8),
  };
}

// Takes the swatch on the fur only. The cream cheeks and jaw, the inner ears, eyes and nose stay.
function fox(THREE, { accent, deep } = {}) {
  const g = new THREE.Group();
  const F = foxFur(THREE, accent, deep);
  const orange = fur(THREE, C.foxOrange, 0xffc98a);
  const cream = fur(THREE, C.foxCream, 0xffffff);
  const ink = gloss(THREE, C.ink);
  const spark = sparkle(THREE);

  // Fur painted with vertex colors: the coat on top, cream on the cheeks and jaw.
  const furPainted = new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.58, sheen: 1, sheenRoughness: 0.42, sheenColor: F.sheen });
  const oc = new THREE.Color(F.coat), crown = new THREE.Color(F.crown), cc = new THREE.Color(C.foxCream), tmpC = new THREE.Color();
  const ss = THREE.MathUtils.smoothstep;
  const paint = (geo, maskFn, topFn = () => 0) => {
    const pos = geo.attributes.position;
    const out = [];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      tmpC.copy(oc).lerp(crown, topFn(x, y, z)).lerp(cc, maskFn(x, y, z));
      out.push(tmpC.r, tmpC.g, tmpC.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(out, 3));
  };

  // Head: a sphere with a cheek flare, deeper orange on the crown. Seam turned to the back.
  const headGeo = new THREE.SphereGeometry(1, 160, 120);
  headGeo.rotateY(-Math.PI / 2);
  const p = headGeo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const t = ss(-y, -0.1, 0.8);
    x *= 1.06 + 0.17 * t;
    y *= 0.92;
    z *= 0.97 - 0.05 * t;
    p.setXYZ(i, x, y, z);
  }
  headGeo.computeVertexNormals();
  paint(headGeo, (x, y, z) => ss(-y + 0.16 * Math.abs(x), 0.1, 0.3) * ss(z, -0.25, 0.25), (x, y) => 0.55 * ss(y, 0.25, 0.9));
  g.add(mesh(THREE, headGeo, furPainted));

  // Snout: one tapered shape pointing forward, cream underneath.
  const snoutGeo = new THREE.SphereGeometry(1, 128, 96);
  snoutGeo.rotateY(-Math.PI / 2);
  const sp = snoutGeo.attributes.position;
  for (let i = 0; i < sp.count; i++) {
    const x = sp.getX(i), y = sp.getY(i), z = sp.getZ(i);
    const taper = 1 - 0.36 * ss(z, -0.2, 1);
    sp.setXYZ(i, x * 0.47 * taper, y * 0.33 * taper, z * 0.58);
  }
  snoutGeo.computeVertexNormals();
  paint(snoutGeo, (x, y) => ss(-y, -0.07, 0.05));
  g.add(mesh(THREE, snoutGeo, furPainted, { p: [0, -0.15, 0.66], r: [0.1, 0, 0] }));

  // Jaw.
  g.add(mesh(THREE, new THREE.SphereGeometry(0.38, 64, 48), cream, { p: [0, -0.5, 0.34], s: [1.2, 0.55, 0.8] }));

  // Nose and eyes, with a catchlight on each eye.
  g.add(mesh(THREE, new THREE.SphereGeometry(0.115, 64, 48), ink, { p: [0, -0.07, 1.2], s: [1.4, 0.95, 0.9] }));
  for (const sx of [-1, 1]) {
    g.add(mesh(THREE, new THREE.SphereGeometry(0.12, 64, 48), ink, { p: [0.36 * sx, 0.13, 0.87] }));
    g.add(mesh(THREE, new THREE.SphereGeometry(0.032, 24, 16), spark, { p: [0.36 * sx + 0.045, 0.18, 0.98] }));
  }

  // Ears: lathed, flattened, darkening toward the tip, with a soft inner ear.
  const earPts = new THREE.SplineCurve(
    [[0, 0], [0.36, 0], [0.4, 0.12], [0.36, 0.36], [0.27, 0.6], [0.15, 0.82], [0.05, 0.95], [0, 0.98]].map(([x, y]) => new THREE.Vector2(x, y))
  ).getPoints(48);
  const earGeo = new THREE.LatheGeometry(earPts, 96, Math.PI);
  const ec = new THREE.Color(F.coat), dc = new THREE.Color(F.tip), tmp = new THREE.Color();
  const cols = [];
  for (let i = 0; i < earGeo.attributes.position.count; i++) {
    tmp.copy(ec).lerp(dc, THREE.MathUtils.smoothstep(earGeo.attributes.position.getY(i), 0.55, 0.88));
    cols.push(tmp.r, tmp.g, tmp.b);
  }
  earGeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  const earMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.58, sheen: 1, sheenRoughness: 0.42, sheenColor: F.earSheen });
  const innerGeo = new THREE.LatheGeometry(earPts.map((v) => v.clone().multiplyScalar(0.62)), 64, Math.PI);
  const inner = fur(THREE, C.foxInner, 0xffffff);
  for (const sx of [-1, 1]) {
    const ear = new THREE.Group();
    ear.add(mesh(THREE, earGeo, earMat, { s: [1, 1, 0.48] }));
    ear.add(mesh(THREE, innerGeo, inner, { p: [0, 0.1, 0.12], s: [1, 1, 0.3] }));
    ear.position.set(0.55 * sx, 0.62, -0.05);
    ear.rotation.set(-0.12, 0, -0.42 * sx);
    g.add(ear);
  }
  return g;
}

// CIE L*a*b* of a color (three.js keeps components in linear sRGB).
function labOf(c) {
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const x = f((0.4124 * c.r + 0.3576 * c.g + 0.1805 * c.b) / 0.95047);
  const y = f(0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b);
  const z = f((0.0193 * c.r + 0.1192 * c.g + 0.9505 * c.b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

// Takes the swatch on the body as a pastel: the swatch's hue at sRGB HSL saturation 0.75, made as
// light as it can be while standing CIE76 44 from the original body (about 22 in the render), so
// every color is as easy to tell from Original as the others. It never goes below lightness 0.66,
// so it stays soft and pale; Lagoon, whose hue sits next to the original's mint white, stops there.
// The sheen is a lighter pastel and the faint glow a slightly deeper one. The studio's cool fill
// pulls pale colors toward blue, so each is balanced against the cast measured on the original
// body (linear 1 : 1.03 : 1.07). The eyes, nose and blush keep their colors.
function ghost(THREE, { accent } = {}) {
  const g = new THREE.Group();
  let bodyC = C.ghost, sheenC = C.ghostSheen, glowC = 0xcfede3;
  if (accent !== undefined) {
    const { h } = new THREE.Color(accent).getHSL({}, THREE.SRGBColorSpace);
    const balance = new THREE.Color(1, 1 / 1.03, 1 / 1.07);
    const pastel = (s, l) => new THREE.Color().setHSL(h, s, l, THREE.SRGBColorSpace).multiply(balance);
    const white = labOf(new THREE.Color(C.ghost));
    const far = (l) => Math.hypot(...labOf(pastel(0.75, l)).map((v, i) => v - white[i])) >= 44;
    let lo = 0.66, hi = 0.95;
    if (far(lo)) for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (far(m)) lo = m; else hi = m; }
    bodyC = pastel(0.75, lo);
    sheenC = pastel(0.75, Math.min(0.92, lo + 0.11));
    glowC = pastel(0.7, lo - 0.04);
  }
  const body = new THREE.MeshPhysicalMaterial({
    color: bodyC, roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.2,
    sheen: 0.5, sheenColor: sheenC, emissive: glowC, emissiveIntensity: 0.05, side: THREE.DoubleSide,
  });
  const ink = gloss(THREE, C.ink);
  const spark = sparkle(THREE);
  const blush = new THREE.MeshPhysicalMaterial({ color: C.blush, roughness: 0.7, sheen: 0.6, sheenColor: 0xffffff });

  const pts = new THREE.SplineCurve(
    [[0, 1.3], [0.32, 1.26], [0.58, 1.16], [0.78, 1.0], [0.92, 0.78], [1.0, 0.5], [1.04, 0.15], [1.05, -0.2], [1.07, -0.55], [1.09, -0.8]].map(([x, y]) => new THREE.Vector2(x, y))
  ).getPoints(80);
  const geo = new THREE.LatheGeometry(pts, 192, Math.PI);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const t = THREE.MathUtils.smoothstep(-y, 0.4, 0.8);
    p.setY(i, y + t * 0.16 * Math.sin(Math.atan2(z, x) * 7));
  }
  geo.computeVertexNormals();
  g.add(mesh(THREE, geo, body));

  for (const sx of [-1, 1]) {
    g.add(mesh(THREE, new THREE.SphereGeometry(0.13, 64, 48), ink, { p: [0.33 * sx, 0.5, 0.9], s: [0.82, 1.15, 0.45] }));
    g.add(mesh(THREE, new THREE.SphereGeometry(0.03, 24, 16), spark, { p: [0.33 * sx + 0.04, 0.57, 0.958] }));
    g.add(mesh(THREE, new THREE.SphereGeometry(0.13, 48, 32), blush, { p: [0.58 * sx, 0.3, 0.85], s: [1.3, 0.75, 0.3], r: [0, 0.55 * sx, 0] }));
    g.add(mesh(THREE, new THREE.SphereGeometry(0.27, 64, 48), body, { p: [1.04 * sx, -0.1, 0.25], s: [0.75, 1.25, 0.7], r: [0, 0, 0.55 * sx] }));
  }
  g.add(mesh(THREE, new THREE.SphereGeometry(0.085, 48, 32), ink, { p: [0, 0.22, 1.02], s: [1.25, 0.9, 0.4] }));
  return g;
}

// Takes the swatch on the shell, as painted metal: the bright tone over a metallic base under a
// glossy clear coat. The visor, eyes, lamps and gunmetal parts keep their colors.
function robot(THREE, { accent } = {}) {
  const g = new THREE.Group();
  const steel = accent === undefined
    ? new THREE.MeshPhysicalMaterial({ color: C.steel, metalness: 0.6, roughness: 0.3, clearcoat: 0.5, clearcoatRoughness: 0.15 })
    : new THREE.MeshPhysicalMaterial({ color: accent, metalness: 0.45, roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.08 });
  const gun = new THREE.MeshPhysicalMaterial({ color: C.gunmetal, metalness: 0.75, roughness: 0.32 });
  const visor = new THREE.MeshPhysicalMaterial({ color: C.visor, metalness: 0.2, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.03 });
  const glow = new THREE.MeshStandardMaterial({ color: 0x3fc9dc, emissive: 0x2fd3e8, emissiveIntensity: 1.1, roughness: 0.2 });
  const amber = new THREE.MeshStandardMaterial({ color: 0xe8901f, emissive: 0xf08c1a, emissiveIntensity: 1.0, roughness: 0.25 });

  g.add(mesh(THREE, roundedBox(THREE, 1.9, 1.62, 1.55, 0.38), steel));
  g.add(mesh(THREE, roundedBox(THREE, 1.46, 0.78, 0.3, 0.15), visor, { p: [0, 0.1, 0.68] }));
  for (const sx of [-1, 1]) {
    g.add(mesh(THREE, new THREE.CapsuleGeometry(0.1, 0.14, 12, 32), glow, { p: [0.32 * sx, 0.1, 0.84], s: [1, 1, 0.5] }));
    const ear = mesh(THREE, new THREE.CylinderGeometry(0.25, 0.25, 0.24, 64), gun, { p: [1.02 * sx, 0, 0], r: [0, 0, Math.PI / 2] });
    g.add(ear);
    g.add(mesh(THREE, new THREE.CylinderGeometry(0.14, 0.14, 0.06, 48), amber, { p: [1.15 * sx, 0, 0], r: [0, 0, Math.PI / 2] }));
    g.add(mesh(THREE, new THREE.SphereGeometry(0.05, 24, 16), gun, { p: [0.68 * sx, 0.64, 0.74] }));
  }
  g.add(mesh(THREE, new THREE.TorusGeometry(0.17, 0.035, 16, 64, Math.PI), gun, { p: [0, -0.4, 0.79], r: [0, 0, Math.PI] }));
  g.add(mesh(THREE, new THREE.CylinderGeometry(0.13, 0.15, 0.1, 48), gun, { p: [0, 0.84, 0] }));
  g.add(mesh(THREE, new THREE.CylinderGeometry(0.035, 0.035, 0.42, 24), gun, { p: [0, 1.06, 0] }));
  g.add(mesh(THREE, new THREE.SphereGeometry(0.13, 48, 32), amber, { p: [0, 1.32, 0] }));
  return g;
}

// Takes the swatch on the helmet shell (bright tone, glossy paint) and the collar and visor rim
// (deep tone). The visor, eye glow, lamp and gunmetal housing keep their colors.
function astronaut(THREE, { accent, deep } = {}) {
  const g = new THREE.Group();
  const white = new THREE.MeshPhysicalMaterial({ color: accent ?? C.helmet, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.12 });
  const collar = new THREE.MeshPhysicalMaterial({ color: deep ?? C.collar, roughness: 0.45, clearcoat: 0.4 });
  const gun = new THREE.MeshPhysicalMaterial({ color: C.gunmetal, metalness: 0.75, roughness: 0.32 });
  const glass = new THREE.MeshPhysicalMaterial({
    color: C.glass, metalness: 0.85, roughness: 0.07, clearcoat: 1, clearcoatRoughness: 0.02,
    iridescence: 0.7, iridescenceIOR: 1.6, iridescenceThicknessRange: [200, 600],
  });
  const eyeGlow = new THREE.MeshStandardMaterial({ color: 0xdff1ff, emissive: 0xcfe9ff, emissiveIntensity: 0.9 });
  const amber = new THREE.MeshStandardMaterial({ color: 0xe8901f, emissive: 0xf08c1a, emissiveIntensity: 1.0, roughness: 0.25 });

  const helmetGeo = new THREE.SphereGeometry(1, 160, 120);
  helmetGeo.rotateY(-Math.PI / 2);
  g.add(mesh(THREE, helmetGeo, white));

  // Visor: an ellipsoid bulging out of the helmet, with a rim tube traced along the seam.
  const vc = new THREE.Vector3(0, 0.05, 0.62), va = new THREE.Vector3(0.78, 0.56, 0.48);
  g.add(mesh(THREE, new THREE.SphereGeometry(1, 160, 120), glass, { p: [vc.x, vc.y, vc.z], s: [va.x, va.y, va.z] }));
  const rimPts = [];
  for (let k = 0; k < 160; k++) {
    const a = (k / 160) * Math.PI * 2;
    let lo = 0, hi = 1, pt = new THREE.Vector3();
    for (let it = 0; it < 40; it++) {
      const s = (lo + hi) / 2;
      pt.set(vc.x + s * va.x * Math.cos(a), vc.y + s * va.y * Math.sin(a), vc.z + va.z * Math.sqrt(1 - s * s));
      if (pt.length() > 1) lo = s; else hi = s;
    }
    rimPts.push(pt.clone().multiplyScalar(1.004));
  }
  g.add(mesh(THREE, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rimPts, true), 320, 0.055, 24, true), collar));

  for (const sx of [-1, 1]) {
    g.add(mesh(THREE, new THREE.SphereGeometry(0.12, 32, 24), eyeGlow, { p: [0.24 * sx, 0.12, 1.055], s: [0.8, 1.2, 0.35] }));
  }
  g.add(mesh(THREE, new THREE.CylinderGeometry(0.13, 0.13, 0.18, 48), gun, { p: [0.9, 0.36, 0.34], r: [0, -0.36, Math.PI / 2] }));
  g.add(mesh(THREE, new THREE.SphereGeometry(0.1, 32, 24), amber, { p: [0.99, 0.36, 0.38] }));
  g.add(mesh(THREE, new THREE.TorusGeometry(0.66, 0.2, 32, 96), collar, { p: [0, -0.92, 0], r: [Math.PI / 2, 0, 0] }));
  return g;
}

const BUILDERS = { fox, ghost, robot, astronaut, ...CAST };

export const SETS = {
  classics: ['fox', 'ghost', 'robot', 'astronaut'],
  anime: ['hero', 'star', 'ninja', 'neko'],
  movie: ['ace', 'detective', 'cowboy', 'agent'],
};

// color is one of the picker swatches (original, moss, lagoon, dusk, rose).
// The Anime and Movie night characters re-render their accent; skin never changes.
// accessory (headphones, glasses, headlamp; see accessories.mjs) is fitted to the head and turns
// with it. With separate, it is left out of the mascot and handed back, posed, as
// g.userData.accessory, so a render can frame the mascot alone and draw the accessory as a layer.
export function buildMascot(THREE, name, color = 'original', accessory = null, { separate = false } = {}) {
  const tone = ACCENTS[color];
  const inner = BUILDERS[name](THREE, tone ? { accent: tone[0], deep: tone[1] } : {});
  const g = new THREE.Group();
  inner.rotation.set(0.05, 0.32, 0);
  g.add(inner);
  if (accessory) {
    const acc = addAccessory(THREE, inner, name, accessory);
    if (separate) {
      const posed = new THREE.Group();
      posed.rotation.copy(inner.rotation);
      posed.add(acc);
      g.userData.accessory = posed;
    }
  }
  return g;
}

function roomScene(THREE) {
  const s = new THREE.Scene();
  s.add(new THREE.Mesh(new THREE.BoxGeometry(12, 12, 12), new THREE.MeshBasicMaterial({ color: 0x6f777b, side: THREE.BackSide })));
  const panel = (w, h, color, k, pos, look) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(pos[0], pos[1], pos[2]);
    m.lookAt(look[0], look[1], look[2]);
    s.add(m);
  };
  panel(6, 6, 0xffffff, 5, [0, 5.8, 0], [0, 0, 0]);
  panel(4, 5, 0xfff1e0, 4, [5.8, 1.5, 2.5], [0, 0, 0]);
  panel(4, 4, 0xd6e6ff, 1.6, [-5.8, 0.5, 1.5], [0, 0, 0]);
  panel(5, 3, 0xffffff, 3, [0, 1.5, -5.8], [0, 0, 0]);
  panel(8, 2, 0x3a3328, 1, [0, -5.8, 0], [0, 0, 0]);
  return s;
}

export function createStage(THREE, renderer, aspect = 1) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(roomScene(THREE), 0.04).texture;

  const key = new THREE.DirectionalLight(0xfff1e0, 2.4);
  key.position.set(3, 4, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -3; key.shadow.camera.right = 3;
  key.shadow.camera.top = 3; key.shadow.camera.bottom = -3;
  key.shadow.camera.near = 0.5; key.shadow.camera.far = 20;
  key.shadow.bias = -0.0003;
  key.shadow.normalBias = 0.02;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xd6e6ff, 0.7);
  fill.position.set(-5, 1, 3);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xffffff, 2.2);
  rim.position.set(-3, 2.5, -4);
  scene.add(rim);

  const rim2 = new THREE.DirectionalLight(0xfff4e6, 1.2);
  rim2.position.set(3.5, 1, -3);
  scene.add(rim2);

  scene.add(new THREE.HemisphereLight(0xeaf2ff, 0x3a3020, 0.35));

  const camera = new THREE.PerspectiveCamera(26, aspect, 0.1, 100);
  return { scene, camera };
}

export function frame(THREE, camera, object, pad = 1.1) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const half = Math.max(size.y, size.x / camera.aspect) / 2;
  const dist = (half * pad) / Math.tan(fov / 2) + size.z / 2;
  const dir = new THREE.Vector3(0, 0.14, 1).normalize();
  camera.position.copy(center).addScaledVector(dir, dist);
  camera.lookAt(center);
  camera.near = dist / 20;
  camera.far = dist * 4;
  camera.updateProjectionMatrix();
}
