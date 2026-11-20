import { descentFrame, visibleDepthRange, PIXELS_PER_METER } from './descent.js';

const NOTES = [
  [60, 'light begins to fade'], [200, 'most sunlight stops here'], [332, 'deepest scuba dive — 332m'],
  [535, 'emperor penguins dive this deep'], [1000, 'THE MIDNIGHT ZONE'],
  [1800, 'giant squid territory'], [2500, '2°C. utterly black.'],
  [3000, 'THE ABYSSAL ZONE'], [3800, 'the Titanic rests here — 3,800m'],
  [5200, 'THE HADAL ZONE'], [7000, 'the trench floor — a perfect dive']
];
const WATER_COLORS = [
  [0, '#267a9e'], [120, '#206a91'], [400, '#185776'], [980, '#113e5c'],
  [2100, '#0b273e'], [4300, '#08192c'], [9000, '#050d1a'], [14800, '#030812']
];
const RAY_DEPTH = 1120;
const RAYS = [
  [.04, .18, -.12, .25], [.18, .29, -.15, .21], [.37, .22, -.09, .24],
  [.53, .31, -.16, .16], [.71, .21, -.11, .22], [.88, .28, -.14, .20]
];
const BIO_COLORS = ['#4bdef4', '#7af3d8', '#f55388', '#ffe387'];
const TIER_GLOW = {
  plankton: 'rgba(136,216,238,',
  schooler: 'rgba(75,222,244,',
  rare: 'rgba(104,231,207,',
  deepcut: 'rgba(245,83,136,',
  krillion: 'rgba(255,227,135,',
};
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const wrap = (value, span) => ((value % span) + span) % span;

function sunlight(width) {
  const texture = document.createElement('canvas');
  texture.width = Math.min(960, Math.max(240, Math.ceil(width / 2)));
  texture.height = 500;
  const ctx = texture.getContext('2d');
  const { width: w, height: h } = texture;
  for (const [position, spread, angle, opacity] of RAYS) {
    ctx.save();
    ctx.translate(position * w, 0);
    ctx.rotate(angle * w / h);
    const halfWidth = spread * w / 2;
    const glow = ctx.createLinearGradient(-halfWidth, 0, halfWidth, 0);
    glow.addColorStop(0, 'rgba(177,235,244,0)');
    glow.addColorStop(.28, 'rgba(177,235,244,' + opacity * .44 + ')');
    glow.addColorStop(.54, 'rgba(195,244,252,' + opacity + ')');
    glow.addColorStop(.78, 'rgba(177,235,244,' + opacity * .44 + ')');
    glow.addColorStop(1, 'rgba(177,235,244,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(-halfWidth, -h, halfWidth * 2, h * 3);
    ctx.restore();
  }
  ctx.globalCompositeOperation = 'destination-in';
  const fade = ctx.createLinearGradient(0, 0, 0, h);
  fade.addColorStop(0, '#000');
  fade.addColorStop(.32, '#000b');
  fade.addColorStop(.7, '#0004');
  fade.addColorStop(1, '#0000');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, w, h);
  return texture;
}

export class OceanScene {
  constructor(onFrame) {
    this.world = document.getElementById('world');
    this.canvas = document.getElementById('life');
    this.ctx = this.canvas.getContext('2d');
    this.ruler = document.getElementById('depth-ruler');
    this.notes = document.getElementById('world-notes');
    this.floor = document.getElementById('seafloor');
    this.rulerMarks = this.ruler.appendChild(document.createElement('div'));
    this.noteMarks = this.notes.appendChild(document.createElement('div'));
    this.onFrame = onFrame;
    this.depth = 0; this.target = 0; this.active = false; this.lowPower = false; this.dive = null;
    this.diveIntensity = 0; this.diveTier = ''; this.burst = null;
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.fish = Array.from({ length: 24 }, (_, i) => ({
      x: Math.random(), y: .12 + Math.random() * .82, size: 3 + Math.random() * 5,
      speed: .002 + Math.random() * .007, direction: i % 2 ? 1 : -1
    }));
    this.school = {
      x: .25, y: .32, speed: .009, direction: 1,
      members: Array.from({ length: 16 }, (_, i) => ({
        dx: ((i % 5) * 16 - 32) + Math.random() * 8,
        dy: (Math.floor(i / 5) * 13 - 13) + Math.random() * 7,
        size: 2.2 + (i % 3) * .8, phase: i * .6
      }))
    };
    this.gliders = [
      { kind: 'manta', minD: 40, maxD: 1400, x: .18, y: .42, speed: .0075, dir: 1, size: 1.05 },
      { kind: 'turtle', minD: 0, maxD: 750, x: .76, y: .27, speed: .0055, dir: -1, size: .9 },
      { kind: 'whale', minD: 280, maxD: 3100, x: .12, y: .60, speed: .0036, dir: 1, size: 1.25 },
      { kind: 'squid', minD: 1200, maxD: 6400, x: .82, y: .52, speed: .0048, dir: -1, size: 1.0 },
      { kind: 'angler', minD: 2200, maxD: 8500, x: .24, y: .68, speed: .0032, dir: 1, size: .95 },
    ];
    this.jellies = Array.from({ length: 7 }, (_, i) => ({
      x: .08 + ((i * .19) % .84), y: (i * .17) % 1,
      speed: .004 + (i % 3) * .0016, size: 10 + (i % 4) * 3.5,
      phase: i * 1.35, color: i % 3 === 1 ? '245,83,136' : i % 5 === 0 ? '255,227,135' : '75,222,244'
    }));
    this.bubbles = Array.from({ length: 68 }, () => ({
      x: Math.random(), y: Math.random(), r: .6 + Math.random() * 2.0,
      speed: .008 + Math.random() * .026
    }));
    this.streaks = Array.from({ length: 34 }, (_, i) => ({
      x: Math.random(), y: Math.random(), len: 24 + (i % 5) * 18,
      speed: .35 + (i % 4) * .16, alpha: .08 + (i % 3) * .06
    }));
    this.specks = Array.from({ length: 175 }, (_, i) => ({
      x: Math.random(), y: Math.random(), alpha: .12 + Math.random() * .34,
      bio: i % 4 === 0, color: BIO_COLORS[i % BIO_COLORS.length],
      phase: Math.random() * Math.PI * 2, r: i % 9 === 0 ? 2.1 : 1.35
    }));
    this.ridges = Array.from({ length: 16 }, (_, i) => ({
      side: i % 2, w: .045 + ((i * 7) % 5) * .014, h: 48 + ((i * 19) % 72), step: 14 + (i % 3) * 6
    }));
    this.resize = () => {
      this.width = Math.max(1, innerWidth); this.height = Math.max(1, innerHeight);
      this.rays = sunlight(this.width);
      this.resizeCanvas();
      this.labelOrigin = null;
    };
    addEventListener('resize', this.resize);
    this.resize();
    this.lastPaint = performance.now(); this.effectsTime = 0;
    this.frame = this.frame.bind(this);
    this.frameId = requestAnimationFrame(this.frame);
  }
  resizeCanvas() {
    const pixelBudget = this.lowPower ? 900_000 : 2_500_000;
    const scale = Math.min(devicePixelRatio || 1, this.lowPower ? 1 : 2,
      Math.sqrt(pixelBudget / (this.width * this.height)));
    this.canvas.width = Math.ceil(this.width * scale);
    this.canvas.height = Math.ceil(this.height * scale);
    this.ctx.setTransform(this.canvas.width / this.width, 0, 0, this.canvas.height / this.height, 0, 0);
    this.dirty = true;
  }
  setQuality(lowPower) {
    if (this.lowPower === lowPower) return;
    this.lowPower = lowPower;
    this.resizeCanvas();
  }
  setWorldState(tier = '', diving = false) {
    if (!this.world) return;
    this.world.classList.toggle('is-diving', diving && !this.reducedMotion);
    if (tier) this.world.dataset.tier = tier;
    else delete this.world.dataset.tier;
  }
  pulseTier(tier = '') {
    if (!tier || this.reducedMotion) return;
    this.burst = { startedAt: this.effectsTime, tier, duration: tier === 'krillion' ? 2.2 : 1.5 };
    this.dirty = true;
  }
  set(depth, active, lowPower = false, immediate = false) {
    const landed = this.dive !== null;
    this.dive = null;
    this.diveTier = '';
    this.target = depth; this.active = active; this.setQuality(lowPower);
    if (immediate || landed || this.reducedMotion) this.depth = depth;
    if (!active) this.burst = null;
    this.setWorldState('', false);
  }
  setDescent(fromDepth, toDepth, startedAt, endsAt, lowPower = false, tier = '') {
    this.dive = { fromDepth, toDepth, startedAt, endsAt };
    this.diveTier = tier || '';
    this.target = toDepth; this.active = true; this.setQuality(lowPower);
    this.depth = descentFrame({ ...this.dive, now: Date.now(), height: this.height,
      reducedMotion: this.reducedMotion }).depth;
    if (!this.reducedMotion) {
      this.burst = { startedAt: this.effectsTime, tier: this.diveTier || 'schooler', duration: tier === 'krillion' ? 2.3 : 1.65 };
    }
    this.setWorldState(this.diveTier, true);
  }
  frame(time) {
    const rate = this.lowPower && !this.dive ? 1000 / 24 : 0;
    if (this.dirty || time - this.lastPaint >= rate) {
      const delta = Math.min(100, time - this.lastPaint);
      this.lastPaint = time;
      const h = this.height;
      let diveFrame = null;
      if (this.dive) {
        diveFrame = descentFrame({ ...this.dive, now: Date.now(), height: h, reducedMotion: this.reducedMotion });
        this.depth = diveFrame.depth;
        const distFactor = clamp((this.dive.toDepth - this.dive.fromDepth) / 700, .25, 1.3);
        const arc = Math.sin(clamp(diveFrame.progress, 0, 1) * Math.PI);
        const targetIntensity = diveFrame.landed ? 0 : distFactor * (.35 + .65 * arc);
        this.diveIntensity += (targetIntensity - this.diveIntensity) * .24;
      } else {
        const difference = this.target - this.depth;
        this.depth = Math.abs(difference) < .2 ? this.target : this.depth + difference * (1 - Math.exp(-Math.max(0, delta) / 205));
        this.diveIntensity *= Math.exp(-Math.max(0, delta) / 220);
        if (this.diveIntensity < .01) this.diveIntensity = 0;
      }
      const surface = diveFrame ? diveFrame.surface : this.active
        ? h * .21 - Math.max(0, this.depth * PIXELS_PER_METER - h * .19)
        : h * .60;
      this.scroll = this.active ? Math.max(0, h * .21 - surface) : 0;
      if (this.dirty || surface !== this.surface) this.drawLabels(surface);
      this.surface = surface;
      if (!this.reducedMotion) this.effectsTime += Math.min(50, Math.max(0, delta)) / 1000;
      const burstActive = Boolean(this.burst && (this.effectsTime - this.burst.startedAt) < this.burst.duration);
      if (!burstActive) this.burst = null;
      if (this.dirty || !this.reducedMotion || surface !== this.paintedSurface || this.depth !== this.paintedDepth) {
        this.draw(this.effectsTime, surface);
        this.paintedSurface = surface;
        this.paintedDepth = this.depth;
      }
      const floorOpacity = this.active ? Math.min(.9, Math.max(0, (this.depth - 6200) / 650)) : 0;
      if (floorOpacity !== this.floorOpacity) {
        this.floorOpacity = floorOpacity;
        this.floor.style.opacity = floorOpacity;
      }
      this.dirty = false;
      this.onFrame?.(Math.round(this.depth), diveFrame);
    }
    this.frameId = requestAnimationFrame(this.frame);
  }
  draw(time, surface) {
    const c = this.ctx, w = this.width, h = this.height;
    const water = c.createLinearGradient(0, surface, 0, surface + 14800);
    for (const [distance, color] of WATER_COLORS) water.addColorStop(distance / 14800, color);
    c.fillStyle = water;
    const waveOnScreen = surface > -12;
    const waveY = x => surface + Math.sin(x * .021 + time * 1.05) * 3.5 + Math.sin(x * .008 - time * .82) * 4;
    if (waveOnScreen) {
      c.clearRect(0, 0, w, h);
      c.save();
      c.beginPath();
      c.moveTo(0, waveY(0));
      const segments = Math.ceil(w / 12);
      for (let i = 1; i <= segments; i++) {
        const x = i * w / segments;
        c.lineTo(x, waveY(x));
      }
      c.lineTo(w, h); c.lineTo(0, h); c.closePath();
      c.clip();
    }
    c.fillRect(0, 0, w, h);

    // Depth-zone ambient luminescence & seafloor ember aura
    if (!this.lowPower && this.active) {
      const bioFade = clamp((this.depth - 220) / 800, 0, 1);
      const midGlow = c.createRadialGradient(w * .5, h * .46, 20, w * .5, h * .46, Math.max(w, h) * .72);
      if (this.depth < 900) {
        midGlow.addColorStop(0, `rgba(75,222,244,${.07 + .04 * (1 - bioFade)})`);
        midGlow.addColorStop(1, 'rgba(75,222,244,0)');
      } else {
        const pulse = .055 + .025 * Math.sin(time * .9);
        midGlow.addColorStop(0, `rgba(75,222,244,${pulse * bioFade})`);
        midGlow.addColorStop(.52, `rgba(245,83,136,${pulse * .55 * bioFade})`);
        midGlow.addColorStop(1, 'rgba(8,25,44,0)');
      }
      c.fillStyle = midGlow;
      c.fillRect(0, Math.max(0, surface), w, h);

      if (this.depth > 3800) {
        const ventAlpha = clamp((this.depth - 3800) / 2400, 0, 1) * (.07 + .03 * Math.sin(time * 1.4));
        const vent = c.createLinearGradient(0, h * .55, 0, h);
        vent.addColorStop(0, 'rgba(255,150,90,0)');
        vent.addColorStop(1, `rgba(255,175,95,${ventAlpha})`);
        c.fillStyle = vent;
        c.fillRect(0, h * .55, w, h * .45);
      }
    }

    // Dual-layer animated sunlight & caustic beams near surface
    if (surface + RAY_DEPTH > 0) {
      const drift = this.lowPower || this.reducedMotion ? 0 : Math.sin(time * .25) * 14;
      c.drawImage(this.rays, -w * .08 - 14 + drift, surface - 10, w * 1.16 + 28, RAY_DEPTH + 10);
      if (!this.lowPower && !this.reducedMotion) {
        c.globalAlpha = .38;
        const drift2 = Math.cos(time * .19) * 18;
        c.drawImage(this.rays, -w * .05 - 10 + drift2, surface - 6, w * 1.1 + 20, RAY_DEPTH * .82);
        c.globalAlpha = 1;
      }
    }

    // Peripheral parallax stepped reef / trench cliff silhouettes (kept on outer edges)
    if (this.active && !this.lowPower && this.depth > 80) {
      const ridgeFade = clamp((this.depth - 80) / 360, 0, 1) * .36;
      c.fillStyle = `rgba(3,12,24,${ridgeFade})`;
      const span = h + 260;
      for (let i = 0; i < this.ridges.length; i++) {
        const rg = this.ridges[i];
        const py = wrap(i * 118 - this.scroll * (i % 3 === 0 ? .18 : .12), span) - 130;
        if (py > h + 40 || py + rg.h < Math.max(0, surface)) continue;
        const rw = rg.w * w;
        const rx = rg.side === 0 ? 0 : w - rw;
        c.fillRect(rx, py, rw, rg.h);
        c.fillRect(rg.side === 0 ? rw : rx - rg.step, py + 12, rg.step, rg.h - 24);
      }
    }

    const visibility = Math.max(.18, 1 - this.depth / 3600);

    // Shimmering specks & depth bioluminescent spores
    const bioFactor = clamp((this.depth - 320) / 900, 0, 1);
    const speckCount = this.lowPower ? 48 : this.specks.length;
    for (let i = 0; i < speckCount; i++) {
      const p = this.specks[i], span = h + 48;
      const y = wrap(p.y * span - this.scroll * .24 - time * (3 + this.diveIntensity * 28), span) - 24;
      if (y < surface - 2 || y > h) continue;
      if (p.bio && !this.lowPower && (bioFactor > .08 || this.diveIntensity > .2)) {
        const pulse = .55 + .45 * Math.sin(time * 2.4 + p.phase);
        const alpha = p.alpha * (bioFactor * .92 + this.diveIntensity * .5) * pulse;
        c.fillStyle = p.color;
        c.globalAlpha = Math.min(.78, alpha + .08);
        c.fillRect(p.x * w, y, p.r, p.r);
      } else {
        c.fillStyle = '#b7def6';
        c.globalAlpha = p.alpha * visibility * .72;
        c.fillRect(p.x * w, y, 1.25, 1.25);
      }
    }

    // Hydrodynamic velocity streaks during active dives
    if (this.diveIntensity > .04 && !this.reducedMotion && !this.lowPower) {
      const speedMul = .55 + this.diveIntensity * 1.45;
      const tint = this.diveTier === 'krillion' ? '255,227,135'
        : this.diveTier === 'deepcut' ? '245,83,136' : '116,232,248';
      c.lineWidth = 1.25;
      for (let i = 0; i < this.streaks.length; i++) {
        const st = this.streaks[i];
        const sy = wrap(st.y * (h + 120) - time * st.speed * h * speedMul - this.scroll * .55, h + 120) - 60;
        if (sy < surface + 10 || sy > h) continue;
        const sx = st.x * w;
        c.strokeStyle = `rgba(${tint},${(st.alpha * Math.min(1, this.diveIntensity * 1.3)).toFixed(3)})`;
        c.beginPath();
        c.moveTo(sx, sy);
        c.lineTo(sx, sy + st.len * (.4 + this.diveIntensity));
        c.stroke();
      }
    }

    // Expanding sonar / bioluminescent burst ring on dive launch & rare+ reveal
    if (this.burst && !this.reducedMotion) {
      const age = (time - this.burst.startedAt) / this.burst.duration;
      if (age >= 0 && age < 1) {
        const glowPrefix = TIER_GLOW[this.burst.tier] || 'rgba(75,222,244,';
        const maxR = Math.hypot(w, h) * .42;
        const cy = Math.max(surface + 60, h * .44);
        const rings = this.burst.tier === 'krillion' && !this.lowPower ? 2 : 1;
        for (let ri = 0; ri < rings; ri++) {
          const p = clamp((age - ri * .18) / (1 - ri * .18), 0, 1);
          if (p <= 0) continue;
          const r = Math.max(12, p * maxR);
          const alpha = (1 - p) * (1 - p) * (this.burst.tier === 'krillion' ? .36 : .24);
          c.strokeStyle = `${glowPrefix}${alpha.toFixed(3)})`;
          c.lineWidth = this.burst.tier === 'krillion' ? 2.4 : 1.6;
          c.beginPath();
          c.arc(w * .5, cy, r, 0, Math.PI * 2);
          c.stroke();
        }
      }
    }

    // Bubbles (accelerate naturally during dives)
    c.globalAlpha = visibility * (.38 + this.diveIntensity * .26);
    c.strokeStyle = '#bce5f8';
    c.lineWidth = .85;
    c.beginPath();
    const bubbleCount = this.lowPower ? 18 : this.bubbles.length;
    const bubbleBoost = 1 + this.diveIntensity * 3.2;
    for (let i = 0; i < bubbleCount; i++) {
      const b = this.bubbles[i], span = h + 70;
      const y = wrap(b.y * span - time * b.speed * h * bubbleBoost - this.scroll * .18, span) - 35;
      if (y < surface - 2 || y < -3 || y > h + 3) continue;
      const x = b.x * w + Math.sin(time * .7 + b.y * 11) * 3.5;
      c.moveTo(x + b.r, y);
      c.arc(x, y, b.r, 0, Math.PI * 2);
    }
    c.stroke();

    // Coordinated fish school (epipelagic / upper twilight)
    if (this.depth < 1450 && !this.lowPower) {
      const schoolFade = clamp(1 - (this.depth - 750) / 700, 0, 1);
      const sx = wrap(this.school.x + time * this.school.speed * this.school.direction, 1.2) * (w + 160) - 80;
      const span = h + 200;
      const sy = wrap(this.school.y * span - this.scroll * .34, span) - 100;
      if (sy > surface + 28 && sy < h - 20 && schoolFade > .02) {
        c.fillStyle = '#072a3d';
        c.globalAlpha = Math.max(.14, visibility * .55 * schoolFade);
        c.beginPath();
        for (const m of this.school.members) {
          const mx = sx + m.dx + Math.sin(time * 2 + m.phase) * 3;
          const my = sy + m.dy + Math.cos(time * 1.8 + m.phase) * 2.5;
          c.moveTo(mx + m.size * 1.4, my);
          c.ellipse(mx, my, m.size * 1.4, m.size * .48, 0, 0, Math.PI * 2);
        }
        c.fill();
      }
    }

    // Individual ambient fish silhouettes
    c.globalAlpha = Math.max(.16, visibility * .82);
    c.fillStyle = '#031522';
    c.beginPath();
    const fishCount = this.lowPower ? 8 : this.fish.length;
    for (let i = 0; i < fishCount; i++) {
      const f = this.fish[i];
      const x = wrap(f.x + time * f.speed * f.direction, 1) * (w + 64) - 32;
      const span = h + 180;
      const y = wrap(f.y * span - this.scroll * .40, span) - 90 + Math.sin(time * 1.6 + f.x * 12) * 3;
      if (y < surface + 20 || y < -12 || y > h + 12) continue;
      c.moveTo(x + f.size * 1.5, y);
      c.ellipse(x, y, f.size * 1.5, f.size * .55, 0, 0, Math.PI * 2);
      const tailX = x - f.direction * f.size * 2.3;
      c.moveTo(x - f.direction * f.size, y);
      c.lineTo(tailX, y + f.direction * f.size * .7);
      c.lineTo(tailX, y - f.direction * f.size * .7); c.closePath();
    }
    c.fill();

    // Majestic zone gliders (turtle, manta ray, whale, giant squid, anglerfish)
    if (!this.lowPower) {
      for (const g of this.gliders) {
        if (this.depth < g.minD - 120 || this.depth > g.maxD + 220) continue;
        const inFade = clamp((this.depth - g.minD + 120) / 220, 0, 1) * clamp((g.maxD + 220 - this.depth) / 280, 0, 1);
        const gx = wrap(g.x + time * g.speed * g.dir, 1.25) * (w + 240) - 120;
        const span = h + 280;
        const gy = wrap(g.y * span - this.scroll * .28, span) - 140 + Math.sin(time * .9 + g.x * 8) * 6;
        if (gy < surface + 32 || gy < -60 || gy > h + 60) continue;
        this.drawGlider(c, g, gx, gy, time, inFade);
      }
    }

    // Bioluminescent jellyfish emerging from mid-twilight depth (420m+)
    if (this.depth > 420 && !this.lowPower) {
      const jOpacity = clamp((this.depth - 420) / 520, 0, 1);
      for (const j of this.jellies) {
        const jx = w * j.x + Math.sin(time * .45 + j.phase) * 14;
        const jy = wrap(j.y * (h + 140) - time * j.speed * h - this.scroll * .22, h + 140) - 70;
        if (jy < surface + 18 || jy < -40 || jy > h + 40) continue;
        const pulse = .85 + .18 * Math.sin(time * 2.1 + j.phase);
        const rx = Math.max(2, j.size * pulse);
        const ry = Math.max(2, j.size * .68 * (2 - pulse * .8));
        c.globalAlpha = jOpacity;
        c.fillStyle = `rgba(${j.color},.14)`;
        c.strokeStyle = `rgba(${j.color},.28)`;
        c.lineWidth = 1.1;
        c.beginPath();
        c.ellipse(jx, jy, rx, ry, 0, Math.PI, Math.PI * 2);
        c.fill();
        c.stroke();
        c.strokeStyle = `rgba(${j.color},.16)`;
        for (let t = -1; t <= 1; t++) {
          const tx = jx + t * rx * .48;
          c.beginPath();
          c.moveTo(tx, jy);
          c.quadraticCurveTo(
            tx + Math.sin(time * 2.2 + j.phase + t) * 6,
            jy + j.size * 1.4,
            tx + Math.cos(time * 1.8 + j.phase + t) * 4,
            jy + j.size * 2.6
          );
          c.stroke();
        }
      }
    }

    // Crisp sunlight surface glints on shallow waves
    if (waveOnScreen && !this.lowPower) {
      c.globalAlpha = .42;
      c.strokeStyle = 'rgba(225,250,255,.55)';
      c.lineWidth = 1.6;
      c.beginPath();
      const step = Math.max(36, Math.floor(w / 22));
      for (let x = 18; x < w - 18; x += step) {
        const glintW = 8 + Math.sin(time * 1.9 + x * .05) * 6;
        if (glintW <= 4) continue;
        const y = waveY(x) + 1.5;
        c.moveTo(x - glintW, y);
        c.lineTo(x + glintW, y);
      }
      c.stroke();
    }

    c.globalAlpha = 1;
    if (waveOnScreen) c.restore();
  }
  drawGlider(c, g, x, y, time, fade) {
    c.save();
    c.translate(x, y);
    c.scale(g.dir * g.size, g.size);
    const bodyAlpha = clamp(fade * .28, 0, .28);
    c.globalAlpha = 1;
    c.fillStyle = `rgba(2,14,24,${bodyAlpha.toFixed(3)})`;
    if (g.kind === 'manta') {
      const wing = Math.sin(time * 2.2) * 8;
      c.beginPath();
      c.moveTo(22, 0);
      c.quadraticCurveTo(2, -22 + wing, -18, -4);
      c.lineTo(-42, 0);
      c.lineTo(-18, 4);
      c.quadraticCurveTo(2, 22 - wing, 22, 0);
      c.fill();
    } else if (g.kind === 'turtle') {
      const stroke = Math.sin(time * 2.8) * 5;
      c.beginPath();
      c.ellipse(0, 0, 15, 9, 0, 0, Math.PI * 2);
      c.ellipse(16, -1, 5, 4, 0, 0, Math.PI * 2);
      c.moveTo(5, -7); c.quadraticCurveTo(10, -21 + stroke, -2, -13);
      c.moveTo(5, 7); c.quadraticCurveTo(10, 21 - stroke, -2, 13);
      c.fill();
    } else if (g.kind === 'whale') {
      c.fillStyle = `rgba(3,17,29,${clamp(fade * .22, 0, .22).toFixed(3)})`;
      c.beginPath();
      c.moveTo(64, 2);
      c.quadraticCurveTo(42, -18, -28, -10);
      c.lineTo(-68, -22 + Math.sin(time * 1.1) * 5);
      c.lineTo(-54, 0);
      c.lineTo(-68, 16 + Math.sin(time * 1.1) * 5);
      c.lineTo(-28, 10);
      c.quadraticCurveTo(32, 18, 64, 2);
      c.fill();
    } else if (g.kind === 'squid') {
      c.fillStyle = `rgba(75,222,244,${clamp(fade * .14, 0, .14).toFixed(3)})`;
      c.beginPath();
      c.moveTo(30, 0);
      c.quadraticCurveTo(12, -10, -10, -6);
      c.lineTo(-10, 6);
      c.quadraticCurveTo(12, 10, 30, 0);
      c.fill();
      c.strokeStyle = `rgba(75,222,244,${clamp(fade * .18, 0, .18).toFixed(3)})`;
      c.lineWidth = 1.3;
      for (let i = -2; i <= 2; i++) {
        c.beginPath();
        c.moveTo(-10, i * 2);
        c.quadraticCurveTo(-24, i * 3 + Math.sin(time * 2.4 + i) * 4, -40, i * 2.5);
        c.stroke();
      }
    } else if (g.kind === 'angler') {
      c.fillStyle = `rgba(2,10,18,${clamp(fade * .36, 0, .36).toFixed(3)})`;
      c.beginPath();
      c.ellipse(0, 0, 14, 11, 0, 0, Math.PI * 2);
      c.moveTo(-12, 0); c.lineTo(-22, -7); c.lineTo(-22, 7); c.closePath();
      c.fill();
      c.strokeStyle = `rgba(255,227,135,${clamp(fade * .25, 0, .25).toFixed(3)})`;
      c.lineWidth = 1;
      c.beginPath(); c.moveTo(8, -8); c.quadraticCurveTo(22, -18, 26, -6 + Math.sin(time * 2.5) * 2); c.stroke();
      const pulse = .35 + .25 * Math.sin(time * 3.1);
      c.fillStyle = `rgba(255,227,135,${clamp(fade * pulse, 0, .6).toFixed(3)})`;
      c.beginPath(); c.arc(26, -6 + Math.sin(time * 2.5) * 2, 2.8, 0, Math.PI * 2); c.fill();
    }
    c.restore();
  }
  drawLabels(surface) {
    const { from, to } = visibleDepthRange(surface, this.height);
    const origin = Math.floor(from / 200) * 200;
    if (this.labelOrigin !== origin) {
      this.labelOrigin = origin;
      const end = to + 225;
      let ruler = '';
      for (let d = Math.max(0, origin - 25); d <= end; d += 25) {
        const major = d % 100 === 0;
        ruler += '<div class="ruler-mark' + (major ? ' major' : '') + '" style="top:' +
          (d - origin) * PIXELS_PER_METER + 'px">' +
          (major ? '<span>' + d.toLocaleString('en-US') + 'm</span>' : '') + '</div>';
      }
      this.rulerMarks.innerHTML = ruler;
      this.noteMarks.innerHTML = NOTES.map(([d, label], i) => d < origin - 25 || d > end ? '' :
        '<div class="world-note ' + (i % 2 ? 'left' : 'right') + '" style="top:' +
        (d - origin) * PIXELS_PER_METER + 'px">' + (i % 2 ? label + ' ──' : '── ' + label) + '</div>').join('');
    }
    const transform = 'translate3d(0,' + (surface + origin * PIXELS_PER_METER).toFixed(2) + 'px,0)';
    this.rulerMarks.style.transform = transform;
    this.noteMarks.style.transform = transform;
  }
  destroy() { cancelAnimationFrame(this.frameId); removeEventListener('resize', this.resize); }
}
