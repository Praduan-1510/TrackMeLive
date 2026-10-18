# Mascot3D

The mascots as live 3D models, built in three.js from simple shapes and physically based materials, for the places where a mascot is the subject: onboarding and the mascot picker.

## Models

- **Fox**: velvet fur (a sheen material) in orange with a deeper crown and cream cheeks painted into the fur, a tapered snout, glossy eyes with catchlights, ears that darken toward the tip. Color changes the fur, and the ear tips darken with it.
- **Ghost**: soft-sheen vinyl with a wavy hem, blush cheeks and small arms. Color turns the body a soft pastel.
- **Robot**: brushed steel head, glossy black visor with cyan eyes, lamplight antenna and ear lights. Color paints the shell.
- **Astronaut**: glossy white helmet, iridescent visor with a rim traced along its seam, soft eye glow, lamplight side lamp. Color paints the helmet shell, with the collar and visor rim in the color's deep tone.

Across the Classics, eyes, visors and lamps never take the color.

The Anime and Movie night sets are busts: a head with shoulders, so clothes can tell the story.

- **Hero**: spiky two-tone hair swept up and back, brass goggles with teal lenses, cream scarf. Printed anime eyes.
- **Star**: sakura-pink bob with bangs and one antenna lock, gold star clip, teal ribbon bow.
- **Ninja**: indigo hood and mask with an eye slot and rolled edges, red headband knotted at the back.
- **Neko**: oatmeal cat-ear hoodie with a rolled edge and drawstrings, happy closed eyes.
- **Ace**: buzz cut fading into the hairline, gold aviators with gradient lenses, goatee, cheek plaster, espresso leather bomber with a shearling collar.
- **Detective**: pinched fedora, sculpted eyes and brows, five o'clock shadow, khaki trench with a popped collar, shirt and tie.
- **Cowboy**: cattleman-crease hat with a silver concho, chevron moustache, red paisley neckerchief, denim shirt.
- **Agent**: combed-back hair, one raised brow, earpiece with a coiled cord, dinner jacket with satin peak lapels, wing collar and bow tie.

Anime faces are printed onto the head like a vinyl figure's (layered iris, lash line, highlights). Movie night faces are sculpted: eyeballs with irises and lids, brows, a shaped nose and painted lips.

## Stage

- A studio environment for reflections, a warm key light from the upper right, a cool fill from the left and two rim lights from behind, so every silhouette keeps a light edge on `ground` in both themes and on the map.
- Camera: 26° field of view, slightly above eye level, the head turned about 18° to the viewer's right.
- ACES filmic tone mapping, sRGB output, transparent background.
- Idle motion: a slow turn of about 20° each way and a small bob. Off with Reduce Motion.

## Where to use what

- Map markers, list avatars and the expanded Live Activity: the renders in the Mascots asset group. They're light on battery and look the same everywhere.
- Mascot picker and onboarding: live 3D. On iOS, rebuild the models in RealityKit, or export them from three.js as USDZ, so they turn under a finger. On the browser page, use three.js.
- At 20pt and below, where renders lose their features: the flat SVGs. That includes the compact Live Activity and notification icons.
- If a render can't load, a marker or avatar falls back to the flat SVG, then a plain `lamplight` disc.

## Asset pipeline

- Keep the 1024px renders as masters, the source for every export.
- Ship 512px renders only for onboarding and the mascot picker.
- Export marker and avatar sets at 40pt and 32pt, each at 1x, 2x and 3x, and as WebP or AVIF for the browser page. Accessory layers follow the same sizes.

## The consumer provides

- Which mascot, its color and its accessory. Color changes the fur, body or shell for the Classics and the hair or clothing for the Anime and Movie night sets, never skin, eyes, visors or lamps. Accessories keep their own colors on a layer over the render.

## Do

- Keep one camera angle and one lighting setup for every mascot so they read as a set.
- Re-render the PNGs whenever a model, color or the lighting changes. Every color is its own render from the model, never a hue shift.

## Don't

- Don't show live 3D on the map; use the renders.
- Don't add drop shadows to the models or renders; markers supply `shadow-marker`.
