import { load } from './store';

// Everything is synthesized. No files. Quiet by design.
class Audio {
  private ctx: AudioContext | null = null;
  private humOsc: OscillatorNode | null = null;
  private humGain: GainNode | null = null;

  private ac() {
    if (load().muted) return null;
    try {
      this.ctx ??= new AudioContext();
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ctx;
    } catch {
      return null;
    }
  }

  private blip(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.05, slide = 0) {
    const ac = this.ac();
    if (!ac) return;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, ac.currentTime);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), ac.currentTime + dur);
    g.gain.setValueAtTime(vol, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
    o.connect(g).connect(ac.destination);
    o.start();
    o.stop(ac.currentTime + dur + 0.02);
  }

  private noise(dur: number, vol: number, lowpass: number) {
    const ac = this.ac();
    if (!ac) return;
    const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * dur), ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 3;
    const src = ac.createBufferSource();
    src.buffer = buf;
    const f = ac.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = lowpass;
    const g = ac.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(ac.destination);
    src.start();
  }

  place() { this.noise(0.06, 0.25, 1800); }
  wire() { this.blip(520, 0.08, 'triangle', 0.04, 180); }
  start() { this.blip(330, 0.12, 'triangle', 0.05); setTimeout(() => this.blip(494, 0.16, 'triangle', 0.05), 90); }
  strike() { this.blip(880, 0.09, 'square', 0.03); setTimeout(() => this.blip(880, 0.09, 'square', 0.03), 140); }
  stamp() { this.noise(0.18, 0.9, 500); this.blip(90, 0.2, 'sine', 0.12, -40); }
  fail() { this.blip(220, 0.35, 'sawtooth', 0.03, -120); }

  // Server-room hum. Pitch and volume follow the busiest part.
  hum(load01: number) {
    const ac = load01 > 0 ? this.ac() : this.ctx;
    if (!ac) return;
    if (!this.humOsc) {
      if (load01 <= 0) return;
      this.humOsc = ac.createOscillator();
      this.humGain = ac.createGain();
      const f = ac.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 400;
      this.humOsc.type = 'sawtooth';
      this.humGain.gain.value = 0;
      this.humOsc.connect(f).connect(this.humGain).connect(ac.destination);
      this.humOsc.start();
    }
    const l = Math.max(0, Math.min(1.2, load01));
    this.humOsc.frequency.setTargetAtTime(55 + l * 70, ac.currentTime, 0.3);
    this.humGain!.gain.setTargetAtTime(load().muted ? 0 : l * 0.018, ac.currentTime, 0.3);
  }
}

export const audio = new Audio();
