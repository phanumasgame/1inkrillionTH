import { descentFrame, visibleDepthRange, PIXELS_PER_METER } from './descent.js';

const NOTES = [
  [60, 'light begins to fade'], [200, 'most sunlight stops here'], [332, 'deepest scuba dive — 332m'],
  [535, 'emperor penguins dive this deep'], [800, 'giant oarfish & twilight hunters'],
  [1000, 'THE MIDNIGHT ZONE'], [1450, 'bioluminescent lanternfish swarms'],
  [1800, 'giant squid territory'], [2250, 'sperm whale deepest dive — 2,250m'],
  [2500, '2°C. utterly black.'], [3000, 'THE ABYSSAL ZONE'],
  [3800, 'the Titanic rests here — 3,800m'], [4500, 'hydrothermal black smokers'],
  [5200, 'THE HADAL ZONE'], [6100, 'golden krillion & abyssal aurora'],
  [7000, 'the trench floor — a perfect dive']
];
const WATER_PALETTES = {
  classic: [
    [0, '#267a9e'], [120, '#206a91'], [400, '#185776'], [980, '#113e5c'],
    [2100, '#0b273e'], [4300, '#08192c'], [9000, '#050d1a'], [14800, '#030812']
  ],
  entertainment: [
    [0, '#27598f'], [120, '#22477d'], [400, '#1e3269'], [980, '#241e59'],
    [2100, '#1a1442'], [4300, '#120d2e'], [9000, '#09061a'], [14800, '#050410']
  ],
  geography: [
    [0, '#1d767a'], [120, '#18646a'], [400, '#14525a'], [980, '#0f3d47'],
    [2100, '#0a2a33'], [4300, '#071c24'], [9000, '#040f16'], [14800, '#02080d']
  ],
  nature: [
    [0, '#1e7b6b'], [120, '#19695e'], [400, '#13564e'], [980, '#0d403d'],
    [2100, '#092c2b'], [4300, '#061d1e'], [9000, '#031012'], [14800, '#02090b']
  ],
  lifestyle: [
    [0, '#2b778b'], [120, '#236378'], [400, '#1b4f64'], [980, '#133b4f'],
    [2100, '#0c2738'], [4300, '#081926'], [9000, '#050e17'], [14800, '#03080e']
  ],
  football: [
    [0, '#1b6d62'], [120, '#165a55'], [400, '#114749'], [980, '#0c343c'],
    [2100, '#08232d'], [4300, '#051721'], [9000, '#030d15'], [14800, '#02070c']
  ],
};
const THEME_GLOW_COLORS = {
  classic: '75,222,244',
  entertainment: '245,83,136',
  geography: '96,232,212',
  nature: '104,231,180',
  lifestyle: '255,212,122',
  football: '98,235,148',
};
function isLoyKrathongSeason() {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bangkok', month: 'numeric', day: 'numeric' }).formatToParts(new Date());
    const m = Number(parts.find(p => p.type === 'month')?.value || 0);
    const d = Number(parts.find(p => p.type === 'day')?.value || 0);
    return m === 11 && d >= 22 && d <= 30;
  } catch {
    return true;
  }
}
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
    this.diveIntensity = 0; this.diveTier = ''; this.burst = null; this.groupTheme = 'classic';
    this.cachedGradient = null; this.cachedGradientSurface = NaN; this.cachedGradientTheme = '';
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
      { kind: 'turtle', minD: 0, maxD: 820, x: .76, y: .25, speed: .0055, dir: -1, size: .92 },
      { kind: 'manta', minD: 30, maxD: 1500, x: .18, y: .40, speed: .0075, dir: 1, size: 1.08 },
      { kind: 'hammerhead', minD: 240, maxD: 1950, x: .64, y: .48, speed: .0082, dir: -1, size: 1.0 },
      { kind: 'whale', minD: 350, maxD: 3200, x: .12, y: .58, speed: .0036, dir: 1, size: 1.28 },
      { kind: 'oarfish', minD: 680, maxD: 3900, x: .45, y: .36, speed: .0052, dir: 1, size: 1.05 },
      { kind: 'squid', minD: 1150, maxD: 6500, x: .82, y: .52, speed: .0048, dir: -1, size: 1.05 },
      { kind: 'angler', minD: 1900, maxD: 8500, x: .24, y: .66, speed: .0032, dir: 1, size: .98 },
      { kind: 'dumbo', minD: 2600, maxD: 8500, x: .72, y: .38, speed: .0038, dir: -1, size: .95 },
      { kind: 'leviathan', minD: 4100, maxD: 9500, x: .32, y: .74, speed: .0042, dir: 1, size: 1.15 },
    ];
    this.krathongs = [
      { x: .11, speed: .0042, scale: .88, petal: '#ff8ec6', leaf: '#39a85e', phase: .2 },
      { x: .26, speed: .0035, scale: 1.02, petal: '#ffd86b', leaf: '#42b868', phase: 1.7 },
      { x: .41, speed: .0031, scale: .78, petal: '#ffa4d2', leaf: '#339954', phase: 2.9 },
      { x: .72, speed: .0039, scale: .96, petal: '#ff7fb8', leaf: '#3fae63', phase: 4.1 },
      { x: .86, speed: .0033, scale: .84, petal: '#ffe07a', leaf: '#45bc6b', phase: 5.3 },
    ];
    this.kelp = Array.from({ length: 12 }, (_, i) => ({
      side: i % 2, y: (i * .11) % 1, len: 42 + (i % 4) * 16, phase: i * .9
    }));
    this.lanterns = Array.from({ length: 18 }, (_, i) => ({
      dx: ((i % 6) * 22 - 55) + (i % 3) * 5,
      dy: (Math.floor(i / 6) * 18 - 18) + (i % 2) * 7,
      phase: i * .75, color: i % 3 === 0 ? '#ffe387' : '#4bdef4'
    }));
    this.ventPlumes = Array.from({ length: 38 }, (_, i) => ({
      side: i % 2, offset: .02 + ((i * .031) % .14), y: (i * .13) % 1,
      r: 1.4 + (i % 4) * .8, speed: .035 + (i % 5) * .012, phase: i * .8
    }));
    this.krillSwarm = Array.from({ length: 28 }, (_, i) => ({
      angle: (i / 28) * Math.PI * 2, radius: 26 + (i % 5) * 22,
      speed: .45 + (i % 4) * .15, size: 1.8 + (i % 3) * .7, phase: i * .5
    }));
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
  setGroupTheme(groupId = 'classic') {
    const next = WATER_PALETTES[groupId] ? groupId : 'classic';
    if (this.groupTheme === next) return;
    this.groupTheme = next;
    this.cachedGradient = null;
    this.dirty = true;
    if (this.world) this.world.dataset.pack = next;
    document.body?.setAttribute('data-pack', next);
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
    if (document.hidden && !this.dive && !this.dirty) {
      this.frameId = requestAnimationFrame(this.frame);
      return;
    }
    const idleRate = this.lowPower ? 1000 / 18 : 1000 / 32;
    const rate = this.dive ? 0 : idleRate;
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
    if (!this.cachedGradient || this.cachedGradientTheme !== this.groupTheme || Math.abs(this.cachedGradientSurface - surface) > 2) {
      const palette = WATER_PALETTES[this.groupTheme] || WATER_PALETTES.classic;
      const water = c.createLinearGradient(0, surface, 0, surface + 14800);
      for (const [distance, color] of palette) water.addColorStop(distance / 14800, color);
      this.cachedGradient = water;
      this.cachedGradientSurface = surface;
      this.cachedGradientTheme = this.groupTheme;
    }
    c.fillStyle = this.cachedGradient;
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

    // Theme-specific underwater ambient luminescence & background art layer
    if (!this.lowPower) {
      const themeRgb = THEME_GLOW_COLORS[this.groupTheme] || THEME_GLOW_COLORS.classic;
      if (this.active) {
        const bioFade = clamp((this.depth - 220) / 800, 0, 1);
        const midGlow = c.createRadialGradient(w * .5, h * .46, 20, w * .5, h * .46, Math.max(w, h) * .72);
        if (this.depth < 900) {
          midGlow.addColorStop(0, `rgba(${themeRgb},${.08 + .04 * (1 - bioFade)})`);
          midGlow.addColorStop(1, `rgba(${themeRgb},0)`);
        } else {
          const pulse = .055 + .025 * Math.sin(time * .9);
          midGlow.addColorStop(0, `rgba(${themeRgb},${pulse * bioFade})`);
          midGlow.addColorStop(.52, `rgba(245,83,136,${pulse * .5 * bioFade})`);
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
      this.drawGroupThemeArt(c, w, h, time, surface);
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

    // Shallow Zone (0m–950m): Swaying kelp & coral reef strands on outer edges
    if (this.active && !this.lowPower && this.depth < 980) {
      const kelpFade = clamp(1 - (this.depth - 520) / 460, 0, 1) * .32;
      if (kelpFade > .02) {
        c.strokeStyle = `rgba(9,48,68,${kelpFade.toFixed(3)})`;
        c.lineWidth = 3.2;
        const span = h + 180;
        for (let i = 0; i < this.kelp.length; i++) {
          const k = this.kelp[i];
          const ky = wrap(k.y * span - this.scroll * .26, span) - 90;
          if (ky < surface + 35 || ky > h + 40) continue;
          const kx = k.side === 0 ? 12 + (i % 3) * 8 : w - 12 - (i % 3) * 8;
          const dir = k.side === 0 ? 1 : -1;
          const sway = Math.sin(time * 1.4 + k.phase) * 10 * dir;
          c.beginPath();
          c.moveTo(kx, ky + k.len);
          c.quadraticCurveTo(kx + sway, ky + k.len * .5, kx + sway * 1.3, ky);
          c.stroke();
        }
      }
    }

    // Midnight Zone (900m–4600m): Bioluminescent lanternfish school with glowing photophores
    if (this.active && !this.lowPower && this.depth > 850 && this.depth < 4700) {
      const lFade = clamp((this.depth - 850) / 380, 0, 1) * clamp((4700 - this.depth) / 500, 0, 1);
      const lx = wrap(.68 - time * .0065, 1.25) * (w + 180) - 90;
      const span = h + 220;
      const ly = wrap(.48 * span - this.scroll * .31, span) - 110;
      if (ly > surface + 28 && ly < h - 16 && lFade > .03) {
        for (const m of this.lanterns) {
          const mx = lx + m.dx + Math.sin(time * 2.3 + m.phase) * 4;
          const my = ly + m.dy + Math.cos(time * 1.9 + m.phase) * 3;
          c.globalAlpha = lFade * .42;
          c.fillStyle = '#061f33';
          c.beginPath();
          c.ellipse(mx, my, 4.2, 1.7, 0, 0, Math.PI * 2);
          c.fill();
          const glow = .45 + .55 * Math.sin(time * 3.8 + m.phase);
          c.globalAlpha = lFade * glow * .82;
          c.fillStyle = m.color;
          c.fillRect(mx - 1.5, my - .6, 1.5, 1.5);
          c.fillRect(mx + .8, my - .4, 1.3, 1.3);
        }
      }
    }

    // Abyssal Zone (2600m–5400m): Ghostly sunken shipwreck / ancient pillar silhouette on trench wall
    if (this.active && !this.lowPower && this.depth > 2500 && this.depth < 5400) {
      const wFade = clamp((this.depth - 2500) / 450, 0, 1) * clamp((5400 - this.depth) / 550, 0, 1) * .26;
      const span = h + 460;
      const wy = wrap(240 - this.scroll * .16, span) - 180;
      if (wy > surface + 20 && wy < h + 80 && wFade > .02) {
        c.globalAlpha = 1;
        c.fillStyle = `rgba(4,16,30,${wFade.toFixed(3)})`;
        c.beginPath();
        c.moveTo(w - 92, wy + 52);
        c.lineTo(w - 18, wy + 24);
        c.lineTo(w, wy + 28);
        c.lineTo(w, wy + 82);
        c.lineTo(w - 78, wy + 82);
        c.closePath();
        c.fill();
        // Ship mast & crow's nest silhouette
        c.strokeStyle = `rgba(75,222,244,${(wFade * .45).toFixed(3)})`;
        c.lineWidth = 1.4;
        c.beginPath();
        c.moveTo(w - 54, wy + 38); c.lineTo(w - 62, wy - 8);
        c.moveTo(w - 74, wy + 6); c.lineTo(w - 46, wy + 2);
        c.stroke();
      }
    }

    // Deep Abyssal & Hadal Zone (3400m+): Hydrothermal vents & rising mineral ember plumes
    if (this.active && !this.lowPower && this.depth > 3400) {
      const vFade = clamp((this.depth - 3400) / 700, 0, 1);
      for (const vp of this.ventPlumes) {
        const vx = (vp.side === 0 ? vp.offset : 1 - vp.offset) * w + Math.sin(time * 1.6 + vp.phase) * 7;
        const vy = wrap(vp.y * (h + 90) - time * vp.speed * h - this.scroll * .25, h + 90) - 45;
        if (vy < surface + 15 || vy > h) continue;
        const pulse = .45 + .55 * Math.sin(time * 2.8 + vp.phase);
        c.globalAlpha = vFade * pulse * .58;
        c.fillStyle = vp.phase % 2 > 1 ? '#ffe387' : '#ff9a5a';
        c.beginPath();
        c.arc(vx, vy, vp.r, 0, Math.PI * 2);
        c.fill();
      }
    }

    // Hadal Krillion Trench (4800m+): Abyssal bioluminescent aurora curtains & Golden Krillion vortex
    if (this.active && !this.lowPower && this.depth > 4800) {
      const hFade = clamp((this.depth - 4800) / 900, 0, 1);
      c.save();
      for (let band = 0; band < 3; band++) {
        const ay = h * (.28 + band * .22) + Math.sin(time * .55 + band * 1.7) * 24;
        const grad = c.createLinearGradient(0, ay - 45, w, ay + 45);
        const col = band === 0 ? '75,222,244' : band === 1 ? '245,83,136' : '255,227,135';
        grad.addColorStop(0, `rgba(${col},0)`);
        grad.addColorStop(.5, `rgba(${col},${(hFade * .075).toFixed(3)})`);
        grad.addColorStop(1, `rgba(${col},0)`);
        c.fillStyle = grad;
        c.fillRect(0, ay - 50, w, 100);
      }
      // Swirling Golden Krillion constellation
      const cx = w * .5 + Math.sin(time * .35) * (w * .18);
      const cy = h * .52 + Math.cos(time * .28) * (h * .12);
      for (const k of this.krillSwarm) {
        const ang = k.angle + time * k.speed;
        const kx = cx + Math.cos(ang) * (k.radius * 1.45);
        const ky = cy + Math.sin(ang * 1.2) * (k.radius * .75);
        if (ky < surface + 20) continue;
        const glow = .4 + .6 * Math.sin(time * 3.4 + k.phase);
        c.globalAlpha = hFade * glow * .76;
        c.fillStyle = '#ffe387';
        c.beginPath();
        c.ellipse(kx, ky, k.size * 1.4, k.size * .6, ang, 0, Math.PI * 2);
        c.fill();
      }
      c.restore();
    }

    // Majestic zone gliders (turtle, manta, hammerhead, whale, oarfish, giant squid, anglerfish, dumbo, leviathan)
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

    // Loy Krathong floating lotus lanterns on landing water surface (Nov 22-30 Bangkok time)
    if (!this.active && waveOnScreen && !this.lowPower && isLoyKrathongSeason()) {
      this.drawLoyKrathongs(c, w, time, waveY);
    }
  }
  drawLoyKrathongs(c, w, time, waveY) {
    c.save();
    for (const k of this.krathongs) {
      const kx = wrap(k.x + time * k.speed, 1.08) * (w + 90) - 45;
      const ky = waveY(kx) - 1;
      const slope = Math.atan2(waveY(kx + 6) - waveY(kx - 6), 12) * .75;
      const flicker = .82 + .18 * Math.sin(time * 8.5 + k.phase * 3);
      const s = k.scale;

      c.save();
      c.translate(kx, ky);
      c.rotate(slope);
      c.scale(s, s);

      // Warm candle reflection shimmer in shallow water beneath the krathong
      const refAlpha = (.18 * flicker).toFixed(3);
      c.fillStyle = `rgba(255,220,120,${refAlpha})`;
      c.fillRect(-10, 4, 20, 2);
      c.fillStyle = `rgba(255,190,90,${(.11 * flicker).toFixed(3)})`;
      c.fillRect(-6, 8, 12, 2);

      // Banana leaf cup base (krathong body)
      c.fillStyle = '#185432';
      c.fillRect(-13, -3, 26, 5);
      c.fillStyle = k.leaf;
      c.fillRect(-14, -6, 28, 4);
      // Folded triangular leaf peaks (กลีบกระทง)
      for (let bx = -12; bx <= 10; bx += 5) {
        c.fillStyle = '#5ee088';
        c.fillRect(bx, -9, 3, 3);
      }

      // Lotus/marigold flower trim + incense sticks
      c.fillStyle = k.petal;
      c.fillRect(-10, -8, 20, 3);
      c.fillStyle = '#fff3b8';
      c.fillRect(-4, -9, 8, 2);

      // Three incense sticks
      c.fillStyle = '#8b5e3c';
      c.fillRect(-5, -18, 1, 9);
      c.fillRect(-1, -19, 1, 10);
      c.fillRect(4, -18, 1, 9);
      c.fillStyle = '#ff6a4d';
      c.fillRect(-5, -19, 1, 1);
      c.fillRect(-1, -20, 1, 1);
      c.fillRect(4, -19, 1, 1);

      // Golden candle & warm radial glow halo
      c.fillStyle = '#ffe074';
      c.fillRect(0, -15, 3, 7);
      const glow = c.createRadialGradient(1.5, -19, 1, 1.5, -19, 16 * flicker);
      glow.addColorStop(0, `rgba(255,244,168,${(.55 * flicker).toFixed(3)})`);
      glow.addColorStop(.5, `rgba(255,176,72,${(.22 * flicker).toFixed(3)})`);
      glow.addColorStop(1, 'rgba(255,160,60,0)');
      c.fillStyle = glow;
      c.beginPath();
      c.arc(1.5, -19, 16 * flicker, 0, Math.PI * 2);
      c.fill();

      // Pixel flame core
      c.fillStyle = '#ff9d3b';
      c.fillRect(0, -20, 3, 5);
      c.fillStyle = '#fff9c9';
      c.fillRect(1, -21, 1.5, 4);

      c.restore();
    }
    c.restore();
  }
  drawGroupThemeArt(c, w, h, time, surface) {
    if (this.groupTheme === 'classic') return;
    c.save();
    const topClip = Math.max(0, surface + 6);
    if (this.groupTheme === 'entertainment') {
      // Underwater Neon Coral Stage spotlights & floating pixel starlight
      for (let i = 0; i < 3; i++) {
        const sx = w * (.2 + i * .3) + Math.sin(time * .4 + i * 1.8) * 28;
        const beam = c.createLinearGradient(sx, topClip, sx + (i - 1) * 90, h);
        const col = i === 1 ? '245,83,136' : '122,216,255';
        beam.addColorStop(0, `rgba(${col},.11)`);
        beam.addColorStop(1, `rgba(${col},0)`);
        c.fillStyle = beam;
        c.beginPath();
        c.moveTo(sx - 22, topClip);
        c.lineTo(sx + 22, topClip);
        c.lineTo(sx + (i - 1) * 90 + 130, h);
        c.lineTo(sx + (i - 1) * 90 - 130, h);
        c.closePath();
        c.fill();
      }
      for (let i = 0; i < 14; i++) {
        const px = ((i * 193 + 70) % w);
        const py = wrap(((i * 131) % h) - this.scroll * .22 - time * 8, h - topClip) + topClip;
        const tw = .22 + .32 * Math.abs(Math.sin(time * 2.2 + i));
        c.fillStyle = i % 2 ? `rgba(255,227,135,${tw})` : `rgba(245,83,136,${tw})`;
        c.fillRect(px - 3, py - 1, 6, 2);
        c.fillRect(px - 1, py - 3, 2, 6);
      }
    } else if (this.groupTheme === 'geography') {
      // Sunken Atlas Ruins, sunken classical pillars & subtle latitude/compass sonar rings
      c.strokeStyle = 'rgba(104,231,207,.10)';
      c.lineWidth = 1;
      const cx = w * .5, cy = Math.max(topClip + 120, h * .48);
      for (const r of [140, 240, 340]) {
        c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.stroke();
      }
      // Subtle cardinal compass crosshair ticks
      const rot = time * .06;
      c.beginPath();
      for (let k = 0; k < 4; k++) {
        const a = rot + k * Math.PI * .5;
        c.moveTo(cx + Math.cos(a) * 125, cy + Math.sin(a) * 125);
        c.lineTo(cx + Math.cos(a) * 155, cy + Math.sin(a) * 155);
      }
      c.stroke();
      // Sunken ruined colonnade silhouette on outer edges when diving
      if (this.active) {
        c.fillStyle = 'rgba(4,22,28,.34)';
        for (let i = 0; i < 4; i++) {
          const py = wrap(210 + i * 240 - this.scroll * .16, h + 260) - 100;
          if (py < topClip || py > h) continue;
          const leftSide = i % 2 === 0;
          const x = leftSide ? 18 : w - 42;
          c.fillRect(x, py, 24, 92);
          c.fillRect(x - 5, py, 34, 8);
          c.fillRect(x - 5, py + 84, 34, 8);
        }
      }
    } else if (this.groupTheme === 'nature') {
      // Extra tall emerald kelp fronds swaying along margins + golden spore shafts
      c.strokeStyle = 'rgba(72,218,168,.18)';
      c.lineWidth = 3.5;
      for (let i = 0; i < 10; i++) {
        const left = i % 2 === 0;
        const kx = left ? 16 + (i % 3) * 12 : w - 16 - (i % 3) * 12;
        const ky = wrap(i * 115 - this.scroll * .25, h + 160) - 60;
        if (ky < topClip || ky > h + 50) continue;
        const sway = Math.sin(time * 1.2 + i) * 13 * (left ? 1 : -1);
        c.beginPath();
        c.moveTo(kx, ky + 75);
        c.quadraticCurveTo(kx + sway, ky + 38, kx + sway * 1.2, ky);
        c.stroke();
      }
    } else if (this.groupTheme === 'lifestyle') {
      // Warm Golden Harbor Lantern Buoys & coral reef warm bubbles
      for (let i = 0; i < 6; i++) {
        const left = i % 2 === 0;
        const lx = left ? w * .08 : w * .92;
        const ly = wrap(90 + i * 165 - this.scroll * .2, h + 180) - 60;
        if (ly < topClip + 12 || ly > h) continue;
        const pulse = .24 + .18 * Math.sin(time * 2.1 + i * 1.3);
        c.strokeStyle = 'rgba(255,212,122,.16)';
        c.lineWidth = 1;
        c.beginPath(); c.moveTo(lx, Math.max(topClip, ly - 50)); c.lineTo(lx, ly); c.stroke();
        c.fillStyle = `rgba(255,215,120,${pulse})`;
        c.beginPath(); c.arc(lx, ly, 4.5, 0, Math.PI * 2); c.fill();
      }
    } else if (this.groupTheme === 'football') {
      // Sunken Stadium Floodlight Beams & Glowing Pitch Markings
      for (const side of [-1, 1]) {
        const fx = side < 0 ? w * .12 : w * .88;
        const beam = c.createLinearGradient(fx, topClip, w * .5, h * .85);
        beam.addColorStop(0, 'rgba(130,245,175,.11)');
        beam.addColorStop(1, 'rgba(130,245,175,0)');
        c.fillStyle = beam;
        c.beginPath();
        c.moveTo(fx - 18, topClip);
        c.lineTo(fx + 18, topClip);
        c.lineTo(w * .5 + side * -120, h);
        c.lineTo(w * .5 + side * 200, h);
        c.closePath();
        c.fill();
      }
      c.strokeStyle = 'rgba(110,235,160,.11)';
      c.lineWidth = 1.4;
      const cy = Math.max(topClip + 120, h * .54);
      c.beginPath();
      c.arc(w * .5, cy, 86, 0, Math.PI * 2);
      c.moveTo(w * .14, cy);
      c.lineTo(w * .86, cy);
      c.stroke();
    }
    c.restore();
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
    } else if (g.kind === 'hammerhead') {
      const sway = Math.sin(time * 2.6) * 4;
      c.beginPath();
      c.moveTo(28, 0);
      c.quadraticCurveTo(10, -7, -26, -2 + sway * .3);
      c.lineTo(-38, -11 + sway);
      c.lineTo(-33, 0);
      c.lineTo(-38, 10 + sway);
      c.lineTo(-26, 2 + sway * .3);
      c.quadraticCurveTo(10, 7, 28, 0);
      c.moveTo(4, -5); c.lineTo(-4, -17); c.lineTo(-9, -5);
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
    } else if (g.kind === 'oarfish') {
      // Ribbon-like sinusoidal giant oarfish (พญานาคทะเล) with glowing crimson-pink crest
      c.strokeStyle = `rgba(122,243,216,${clamp(fade * .24, 0, .24).toFixed(3)})`;
      c.lineWidth = 3.2;
      c.beginPath();
      for (let seg = 0; seg <= 14; seg++) {
        const sx = 32 - seg * 5.2;
        const sy = Math.sin(time * 3.1 - seg * .55) * (2.5 + seg * .35);
        if (seg === 0) c.moveTo(sx, sy);
        else c.lineTo(sx, sy);
      }
      c.stroke();
      c.strokeStyle = `rgba(245,83,136,${clamp(fade * .34, 0, .34).toFixed(3)})`;
      c.lineWidth = 1.6;
      c.beginPath();
      c.moveTo(32, -2); c.lineTo(39, -11 + Math.sin(time * 3.1) * 2);
      c.moveTo(30, -2); c.lineTo(35, -13 + Math.cos(time * 3.1) * 2);
      c.stroke();
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
    } else if (g.kind === 'dumbo') {
      // Deep-sea Dumbo octopus with ear-like fins and soft magenta-violet glow
      const ear = Math.sin(time * 2.9) * 3.5;
      c.fillStyle = `rgba(245,181,255,${clamp(fade * .18, 0, .18).toFixed(3)})`;
      c.beginPath();
      c.ellipse(0, 0, 9, 11, 0, Math.PI, Math.PI * 2);
      c.arc(0, 2, 9, 0, Math.PI);
      c.moveTo(-7, -6); c.quadraticCurveTo(-15, -12 + ear, -8, -2);
      c.moveTo(7, -6); c.quadraticCurveTo(15, -12 - ear, 8, -2);
      c.fill();
    } else if (g.kind === 'leviathan') {
      // Hadal bioluminescent dragonfish / gulper leviathan with glowing lateral photophores
      c.strokeStyle = `rgba(75,222,244,${clamp(fade * .22, 0, .22).toFixed(3)})`;
      c.lineWidth = 3.6;
      c.beginPath();
      for (let seg = 0; seg <= 16; seg++) {
        const sx = 38 - seg * 5.5;
        const sy = Math.sin(time * 2.4 - seg * .48) * (3 + seg * .3);
        if (seg === 0) c.moveTo(sx, sy);
        else c.lineTo(sx, sy);
      }
      c.stroke();
      c.fillStyle = `rgba(255,227,135,${clamp(fade * .55, 0, .55).toFixed(3)})`;
      for (let seg = 1; seg <= 12; seg += 2) {
        const sx = 38 - seg * 5.5;
        const sy = Math.sin(time * 2.4 - seg * .48) * (3 + seg * .3);
        c.fillRect(sx - 1, sy - 1, 2, 2);
      }
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
