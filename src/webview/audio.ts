import type { Sfx } from './game';

/** Tiny WebAudio synth — no audio files, nothing to load. Starts after the first key press. */
export class Audio {
  private ctx: AudioContext | undefined;
  private master: GainNode | undefined;
  private noise: AudioBuffer | undefined;
  private lastShot = 0;
  muted = false;

  /** Must be called from a user gesture (key press / click). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      return;
    }
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.22;
      this.master.connect(this.ctx.destination);
      const len = Math.floor(this.ctx.sampleRate * 0.5);
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) {
        data[i] = Math.random() * 2 - 1;
      }
    } catch {
      this.ctx = undefined; // audio unavailable: play silently
    }
  }

  suspend(): void {
    void this.ctx?.suspend();
  }

  play(name: Sfx): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted || ctx.state !== 'running') {
      return;
    }
    const t = ctx.currentTime;
    switch (name) {
      case 'shoot':
        if (t - this.lastShot < 0.05) {
          return;
        }
        this.lastShot = t;
        this.tone('square', 880, 440, 0.07, 0.25);
        break;
      case 'hit':
        this.tone('triangle', 300, 200, 0.05, 0.3);
        break;
      case 'explode':
        this.burst(0.25, 1800, 0.5);
        this.tone('sawtooth', 160, 50, 0.2, 0.25);
        break;
      case 'bigExplode':
        this.burst(0.5, 900, 0.8);
        this.tone('sawtooth', 110, 30, 0.5, 0.35);
        break;
      case 'playerHit':
        this.burst(0.6, 600, 0.9);
        this.tone('square', 220, 40, 0.6, 0.35);
        break;
      case 'power':
        [523, 659, 784, 1047].forEach((f, i) => this.tone('square', f, f, 0.08, 0.2, i * 0.06));
        break;
      case 'level':
        [392, 523, 659, 784].forEach((f, i) => this.tone('triangle', f, f, 0.14, 0.3, i * 0.09));
        break;
      case 'escape':
        this.tone('sawtooth', 300, 90, 0.35, 0.25);
        break;
      case 'shield':
        this.tone('sine', 1200, 300, 0.25, 0.35);
        break;
      case 'zap':
        this.tone('sawtooth', 1800, 200, 0.18, 0.25);
        this.tone('square', 900, 1800, 0.12, 0.15, 0.05);
        break;
      case 'freeze':
        [1568, 1319, 1047, 784].forEach((f, i) => this.tone('triangle', f, f, 0.07, 0.22, i * 0.04));
        break;
      case 'warning':
        this.tone('square', 660, 660, 0.06, 0.18);
        this.tone('square', 660, 660, 0.06, 0.18, 0.12);
        break;
      case 'deflect':
        if (t - this.lastShot < 0.03) {
          return;
        }
        this.tone('triangle', 1400, 900, 0.05, 0.18);
        break;
      case 'summon':
        this.tone('square', 220, 660, 0.12, 0.18);
        break;
      case 'warp':
        this.tone('sine', 900, 120, 0.3, 0.25);
        break;
      case 'bossIntro':
        // Air-raid siren.
        [0, 0.5, 1, 1.5].forEach((d) => this.tone('sawtooth', 220, 440, 0.45, 0.2, d));
        break;
      case 'bossPhase':
        this.burst(0.4, 1200, 0.6);
        [330, 247, 196].forEach((f, i) => this.tone('square', f, f, 0.12, 0.25, i * 0.1));
        break;
      case 'bossDefeat':
        this.burst(1.2, 700, 0.9);
        this.tone('sawtooth', 160, 30, 1.2, 0.35);
        break;
      case 'victory':
        [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => this.tone('square', f, f, 0.14, 0.22, i * 0.12));
        break;
    }
  }

  /** One beat of the four-note marching bass used by the retro theme. */
  step(beat: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted || ctx.state !== 'running') {
      return;
    }
    const notes = [98, 87, 78, 73];
    const f = notes[beat % notes.length];
    this.tone('square', f, f * 0.97, 0.09, 0.4);
  }

  private tone(type: OscillatorType, from: number, to: number, dur: number, vol: number, delay = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain).connect(this.master!);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private burst(dur: number, cutoff: number, vol: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise!;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoff, t);
    filter.frequency.exponentialRampToValueAtTime(80, t + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(gain).connect(this.master!);
    src.start(t);
    src.stop(t + dur);
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = undefined;
  }
}
