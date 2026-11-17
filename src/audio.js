export class DiveAudio {
  constructor(config, muted = false) {
    this.config = config; this.muted = muted; this.context = null; this.master = null;
    this.nodes = new Set(); this.lastEvents = new Map();
    this.onVisibility = () => {
      if (!this.context) return;
      if (document.hidden) this.context.suspend().catch(() => {});
      else if (!this.muted) this.context.resume().catch(() => {});
    };
    document.addEventListener('visibilitychange', this.onVisibility);
  }
  async unlock() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return false;
      if (!this.context || this.context.state === 'closed') {
        this.context = new AudioContext();
        this.master = this.context.createGain();
        this.master.gain.value = this.muted ? 0 : this.config.masterGain;
        this.master.connect(this.context.destination);
      }
      if (this.context.state !== 'running') await this.context.resume();
      return this.context.state === 'running';
    } catch { return false; }
  }
  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.setTargetAtTime(muted ? 0 : this.config.masterGain, this.context.currentTime, .015);
    if (muted) {
      for (const node of this.nodes) { try { node.stop(); } catch {} }
      this.nodes.clear();
    } else if (this.context) this.unlock();
  }
  play(name) {
    if (this.muted || document.hidden || this.context?.state !== 'running') return;
    const now = performance.now();
    if (now - (this.lastEvents.get(name) || -1000) < 65) return;
    this.lastEvents.set(name, now);
    const events = this.config.events[name] || [];
    const shared = new Map();
    const start = this.context.currentTime + .005;
    for (const event of events) {
      const settings = { ...(event.kind === 'noise' ? this.config.noiseDefaults : this.config.toneDefaults), ...event };
      if (event.frequencyMultiplierRange) {
        const key = event.sharedRandom || name;
        if (!shared.has(key)) shared.set(key, event.frequencyMultiplierRange[0] + Math.random() * (event.frequencyMultiplierRange[1] - event.frequencyMultiplierRange[0]));
        settings.f0 *= shared.get(key);
        if (settings.f1 !== undefined) settings.f1 *= shared.get(key);
      }
      if (event.kind === 'noise') this.noise(settings, start);
      else this.tone(settings, start);
    }
  }
  envelope(node, start, settings) {
    node.gain.setValueAtTime(0, start);
    node.gain.linearRampToValueAtTime(Math.max(.0001, settings.peak), start + settings.a);
    node.gain.exponentialRampToValueAtTime(.0001, start + settings.a + settings.dur);
  }
  track(node, cleanup = []) {
    this.nodes.add(node);
    node.onended = () => {
      this.nodes.delete(node); node.disconnect();
      for (const other of cleanup) other.disconnect();
    };
  }
  tone(s, origin) {
    const ac = this.context, start = origin + s.delay;
    const oscillator = ac.createOscillator();
    oscillator.type = s.type;
    oscillator.frequency.setValueAtTime(Math.max(1, s.f0), start);
    if (s.f1 !== undefined) oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, s.f1), start + s.dur);
    let output = oscillator;
    const cleanup = [];
    if (s.lp) {
      const filter = ac.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = s.lp;
      output.connect(filter); output = filter; cleanup.push(filter);
    }
    const gain = ac.createGain();
    this.envelope(gain, start, s); output.connect(gain); gain.connect(this.master);
    cleanup.push(gain);
    this.track(oscillator, cleanup); oscillator.start(start); oscillator.stop(start + s.dur + s.a + .05);
  }
  noise(s, origin) {
    const ac = this.context, start = origin + s.delay;
    const buffer = ac.createBuffer(1, Math.ceil(ac.sampleRate * (s.dur + .1)), ac.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    const source = ac.createBufferSource(); source.buffer = buffer;
    const low = ac.createBiquadFilter(); low.type = 'lowpass';
    low.frequency.setValueAtTime(s.lp, start);
    if (s.sweepTo) low.frequency.exponentialRampToValueAtTime(Math.max(1, s.sweepTo), start + s.dur);
    source.connect(low); let output = low;
    const cleanup = [low];
    if (s.hp) {
      const high = ac.createBiquadFilter(); high.type = 'highpass'; high.frequency.value = s.hp;
      output.connect(high); output = high; cleanup.push(high);
    }
    const gain = ac.createGain(); this.envelope(gain, start, s);
    output.connect(gain); gain.connect(this.master);
    cleanup.push(gain);
    this.track(source, cleanup); source.start(start); source.stop(start + s.dur + .1);
  }
  destroy() {
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.setMuted(true); this.context?.close().catch(() => {});
  }
}
