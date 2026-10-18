# Mascots

Twelve characters in three sets, in two forms. All twelve are original. None is based on a real person or an existing anime or film character, and new ones must follow the same rule.

| Set | Characters | Built from |
| --- | --- | --- |
| Classics | Fox (the default), Ghost, Robot, Astronaut | Soft vinyl heads |
| Anime | Hero, Star, Ninja, Neko | Busts with printed anime eyes and sculpted, two-tone hair |
| Movie night | Ace, Detective, Cowboy, Agent | Busts with sculpted eyes, brows and noses, and tailored clothes |

**3D renders (default).** `<id>.png`: 512 by 512, transparent background, rendered from the models in `mascots/model/` with the same camera and studio lighting, so all twelve sit together. The 1024px masters they come from stay the source for every export.

- Ship the 512px renders only for onboarding and the mascot picker.
- Everywhere else a mascot appears at 24pt or more, use the 40pt and 32pt exports, each at 1x, 2x and 3x: map markers (40pt inside the 52pt disc), list avatars (32pt) and the Live Activity. On iOS they go in the asset catalog; on the browser page, ship them as WebP or AVIF.
- The cowboy and the detective read slightly small at marker size. Tune their framing when the 40pt and 32pt exports are made.

- `fox.png`: velvet orange fur, cream cheeks, ears darkening to the tip.
- `ghost.png`: soft white vinyl with blush cheeks and a wavy hem.
- `robot.png`: brushed steel, black visor with cyan eyes, lamplight antenna.
- `astronaut.png`: white helmet, iridescent visor with a rim, lamplight side lamp.
- `hero.png`: swept-up spiky hair, brass goggles with teal lenses, cream scarf.
- `star.png`: sakura-pink bob with bangs and one antenna lock, gold star clip, teal ribbon.
- `ninja.png`: indigo hood and mask with only the eyes showing, red headband knotted at the back.
- `neko.png`: oatmeal cat-ear hoodie with drawstrings, happy closed eyes.
- `ace.png`: buzz cut with a faded hairline, gold aviators, goatee, cheek plaster, espresso leather bomber with a shearling collar.
- `detective.png`: pinched fedora, five o'clock shadow, khaki trench with popped collar, shirt and tie.
- `cowboy.png`: cattleman-crease hat with a silver concho, chevron moustache, red paisley neckerchief, denim shirt.
- `agent.png`: combed-back hair, one raised brow, earpiece, dinner jacket with satin peak lapels and a bow tie.

**Colors.** People pick one of five colors: Original, Moss, Lagoon, Dusk, Rose. Original is `<id>.png`; every other color is its own render in `colors/<id>-<color>.png` (for example `colors/fox-lagoon.png`, `colors/agent-dusk.png`), in the Mascot colors asset group. All twelve characters have all five. Each color changes one part of the character:

| Character | What takes the color |
| --- | --- |
| Fox | The fur: coat, deeper crown and dark ear tips. The cream cheeks and jaw, inner ears, eyes and nose stay. |
| Ghost | The body, as a soft pastel of the color. The eyes, nose and blush stay. |
| Robot | The shell, as painted metal. The visor, cyan eyes, amber antenna and ear lights and gunmetal parts stay. |
| Astronaut | The helmet shell (glossy paint), the collar and the visor rim. The visor, eye glow and amber lamp stay. |
| Hero | Hair. |
| Star | Hair (Rose is a deep raspberry, so it stands apart from her own sakura pink). |
| Neko | The hoodie. |
| Ninja | The hood, mask and wrap. The red headband stays. |
| Ace | The bomber, as cloth (his own is espresso leather). The shearling collar stays. |
| Detective | The trench coat. The fedora, shirt and tie stay. |
| Cowboy | The hat. The band, concho and neckerchief stay. |
| Agent | The dinner jacket and its satin lapels. The shirt and bow tie stay. |

**Skin never changes with color, and neither do eyes, visors and lamps.** Never tint any render with a filter: a hue shift would change those too. Use the color renders.

**Accessories.** `accessories/<id>-<accessory>.png` (`headphones`, `glasses`, `headlamp`): transparent layers rendered with the same camera as the mascot, so they sit exactly on top of `<id>.png` or any of its color renders. Stack the layer over the mascot in the same box, untinted. Each character supports only the accessories that fit it (fox, ghost, star and agent take all three; robot the headlamp; hero, detective and cowboy glasses; ninja headphones; neko glasses and the headlamp; ace headphones and the headlamp; astronaut none).

**Flat SVGs.** `<id>.svg`: 96 by 96 full-color heads. Use them only at 20pt and below (notification icons, the Live Activity's compact view), where the renders lose their features. Each one has `role="img"`, an `aria-label` and a `<title>` with the character's name ("Fox"), so it reads right when inlined. As an `<img>` on its own, give it the same name in `alt`; inside a marker or avatar, which carries its own label, use `alt=""`.

The marker disc supplies the ring, halo and shadow, so never crop, outline or add a shadow to the artwork itself.

**Rebuilding.** Serve `mascots/model/` on port 8765, then run `python3 mascots/render_mascots.py <out-dir> hero hero:dusk ...` for 1024px renders, and downscale them to 512 for this folder. `mascots/model/sheet.html?m=hero,star&c=original,rose` renders a contact sheet for checking the set side by side.
