// Render jobs, shared by render.html and sheet.html.
//
//   fox                  a mascot, as it has always rendered
//   hero:dusk            a mascot in one of its colors
//   fox@glasses          a mascot wearing an accessory, in one scene (for checking)
//   star:rose@headphones the same, in a color
//   fox@glasses/layer    the accessory alone, as an overlay for fox.png (transparent elsewhere)
//
// Every job frames the camera on the mascot alone, exactly as the plain renders do, so a layer
// lines up pixel for pixel with fox.png and with every color render of the same mascot.
import { buildMascot, createStage, frame } from './mascots.mjs';

export function parseJob(job) {
  const m = /^([a-z]+)(?::([a-z]+))?(?:@([a-z]+)(\/layer)?)?$/.exec(job.trim());
  if (!m) throw new Error(`Cannot read job "${job}"`);
  return { name: m[1], color: m[2] || 'original', accessory: m[3] || null, layer: !!m[4] };
}

// Renders one job with the renderer and returns a canvas holding the image.
export function renderJob(THREE, renderer, job) {
  const { name, color, accessory, layer } = parseJob(job);
  const { scene, camera } = createStage(THREE, renderer, 1);
  const mascot = buildMascot(THREE, name, color, accessory, { separate: true });
  scene.add(mascot);
  frame(THREE, camera, mascot);
  const acc = mascot.userData.accessory;
  if (acc) scene.add(acc);
  if (!layer) {
    renderer.render(scene, camera);
    return renderer.domElement;
  }
  return accessoryLayer(THREE, renderer, scene, camera, mascot, acc);
}

// The accessory as an overlay: everything the accessory adds to the picture and nothing else.
//   1. The mascot alone, and the mascot with the accessory present only as a shadow caster. Where
//      they differ is the accessory's shadow; it becomes black at the opacity that turns one into
//      the other, so it darkens any color of the mascot the same way.
//   2. The accessory itself, with the mascot drawn into depth only: it still hides the parts of
//      the accessory behind it, and still shades the accessory, but leaves its pixels clear.
// Transparent bits of the mascot (a face print, the Agent's clear earpiece) never hide anything.
function accessoryLayer(THREE, renderer, scene, camera, mascot, acc) {
  const { width: W, height: H } = renderer.domElement;
  const snap = () => {
    renderer.render(scene, camera);
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    c.getContext('2d').drawImage(renderer.domElement, 0, 0);
    return c;
  };
  const pixels = (c) => c.getContext('2d').getImageData(0, 0, W, H).data;
  // Switch every material under root (once each: meshes share them), and hand back an undo.
  const mute = (root, fn) => {
    const saved = new Map();
    root.traverse((o) => {
      if (!o.material || saved.has(o.material)) return;
      saved.set(o.material, [o.material.colorWrite, o.material.depthWrite]);
      fn(o.material);
    });
    return () => saved.forEach(([c, d], m) => { m.colorWrite = c; m.depthWrite = d; });
  };

  acc.visible = false;
  const plain = pixels(snap());
  acc.visible = true;
  let undo = mute(acc, (m) => { m.colorWrite = false; m.depthWrite = false; });
  const shaded = pixels(snap());
  undo();
  undo = mute(mascot, (m) => { m.colorWrite = false; if (m.transparent) m.depthWrite = false; });
  const own = snap();
  undo();

  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const ctx = out.getContext('2d');
  const img = ctx.createImageData(W, H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = plain[i + 3];
    if (!a) continue;
    const r = plain[i], g = plain[i + 1], b = plain[i + 2];
    const nn = r * r + g * g + b * b;
    if (nn < 300) continue;
    const k = (r * shaded[i] + g * shaded[i + 1] + b * shaded[i + 2]) / nn;
    const s = Math.min(0.95, Math.max(0, 1 - k)) * (a / 255);
    d[i + 3] = Math.round(s * 255);
  }
  ctx.putImageData(img, 0, 0);
  ctx.drawImage(own, 0, 0);
  return out;
}
