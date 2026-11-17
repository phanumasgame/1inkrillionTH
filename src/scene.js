import { descentFrame, visibleDepthRange, PIXELS_PER_METER } from './descent.js';

const NOTES = [
  [60, 'light begins to fade'], [200, 'most sunlight stops here'], [332, 'deepest scuba dive — 332m'],
  [535, 'emperor penguins dive this deep'], [1000, 'THE MIDNIGHT ZONE'],
  [1800, 'giant squid territory'], [2500, '2°C. utterly black.'],
  [3000, 'THE ABYSSAL ZONE'], [3800, 'the Titanic rests here — 3,800m'],
  [5200, 'THE HADAL ZONE'], [7000, 'the trench floor — a perfect dive']
];
export class OceanScene {
  constructor(onFrame) {
    this.canvas = document.getElementById('life');
    this.ctx = this.canvas.getContext('2d');
    this.ruler = document.getElementById('depth-ruler');
    this.notes = document.getElementById('world-notes');
    this.root = document.documentElement;
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
      this.width = innerWidth; this.height = innerHeight;
      const scale = Math.min(devicePixelRatio || 1, 2);
      this.canvas.width = this.width * scale; this.canvas.height = this.height * scale;
      this.ctx.setTransform(scale, 0, 0, scale, 0, 0);
    };
    addEventListener('resize', this.resize);
    this.resize();
    this.previous = performance.now(); this.lastPaint = 0; this.lastLabels = 0;
    this.frame = this.frame.bind(this);
    this.frameId = requestAnimationFrame(this.frame);
  }
  set(depth, active, lowPower = false, immediate = false) {
    const landed = this.dive !== null;
    this.dive = null;
    this.target = depth; this.active = active; this.lowPower = lowPower;
    if (immediate || landed || this.reducedMotion) this.depth = depth;
  }
  setDescent(fromDepth, toDepth, startedAt, endsAt, lowPower = false) {
    this.dive = { fromDepth, toDepth, startedAt, endsAt };
    this.target = toDepth; this.active = true; this.lowPower = lowPower;
    this.depth = descentFrame({ ...this.dive, now: Date.now(), height: this.height,
      reducedMotion: this.reducedMotion }).depth;
  }
  frame(time) {
    const rate = this.lowPower || this.reducedMotion ? 1000 / 18 : 0;
    if (time - this.lastPaint >= rate) {
      const delta = Math.min(100, time - this.lastPaint);
      this.lastPaint = time;
      const h = this.height, w = this.width;
      let diveFrame = null;
      if (this.dive) {
        diveFrame = descentFrame({ ...this.dive, now: Date.now(), height: h, reducedMotion: this.reducedMotion });
        this.depth = diveFrame.depth;
      } else {
        const difference = this.target - this.depth;
        this.depth = Math.abs(difference) < .2 ? this.target : this.depth + difference * Math.min(1, delta * .0048);
      }
      const surface = diveFrame ? diveFrame.surface : this.active
        ? h * .21 - Math.max(0, this.depth * PIXELS_PER_METER - h * .19)
        : h * .60;
      this.scroll = this.active ? Math.max(0, h * .21 - surface) : 0;
      this.surface = surface;
      this.root.style.setProperty('--surface-y', Math.round(surface) + 'px');
      const darkness = Math.max(0, Math.min(.65, (this.depth - 250) / 1150 * .65));
      this.root.style.setProperty('--depth-dim', darkness.toFixed(3));
      document.getElementById('seafloor').style.opacity = this.active && this.depth > 6200 ? .9 : .45;
      this.draw(time / 1000, surface);
      if (time - this.lastLabels > 160) {
        this.lastLabels = time;
        this.drawLabels(surface);
      }
      this.onFrame?.(Math.round(this.depth), diveFrame);
    }
    this.frameId = requestAnimationFrame(this.frame);
  }
  draw(time, surface) {
    const c = this.ctx, w = this.width, h = this.height;
    c.clearRect(0, 0, w, h);
    c.save(); c.beginPath(); c.rect(0, Math.max(0, surface), w, h); c.clip();
    const visibility = Math.max(.15, 1 - this.depth / 3500);
    for (const p of this.specks) {
      const y = ((p.y * h - this.scroll * .24) % h + h) % h;
      c.fillStyle = 'rgba(183,222,246,' + p.alpha * visibility + ')';
      c.fillRect(Math.floor(p.x * w), Math.floor(y), 1.4, 1.4);
    }
    for (const b of this.bubbles.slice(0, this.lowPower ? 15 : 62)) {
      const y = ((b.y * (h + 70) - time * b.speed * h - this.scroll * .18) % (h + 70) + h + 70) % (h + 70);
      if (y < surface) continue;
      c.strokeStyle = 'rgba(188,229,248,' + (this.depth > 1500 ? .15 : .32) + ')';
      c.lineWidth = .8; c.beginPath(); c.arc(b.x * w, y, b.r, 0, Math.PI * 2); c.stroke();
    }
    for (const f of this.fish.slice(0, this.lowPower ? 7 : 24)) {
      let x = ((f.x + (this.reducedMotion ? 0 : time) * f.speed * f.direction) % 1 + 1) % 1 * w;
      const span = h + 180;
      const y = ((f.y * span - this.scroll * .40) % span + span) % span - 90;
      if (y < surface + 25 || this.depth > 1800 && f.size > 5) continue;
      c.save(); c.translate(x, y); c.scale(f.direction, 1);
      c.fillStyle = this.depth > 1800 ? '#1b4763' : '#001a2a';
      c.beginPath(); c.ellipse(0, 0, f.size * 1.5, f.size * .55, 0, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.moveTo(-f.size, 0); c.lineTo(-f.size * 2.3, -f.size * .7);
      c.lineTo(-f.size * 2.3, f.size * .7); c.closePath(); c.fill(); c.restore();
    }
    if (this.depth > 1200) {
      for (let i = 0; i < 5; i++) {
        const x = w * ((i * .23 + .1) % 1), y = h * ((i * .19 + time * .004) % 1);
        c.fillStyle = 'rgba(95,188,220,.08)';
        c.beginPath(); c.ellipse(x, y, 10, 7, 0, Math.PI, Math.PI * 2); c.fill();
        c.strokeStyle = 'rgba(95,188,220,.12)';
        for (let j = -1; j <= 1; j++) {c.beginPath(); c.moveTo(x + j * 5, y); c.quadraticCurveTo(x + j * 7 + Math.sin(time) * 4, y + 14, x + j * 4, y + 27); c.stroke();}
      }
    }
    c.restore();
  }
  drawLabels(surface) {
    const { from, to } = visibleDepthRange(surface, this.height);
    let ruler = '';
    for (let d = from; d <= to; d += 25) {
      const y = surface + d * PIXELS_PER_METER;
      if (y < -10 || y > this.height + 10) continue;
      const major = d % 100 === 0;
      ruler += '<div class="ruler-mark' + (major ? ' major' : '') + '" style="top:' + Math.round(y) + 'px">' +
        (major ? '<span>' + d.toLocaleString('en-US') + 'm</span>' : '') + '</div>';
    }
    this.ruler.innerHTML = ruler;
    this.notes.innerHTML = NOTES.map(([d, label], i) => {
      const y = surface + d * PIXELS_PER_METER;
      return y < 100 || y > this.height - 100 ? '' : '<div class="world-note" style="top:' + Math.round(y) + 'px">' +
        (i % 2 ? label + ' ──' : '── ' + label) + '</div>';
    }).join('');
  }
  destroy() { cancelAnimationFrame(this.frameId); removeEventListener('resize', this.resize); }
}
