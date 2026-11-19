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
const RAY_DEPTH = 1050;
const RAYS = [
  [.05, .20, -.13, .26], [.22, .37, -.16, .20], [.44, .24, -.10, .24],
  [.60, .33, -.18, .13], [.82, .21, -.08, .21], [.94, .31, -.14, .19]
];
const wrap = (value, span) => ((value % span) + span) % span;

function sunlight(width) {
  const texture = document.createElement('canvas');
  texture.width = Math.min(960, Math.max(240, Math.ceil(width / 2)));
  texture.height = 480;
  const ctx = texture.getContext('2d');
  const { width: w, height: h } = texture;
  for (const [position, spread, angle, opacity] of RAYS) {
    ctx.save();
    ctx.translate(position * w, 0);
    ctx.rotate(angle * w / h);
    const halfWidth = spread * w / 2;
    const glow = ctx.createLinearGradient(-halfWidth, 0, halfWidth, 0);
    glow.addColorStop(0, 'rgba(177,235,244,0)');
    glow.addColorStop(.28, 'rgba(177,235,244,' + opacity * .42 + ')');
    glow.addColorStop(.54, 'rgba(177,235,244,' + opacity + ')');
    glow.addColorStop(.78, 'rgba(177,235,244,' + opacity * .42 + ')');
    glow.addColorStop(1, 'rgba(177,235,244,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(-halfWidth, -h, halfWidth * 2, h * 3);
    ctx.restore();
  }
  ctx.globalCompositeOperation = 'destination-in';
  const fade = ctx.createLinearGradient(0, 0, 0, h);
  fade.addColorStop(0, '#000');
  fade.addColorStop(.3, '#000a');
  fade.addColorStop(.68, '#0003');
  fade.addColorStop(1, '#0000');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, w, h);
  return texture;
}

export class OceanScene {
  constructor(onFrame) {
    this.canvas = document.getElementById('life');
    this.ctx = this.canvas.getContext('2d');
    this.ruler = document.getElementById('depth-ruler');
    this.notes = document.getElementById('world-notes');
    this.floor = document.getElementById('seafloor');
    this.rulerMarks = this.ruler.appendChild(document.createElement('div'));
    this.noteMarks = this.notes.appendChild(document.createElement('div'));
    this.onFrame = onFrame;
    this.depth = 0; this.target = 0; this.active = false; this.lowPower = false; this.dive = null;
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.fish = Array.from({length: 24}, (_, i) => ({
      x: Math.random(), y: .12 + Math.random() * .8, size: 3 + Math.random() * 5,
      speed: .002 + Math.random() * .007, direction: i % 2 ? 1 : -1
    }));
    this.bubbles = Array.from({length: 62}, () => ({x: Math.random(), y: Math.random(), r: .6 + Math.random() * 1.8, speed: .008 + Math.random() * .025}));
    this.specks = Array.from({length: 155}, () => ({x: Math.random(), y: Math.random(), alpha: .12 + Math.random() * .3}));
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
  set(depth, active, lowPower = false, immediate = false) {
    const landed = this.dive !== null;
    this.dive = null;
    this.target = depth; this.active = active; this.setQuality(lowPower);
    if (immediate || landed || this.reducedMotion) this.depth = depth;
  }
  setDescent(fromDepth, toDepth, startedAt, endsAt, lowPower = false) {
    this.dive = { fromDepth, toDepth, startedAt, endsAt };
    this.target = toDepth; this.active = true; this.setQuality(lowPower);
    this.depth = descentFrame({ ...this.dive, now: Date.now(), height: this.height,
      reducedMotion: this.reducedMotion }).depth;
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
      } else {
        const difference = this.target - this.depth;
        this.depth = Math.abs(difference) < .2 ? this.target : this.depth + difference * (1 - Math.exp(-Math.max(0, delta) / 205));
      }
      const surface = diveFrame ? diveFrame.surface : this.active
        ? h * .21 - Math.max(0, this.depth * PIXELS_PER_METER - h * .19)
        : h * .60;
      this.scroll = this.active ? Math.max(0, h * .21 - surface) : 0;
      if (this.dirty || surface !== this.surface) this.drawLabels(surface);
      this.surface = surface;
      if (!this.reducedMotion) this.effectsTime += Math.min(50, Math.max(0, delta)) / 1000;
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
    if (waveOnScreen) {
      c.clearRect(0, 0, w, h);
      c.save();
      c.beginPath();
      const waveY = x => surface + Math.sin(x * .021 + time * 1.05) * 3.5 + Math.sin(x * .008 - time * .82) * 4;
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
    if (surface + RAY_DEPTH > 0) {
      const drift = this.lowPower ? 0 : Math.sin(time * .23) * 12;
      c.drawImage(this.rays, -w * .08 - 12 + drift, surface - 10, w * 1.16 + 24, RAY_DEPTH + 10);
    }
    const visibility = Math.max(.15, 1 - this.depth / 3500);
    c.fillStyle = '#b7def6';
    const speckCount = this.lowPower ? 42 : this.specks.length;
    for (let i = 0; i < speckCount; i++) {
      const p = this.specks[i], span = h + 48;
      const y = wrap(p.y * span - this.scroll * .24 - time * 3, span) - 24;
      if (y < surface - 2 || y > h) continue;
      c.globalAlpha = p.alpha * visibility * .72;
      c.fillRect(p.x * w, y, 1.2, 1.2);
    }
    c.globalAlpha = visibility * .38;
    c.strokeStyle = '#bce5f8';
    c.lineWidth = .8;
    c.beginPath();
    const bubbleCount = this.lowPower ? 15 : this.bubbles.length;
    for (let i = 0; i < bubbleCount; i++) {
      const b = this.bubbles[i], span = h + 70;
      const y = wrap(b.y * span - time * b.speed * h - this.scroll * .18, span) - 35;
      if (y < surface - 2 || y < -3 || y > h + 3) continue;
      const x = b.x * w + Math.sin(time * .7 + b.y * 11) * 3;
      c.moveTo(x + b.r, y);
      c.arc(x, y, b.r, 0, Math.PI * 2);
    }
    c.stroke();
    c.globalAlpha = Math.max(.16, visibility * .82);
    c.fillStyle = '#031522';
    c.beginPath();
    const fishCount = this.lowPower ? 7 : this.fish.length;
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
    if (this.depth > 1200 && !this.lowPower) {
      c.globalAlpha = Math.min(1, (this.depth - 1200) / 450);
      for (let i = 0; i < 5; i++) {
        const x = w * ((i * .23 + .1) % 1), y = h * ((i * .19 + time * .004) % 1);
        c.fillStyle = 'rgba(95,188,220,.08)';
        c.beginPath(); c.ellipse(x, y, 10, 7, 0, Math.PI, Math.PI * 2); c.fill();
        c.strokeStyle = 'rgba(95,188,220,.12)';
        for (let j = -1; j <= 1; j++) {c.beginPath(); c.moveTo(x + j * 5, y); c.quadraticCurveTo(x + j * 7 + Math.sin(time) * 4, y + 14, x + j * 4, y + 27); c.stroke();}
      }
    }
    c.globalAlpha = 1;
    if (waveOnScreen) c.restore();
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
