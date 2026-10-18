# Mascot pipeline

The twelve Track Me Live mascots and their accessories are modeled in code with three.js r160 and rendered to PNG in headless Chrome. Nothing is hand-painted after rendering. Change the model, then render again.

## Models (`model/`)

| File | What it holds |
| --- | --- |
| `mascots.mjs` | The Classics (fox, ghost, robot, astronaut) as soft vinyl heads, plus `buildMascot()`, the studio (`createStage()`) and the camera framing (`frame()`). |
| `cast.mjs` | The Anime set (hero, star, ninja, neko) and the Movie night set (ace, detective, cowboy, agent): busts built on one head shape, with hair and hood shells that follow it. |
| `accessories.mjs` | The three accessories, their support matrix (`ACCESSORY_SUPPORT`), display names (`ACCESSORIES`) and `addAccessory()`. |
| `jobs.mjs` | The render jobs shared by the two pages below, including the overlay layer method. |
| `render.html` | Renders a list of jobs to PNG data URLs (used by `render_mascots.py`). |
| `sheet.html` | Renders a contact sheet for checking work side by side. |

Every head has radius about 1 at the origin and faces +Z. `buildMascot(THREE, name, color, accessory, { separate })` builds one, turned three-quarters to the viewer's right (rotation 0.05, 0.32, 0). `color` is one of the picker swatches: `original`, `moss`, `lagoon`, `dusk`, `rose`.

## Colors

`ACCENTS` in `cast.mjs` holds each swatch as a `[bright, deep]` pair, and every builder takes `{ accent, deep }` from it. Each character recolors one part, from the model, and keeps everything else: skin, and what stands in for it on the Classics (eyes, visors, lamps, the amber accents), never changes. `original` keeps each character's own colors, and the Classics' `original` renders are pixel-identical to the renders from before they took colors.

| Mascot | What takes the color | How |
| --- | --- | --- |
| fox | The fur: coat, the deeper crown, the dark ear tips | Coat in the bright tone, crown half way to the deep tone, ear tips the deep tone at 18% (as dark against the coat as the original's brown tips are against its orange). The fur's sheen is a pale wash of the coat, as the original's is of its orange. The cream cheeks and jaw, inner ears, eyes and nose stay. |
| ghost | The body | A pastel of the bright tone: its hue at sRGB HSL saturation 0.75, as light as it can be while standing CIE76 44 from the original body's color (about 22 in the render), so each color is as easy to tell from Original as the others. Lightness never drops below 0.66, so it stays soft and pale. Lagoon, whose hue sits next to the original's mint white, stops at that floor. The sheen is a lighter pastel and the faint glow a slightly deeper one. All three are white-balanced against the studio's cool cast (linear 1 : 1.03 : 1.07, measured on the original body), so they read as the swatch's own hue, not lilac or grey. The eyes, nose and blush stay. |
| robot | The shell | The bright tone as painted metal: metalness 0.45, roughness 0.34, a full clear coat. The visor, cyan eyes, amber antenna and ear lights and the gunmetal parts stay. |
| astronaut | The helmet shell, the collar and the visor rim | Shell in the bright tone as glossy paint, collar and rim in the deep tone. The visor, eye glow, amber lamp and its gunmetal housing stay. |
| hero | Hair | Bright tone. |
| star | Hair | Bright tone, except Rose: her own sakura pink is too close to Rose's bright tone (CIE76 15 apart in the render), so her Rose is a deep, clear raspberry on the swatch's hue, #BC1452 (25 apart). |
| neko | The hoodie | Bright tone. |
| ninja | The hood, mask and wrap | Deep tone. The red headband stays. |
| ace | The bomber | Deep tone, as cloth. His own bomber is espresso leather. The shearling collar and tee stay. |
| detective | The trench coat | Deep tone. The shirt, tie and fedora stay. |
| cowboy | The hat | Deep tone. The band, concho and neckerchief stay. |
| agent | The dinner jacket | Deep tone. The satin lapels follow it; the shirt and bow tie stay. |

## Accessories

Accessories keep their own colors whatever color the mascot wears.

| Id | Name | Design |
| --- | --- | --- |
| `headphones` | Headphones | Over-ear. Matte asphalt (#2A3236) band with a protein-leather pad, steel sliders and forked yokes, pillowy leather cushions, satin caps, and one lamplight-amber (#F2A033) ring around each cap. |
| `glasses` | Glasses | Round frames cut from dark havana tortoiseshell acetate, with a keyhole bridge, two gold rivets and a gold hinge at each end piece, and clear domed lenses that carry a soft window reflection. |
| `headlamp` | Headlamp | Dark elastic webbing with a thin reflective stripe, and a rounded asphalt lamp that tilts on a bent bracket. Its molded lens glows lamplight (#F7AE45), the sharer's color, and warms the steel bezel around it. |

### Support matrix

`ACCESSORY_SUPPORT` in `accessories.mjs` is the source of truth. The render script reads it from there.

| Mascot | Headphones | Glasses | Headlamp |
| --- | :-: | :-: | :-: |
| fox | yes | yes | yes |
| ghost | yes | yes | yes |
| robot | | | yes |
| astronaut | | | |
| hero | | yes | |
| star | yes | yes | yes |
| ninja | yes | | |
| neko | | yes | yes |
| ace | yes | | yes |
| detective | | yes | |
| cowboy | | yes | |
| agent | yes | yes | yes |

That makes 21 combinations. The gaps are on purpose: each one would collide with gear the character already has (the astronaut's helmet, the robot's ear cans, hero's goggles, ninja's mask, neko's hood ears, ace's aviators, the detective's and cowboy's hat brims).

### How an accessory is fitted

`addAccessory(THREE, mascotGroup, mascotName, accessory)` builds the accessory against the mascot's own vertices, in the head's frame, and adds it to `mascotGroup` (the builder's group, before `buildMascot` turns it). It throws for a combination that is not supported.

- **Headphones.** Each cup measures a height map of whatever is under it (skin, hair, hood, fur). The cushion sits on the highest point of its ring, and its face then settles onto the head, so it presses into hair and seals at the edges. The ear sits in the cushion's hole. The band works in a plane that can lean back (the fox's band goes behind its ears). It follows the taut hull of the head's slice in that plane, so it lies on the crown, runs straight down past the temples and turns upright into the sliders with a generous fillet. The pad lines only the stretch that touches the head.
- **Glasses.** The front is one bent sheet, as real acetate frames are. It sits just far enough forward to clear what stands on the face (eyes, brows, a muzzle) but not a hat brim. Its keyhole bridge sets back to rest on the nose. Each temple is pulled taut from its hinge to the ear and pushed clear of the head, and it curls down behind the ear (or where an ear would be, on the fox and the ghost). For hero, star and neko the temples slide under the hair instead.
- **Headlamp.** The strap is a closed loop at a set height and tilt. It tightens until it rests on whatever is under it, and its section tips to lie flat on a sloping forehead. The lamp sits on the strap at the front.

Per-character numbers (ear and eye positions, band lean, strap height) live in `FIT` in `accessories.mjs`.

## Rendering

Serve `mascots/model` on port 8765 (for example `python3 -m http.server 8765` from that folder), then:

```
python3 mascots/render_mascots.py [--parallel N] <out-dir> [job ...]
```

| Job | Output | What it is |
| --- | --- | --- |
| `fox` | `fox.png` | A mascot, as always. |
| `hero:dusk` | `hero-dusk.png` | A mascot in a color. |
| `fox@glasses` | `fox-glasses-full.png` | The mascot wearing the accessory, in one scene. Used for checking. |
| `star:rose@headphones` | `star-rose-headphones-full.png` | The same, in a color. |
| `fox@glasses/layer` | `fox-glasses.png` | The accessory alone, as an overlay for `fox.png`. |
| `layers` | | Every supported `<mascot>@<accessory>/layer`. |
| `combos` | | Every supported `<mascot>@<accessory>`. |

With no jobs, the script renders all twelve mascots. Renders are 1024 px. A plain or combined job takes about 18 s in SwiftShader and a layer about three times that, so run long batches in the background. `--parallel 2` runs two Chrome processes at a time.

`model/sheet.html` renders a contact sheet: `?m=hero,star&c=original,rose&size=384&cols=4`. Add `&a=glasses,headlamp` (or `&a=all`) to put each accessory on each mascot that supports it, and `&layer=1` to draw the layers alone. `m` also takes full jobs, such as `?m=fox@glasses,star:rose@headlamp`.

### Overlay layers

The app shows an accessory by drawing its layer PNG over any render of the same mascot, in any of its five colors. For that to line up pixel for pixel:

1. Every job frames the camera on the mascot alone, exactly as the plain renders do. The accessory is built with `{ separate: true }` and added to the scene after framing.
2. The layer job renders the mascot alone, then again with the accessory present only as a shadow caster. Where the two differ is the accessory's shadow on the mascot. It is stored as black at the opacity that turns one into the other, so it darkens any color of the mascot the same way.
3. It renders the accessory itself with the mascot drawn into depth only (`colorWrite: false`). The mascot still hides whatever it covers, such as a temple behind an ear or a band behind hair, and still shades the accessory, but leaves its own pixels clear. Transparent parts of the mascot (the face prints, the agent's clear earpiece) hide nothing.
4. The accessory is drawn over its shadow. Everything else stays transparent.

Same stage, lights, tone mapping and size as the plain renders. Glass is ordinary alpha (its reflections decide its opacity), so it composites like everything else. There is deliberately no glow halo: alpha can only darken what is behind it, never brighten it.

### Where things go

| What | Where |
| --- | --- |
| 1024 px mascot masters | `mascots/renders-1024/<id>.png`, `colors/<id>-<color>.png` |
| 1024 px accessory layers | `mascots/renders-1024/accessories/<mascot>-<accessory>.png` |
| 512 px assets for the app | `design-system/assets/Mascots/` (same names; layers in `accessories/`) |

Downscale with `sips -Z 512 <file> --out <dir>`.

### Checking a layer

Draw the layer over the plain render and compare the result with the full render of the same pair (`fox@glasses`). For all 21 layers at 1024 px (8-bit levels, premultiplied):

- Where the accessory covers a pixel fully, they match to within 2 levels. Where the layer is empty, they match to within 1.
- Overall mean difference is 0.036 levels per pixel. The largest difference is 63 levels, on anti-aliased pixels where an accessory passes behind the mascot's soft silhouette edge (the far cup behind a cheek, a temple behind the head). Drawing a layer over a partly transparent edge can be off there by up to a quarter of the color.
- Shadows match in brightness but are neutral. On saturated surfaces the full render's shadow is a little more saturated (tone mapping), with a mean difference of up to 19 levels in shadowed pixels. The neutral shadow is what lets one layer serve all five colors.

At 512 px the mean difference is 0.063 levels, because downscaling and compositing do not commute exactly at sharp edges.
