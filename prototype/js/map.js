/* The shared city map for both phones: drawing, the walk route, markers, trail and distance. */
(function () {
  'use strict';

  const W = 390;
  const H = 844;
  const METERS_PER_PX = 6;

  // Alex walks along the main road, a cubic bezier from the lower left to the upper right.
  const P0 = [-20, 560], P1 = [120, 470], P2 = [200, 330], P3 = [410, 170];
  const T_START = 0.6;
  const T_END = 0.88;
  const HOME = [326, 150]; // where Mom is

  function bez(t) {
    const u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    return [a * P0[0] + b * P1[0] + c * P2[0] + d * P3[0], a * P0[1] + b * P1[1] + c * P2[1] + d * P3[1]];
  }

  // Distances: under 1 km in meters to the nearest 10, then one decimal up to 10 km, then whole km.
  // Approximate: to the nearest 0.5 km, "about 1 km", "about 1.5 km", or "under 1 km".
  const meters = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) * METERS_PER_PX;
  function distanceParts(p, q, approx) {
    const m = meters(p, q);
    if (approx) {
      const half = Math.round(m / 500) / 2;
      if (half < 1) return { under: true, n: '1', unit: 'km' };
      return { about: true, n: String(half % 1 ? half.toFixed(1) : half), unit: 'km' };
    }
    if (m < 995) return { n: String(Math.max(10, Math.round(m / 10) * 10)), unit: 'm' };
    const km = m / 1000;
    return { n: km < 9.95 ? km.toFixed(1) : String(Math.round(km)), unit: 'km' };
  }
  function distanceLabel(p, q, approx) {
    const d = distanceParts(p, q, approx);
    return `${d.under ? 'under ' : d.about ? 'about ' : ''}${d.n} ${d.unit}`;
  }
  // For screen readers: the unit's name, never its symbol.
  function distanceSpoken(p, q, approx) {
    const d = distanceParts(p, q, approx);
    const one = d.n === '1';
    const unit = d.unit === 'm' ? (one ? 'meter' : 'meters') : one ? 'kilometer' : 'kilometers';
    return `${d.under ? 'under ' : d.about ? 'about ' : ''}${d.n} ${unit}`;
  }

  // "Where Alex is, in words": the nearest labelled street or park on this map (the real page asks the
  // Maps API in the viewer's browser and never stores it), and the area when Alex is approximate.
  const STREETS = [
    { name: 'Harbor Way', a: [-10, 470], b: [400, 438] },
    { name: 'Market Street', a: [226, -10], b: [248, 860] },
  ];
  const PARKS = [
    { name: 'Alder Park', r: [252, 34, 124, 86] },
    { name: 'Quay Gardens', r: [22, 176, 112, 92] },
  ];
  const segDist = (p, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  };
  const rectDist = (p, r) => Math.hypot(Math.max(r[0] - p[0], 0, p[0] - (r[0] + r[2])), Math.max(r[1] - p[1], 0, p[1] - (r[1] + r[3])));
  function nearest(p) {
    const all = [...STREETS.map((s) => ({ name: s.name, d: segDist(p, s.a, s.b), park: false })), ...PARKS.map((k) => ({ name: k.name, d: rectDist(p, k.r), park: true }))];
    all.sort((x, y) => x.d - y.d);
    return all[0];
  }
  // Areas for an approximate share: named for the part of town, never a street.
  function area(p) {
    if (p[1] > 420) return 'Harbor';
    if (p[0] > 200 && p[1] < 200) return 'Alder Park';
    if (p[0] < 150 && p[1] < 330) return 'Quay Gardens';
    return 'Market';
  }
  // Compass direction from q (the viewer) to p, in words.
  const DIRS = ['east', 'north-east', 'north', 'north-west', 'west', 'south-west', 'south', 'south-east'];
  function direction(p, q) {
    const a = Math.atan2(q[1] - p[1], p[0] - q[0]);
    return DIRS[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
  }
  // One line for the viewer's page. Before the viewer shares back there's no "from you".
  function whereWords(p, q, approx, lost) {
    const n = nearest(p);
    const place = approx ? `In the ${area(p)} area` : n.d < 18 && n.park ? `In ${n.name}` : `Near ${n.name}`;
    const head = lost ? `Last seen ${place.replace(/^In the/, 'in the').replace(/^Near/, 'near').replace(/^In /, 'in ')}` : place;
    if (!q) return { text: head, spoken: head };
    const near = distanceLabel(p, q, approx);
    const nearS = distanceSpoken(p, q, approx);
    const lostAbout = lost && !approx ? 'about ' : '';
    if (approx) return { text: `${head} · ${near} from you`, spoken: `${head}, ${nearS} from you` };
    return { text: `${head} · ${lostAbout}${near} ${direction(p, q)} of you`, spoken: `${head}, ${lostAbout}${nearS} ${direction(p, q)} of you` };
  }

  // A viewer has no account: their disc shows the initial of the name the sharer gave, or this.
  const PERSON = '<svg class="person-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4.3" fill="currentColor"/><path d="M3.8 20.4c.8-4.2 4.1-6.6 8.2-6.6s7.4 2.4 8.2 6.6z" fill="currentColor"/></svg>';

  // label: the live maps are one image with a short label; thumbnails and wallpapers are hidden.
  function svg(viewBox, label) {
    return `<svg class="mapsvg" viewBox="${viewBox || `0 0 ${W} ${H}`}" preserveAspectRatio="xMidYMid slice" ${label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'}>
      <rect class="m-land" x="-400" y="-400" width="${W + 800}" height="${H + 800}"></rect>
      <path class="m-water" d="M-30 610 C 90 576 180 646 280 614 C 340 596 380 588 430 594 L 430 720 C 330 712 250 744 160 728 C 90 716 30 724 -30 732 Z"></path>
      <rect class="m-park" x="252" y="34" width="124" height="86" rx="18"></rect>
      <rect class="m-park" x="22" y="176" width="112" height="92" rx="18"></rect>
      <rect class="m-park" x="262" y="356" width="104" height="70" rx="16"></rect>
      <g>
        <path class="m-road" d="M-300 152 L700 84"></path>
        <path class="m-road" d="M-300 341 L700 263"></path>
        <path class="m-road" d="M-300 493 L700 415"></path>
        <path class="m-road" d="M-300 806 L700 752"></path>
        <path class="m-road" d="M86 -300 L138 1150"></path>
        <path class="m-road" d="M218 -300 L256 1150"></path>
        <path class="m-road" d="M330 -300 L358 1150"></path>
      </g>
      <path class="m-major" d="M${P0[0]} ${P0[1]} C ${P1[0]} ${P1[1]}, ${P2[0]} ${P2[1]}, ${P3[0]} ${P3[1]}"></path>
      <path class="m-major" d="M-40 590 L${P0[0]} ${P0[1]}"></path>
      <g aria-hidden="true">
      <text class="m-label" x="266" y="82">Alder Park</text>
      <text class="m-label" x="34" y="226">Quay Gardens</text>
      <text class="m-label" x="10" y="466" transform="rotate(-4.5 10 466)">Harbor Way</text>
      <text class="m-label" x="252" y="560" transform="rotate(86 252 560)">Market St</text>
      <text class="m-label" x="150" y="676">River</text>
      </g>
    </svg>`;
  }

  // Screen readers get the map as one image with a short label, and each marker as one phrase
  // ("Alex, live, 1.2 kilometers away, updated 2 seconds ago"). Initials, name capsules, the trail,
  // the line and the distance chip are hidden from them. Halo and bob run only for a moment after
  // each ping; a stale marker is still.
  class MapView {
    constructor(host) {
      host.innerHTML = `<div class="map-pan">${svg(null, 'Street map')}
        <svg class="mapsvg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <g class="m-trail"></g>
          <line class="m-line" x1="0" y1="0" x2="0" y2="0"></line>
        </svg>
        <div class="mk sharer"><div class="area" aria-hidden="true"></div><div class="halo" aria-hidden="true"></div><div class="disc" role="img"><img alt=""><img class="acc-layer" alt="" style="display:none"></div><div class="name" aria-hidden="true"><span></span></div></div>
        <div class="mk viewer"><div class="halo" aria-hidden="true"></div><div class="disc" role="img"><span class="ini" aria-hidden="true">M</span></div><div class="name" aria-hidden="true"><span></span></div></div>
        <div class="chip" aria-hidden="true"></div></div>`;
      this.pan = host.querySelector('.map-pan');
      this.base = this.pan.querySelector('svg[role="img"]');
      this.pinged = { sharer: 0, viewer: 0 };
      this.timers = {};
      this.trail = host.querySelector('.m-trail');
      this.line = host.querySelector('.m-line');
      this.sharer = host.querySelector('.mk.sharer');
      this.viewer = host.querySelector('.mk.viewer');
      this.viewerDisc = this.viewer.querySelector('.disc .ini');
      this.sharerLabel = this.sharer.querySelector('.disc');
      this.viewerLabel = this.viewer.querySelector('.disc');
      this.lastMark = 'M';
      this.img = this.sharer.querySelector('img');
      // A render that can't load: the Original render, then the flat SVG, then the plain disc.
      this.img.addEventListener('error', () => {
        const src = this.img.getAttribute('src') || '';
        const id = (src.match(/([a-z]+)(?:-[a-z]+)?\.png$/) || [])[1];
        if (src.includes('/colors/') && id) this.img.setAttribute('src', `../design-system/assets/Mascots/${id}.png`);
        else if (src.endsWith('.png') && id) this.img.setAttribute('src', `../design-system/assets/Mascots/${id}.svg`);
        else this.img.style.visibility = 'hidden';
      });
      // The accessory is a second, untinted layer over the render. One that fails to load stays hidden.
      this.acc = this.sharer.querySelector('.acc-layer');
      this.accBad = new Set();
      this.acc.addEventListener('error', () => { this.accBad.add(this.acc.getAttribute('src')); this.acc.style.display = 'none'; });
      this.chip = host.querySelector('.chip');
      this.lastTrail = '';
      this.lastPos = { sharer: '', viewer: '' };
      this.calm = window.matchMedia('(prefers-reduced-motion: reduce)');
    }

    // With Reduce Motion on, a marker cross-fades to its new spot instead of gliding there.
    // Otherwise a new position starts a short pulse (halo and bob, about 2.6 s), then the marker rests.
    moved(el, key, x, y) {
      const pos = `${Math.round(x)},${Math.round(y)}`;
      if (this.lastPos[key] !== pos) {
        if (this.calm.matches && this.lastPos[key]) {
          el.classList.remove('xfade');
          void el.offsetWidth;
          el.classList.add('xfade');
        }
        this.ping(el, key);
      }
      this.lastPos[key] = pos;
    }

    ping(el, key) {
      clearTimeout(this.timers[key]);
      el.classList.add('pinged');
      this.timers[key] = setTimeout(() => el.classList.remove('pinged'), 2600);
    }

    // Show Alex: center on the sharer and pulse the marker once.
    spot() { this.ping(this.sharer, 'sharer'); }

    // Pans (and, to fit two people, zooms out) the drawing so they sit in the band the sheet and bars
    // leave open. Markers, the chip and the labels keep their size (--k is the counter-scale).
    panTo(dx, dy, k = 1) {
      const t = `translate(${Math.round(dx)}px, ${Math.round(dy)}px) scale(${k.toFixed(3)})`;
      if (this.pan.style.transform !== t) {
        this.pan.style.transform = t;
        this.pan.style.setProperty('--k', (1 / k).toFixed(3));
      }
    }

    update(v) {
      const s = v.sharer, w = v.viewer;
      this.sharer.style.display = s.visible ? '' : 'none';
      this.sharer.style.left = `${s.x}px`;
      this.sharer.style.top = `${s.y}px`;
      this.sharer.classList.toggle('seen', !!s.seen);
      // Approximate: a soft circle about 500 m across the rounded point instead of a pin-exact marker.
      this.sharer.classList.toggle('approx', !!s.approx);
      if (s.img !== this.wantImg) { this.wantImg = s.img; this.img.style.visibility = ''; this.img.setAttribute('src', s.img); }
      const acc = s.acc && !this.accBad.has(s.acc) ? s.acc : '';
      if (acc && this.acc.getAttribute('src') !== acc) this.acc.setAttribute('src', acc);
      this.acc.style.display = acc ? '' : 'none';
      this.sharer.querySelector('.name span').textContent = s.label;
      this.say(this.sharerLabel, s.phrase);
      if (s.visible) this.moved(this.sharer, 'sharer', s.x, s.y);

      this.viewer.style.display = w.visible ? '' : 'none';
      this.viewer.style.left = `${w.x}px`;
      this.viewer.style.top = `${w.y}px`;
      this.viewer.querySelector('.name span').textContent = w.label;
      this.say(this.viewerLabel, w.phrase);
      const mark = w.mark || 'M';
      if (mark !== this.lastMark) { this.viewerDisc.innerHTML = mark; this.lastMark = mark; }
      if (w.visible) this.moved(this.viewer, 'viewer', w.x, w.y);

      const both = s.visible && w.visible;
      this.line.style.display = both ? '' : 'none';
      this.chip.style.display = both ? '' : 'none';
      if (both) {
        this.line.setAttribute('x1', s.x); this.line.setAttribute('y1', s.y);
        this.line.setAttribute('x2', w.x); this.line.setAttribute('y2', w.y);
        this.chip.style.left = `${(s.x + w.x) / 2}px`;
        this.chip.style.top = `${(s.y + w.y) / 2}px`;
        this.chip.textContent = distanceLabel([s.x, s.y], [w.x, w.y], s.approx);
      }

      if (v.mapLabel && this.base.getAttribute('aria-label') !== v.mapLabel) this.base.setAttribute('aria-label', v.mapLabel);

      const key = s.visible ? v.trail.map((p) => p.join(',')).join(';') : '';
      if (key !== this.lastTrail) {
        const n = v.trail.length;
        this.trail.innerHTML = s.visible
          // Every dot is full strength (3:1 on every map fill); age shows by size, 8px newest to 4px oldest.
          ? v.trail.map((p, i) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${(2 + 2 * (i + 1) / Math.max(n, 1)).toFixed(2)}"></circle>`).join('')
          : '';
        this.lastTrail = key;
      }
    }
  }

  // A marker's one phrase; without one (the mini map) it's hidden from screen readers.
  MapView.prototype.say = function say(el, phrase) {
    if (phrase) {
      if (el.getAttribute('aria-label') !== phrase) el.setAttribute('aria-label', phrase);
      if (el.hasAttribute('aria-hidden')) el.removeAttribute('aria-hidden');
    } else if (el.getAttribute('aria-hidden') !== 'true') { el.setAttribute('aria-hidden', 'true'); el.removeAttribute('aria-label'); }
  };

  window.TML = window.TML || {};
  window.TML.map = { W, H, T_START, T_END, HOME, PERSON, METERS_PER_PX, bez, svg, distanceLabel, distanceSpoken, meters, nearest, area, direction, whereWords, MapView };
})();
