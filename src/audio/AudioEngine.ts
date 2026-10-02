import { IDENTITY } from '../config/identity';

export type SoundId =
  | 'chop'
  | 'dig'
  | 'hammer'
  | 'pick'
  | 'bubble'
  | 'deposit'
  | 'treeFall'
  | 'click'
  | 'open'
  | 'close'
  | 'place'
  | 'complete'
  | 'research'
  | 'levelUp'
  | 'newcomer'
  | 'skillUp'
  | 'error'
  | 'notify';

interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

const SETTINGS_KEY = `${IDENTITY.storageKeyPrefix}:audio`;

export interface AudioSettings {
  music: number;
  sfx: number;
  ambience: number;
  muted: boolean;
}

function loadSettings(): AudioSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { music: 0.5, sfx: 0.8, ambience: 0.6, muted: false, ...JSON.parse(raw) };
  } catch {
    // Storage may be unavailable (private mode); defaults are fine.
  }
  return { music: 0.5, sfx: 0.8, ambience: 0.6, muted: false };
}

/** C major pentatonic-ish scale degrees for the melody (semitones from C). */
const MELODY = [0, 2, 4, 7, 9, 12, 14, 16];
/** I – vi – IV – V in C, as root semitones and chord tones. */
const CHORDS = [
  [0, 4, 7],
  [-3, 0, 4],
  [-7, -3, 0],
  [-5, -1, 2],
];

/**
 * Entirely synthesised audio: no sample files, so every sound is original. Effects are
 * short noise/oscillator recipes, the ambience is filtered noise plus birdsong, and
 * the music is a slow generative pastoral loop.
 */
export class AudioEngine {
  settings = loadSettings();
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private ambienceBus!: GainNode;
  private noise!: AudioBuffer;
  private listener = { x: 0, z: 0, distance: 24 };
  private musicTimer = 0;
  private birdTimer = 0;
  private nextBar = 0;
  private bar = 0;
  private lastPlayed = new Map<SoundId, number>();

  /** Must be called from a user gesture (browsers block audio until then). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.sfxBus = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.ambienceBus = ctx.createGain();
    for (const bus of [this.sfxBus, this.musicBus, this.ambienceBus]) bus.connect(this.master);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    let b0 = 0;
    for (let i = 0; i < data.length; i++) {
      // Slightly pink noise: softer, more natural than white.
      const white = Math.random() * 2 - 1;
      b0 = 0.97 * b0 + white * 0.15;
      data[i] = (white * 0.4 + b0) * 0.8;
    }
    this.applySettings();
    this.startAmbience();
    this.nextBar = ctx.currentTime + 0.5;
    this.musicTimer = window.setInterval(() => this.scheduleMusic(), 200);
    this.birdTimer = window.setInterval(() => this.maybeBird(), 1500);
  }

  get unlocked(): boolean {
    return this.ctx !== null;
  }

  update(partial: Partial<AudioSettings>): void {
    this.settings = { ...this.settings, ...partial };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      // Non-essential.
    }
    this.applySettings();
  }

  private applySettings(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.settings.muted ? 0 : 0.9, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(this.settings.sfx * 0.9, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.settings.music * 0.35, t, 0.2);
    this.ambienceBus.gain.setTargetAtTime(this.settings.ambience * 0.5, t, 0.2);
  }

  setListener(target: Vec3Like, distance: number): void {
    this.listener.x = target.x;
    this.listener.z = target.z;
    this.listener.distance = distance;
  }

  /** Positional one-shot: quieter the further it is from the camera's focus. */
  playAt(id: SoundId, pos: Vec3Like): void {
    const d = Math.hypot(pos.x - this.listener.x, pos.z - this.listener.z);
    const zoom = Math.max(0.25, 1 - (this.listener.distance - 12) / 60);
    const vol = Math.max(0, 1 - d / 26) * zoom;
    if (vol > 0.03) this.play(id, vol);
  }

  play(id: SoundId, volume = 1): void {
    const ctx = this.ctx;
    if (!ctx || this.settings.muted) return;
    // Avoid machine-gunning identical sounds.
    const now = ctx.currentTime;
    const last = this.lastPlayed.get(id) ?? -1;
    if (now - last < 0.05) return;
    this.lastPlayed.set(id, now);
    const out = ctx.createGain();
    out.gain.value = volume;
    out.connect(this.sfxBus);
    switch (id) {
      case 'chop':
        this.noiseBurst(out, now, 0.09, 1400, 'bandpass', 0.5, 3);
        this.tone(out, now, 'sine', 160, 70, 0.12, 0.6);
        break;
      case 'dig':
        this.noiseBurst(out, now, 0.22, 500, 'lowpass', 0.45, 1);
        break;
      case 'hammer':
        this.tone(out, now, 'triangle', 1250, 1150, 0.08, 0.18);
        this.noiseBurst(out, now, 0.04, 3000, 'highpass', 0.25, 1);
        break;
      case 'pick':
        // Steel on stone: a bright ping over a short gritty crack.
        this.tone(out, now, 'triangle', 1650, 1500, 0.09, 0.16);
        this.tone(out, now, 'sine', 2480, 2300, 0.06, 0.08);
        this.noiseBurst(out, now, 0.07, 2200, 'bandpass', 0.35, 2);
        break;
      case 'bubble':
        this.tone(out, now, 'sine', 240, 520, 0.09, 0.12);
        break;
      case 'deposit':
        this.tone(out, now, 'triangle', 420, 400, 0.06, 0.18);
        this.tone(out, now + 0.07, 'triangle', 330, 320, 0.07, 0.15);
        break;
      case 'treeFall':
        this.noiseBurst(out, now, 0.6, 700, 'lowpass', 0.5, 1);
        this.tone(out, now + 0.05, 'sine', 110, 50, 0.4, 0.5);
        break;
      case 'click':
        this.tone(out, now, 'sine', 700, 760, 0.05, 0.18);
        break;
      case 'open':
        this.tone(out, now, 'sine', 520, 540, 0.06, 0.15);
        this.tone(out, now + 0.05, 'sine', 780, 800, 0.08, 0.13);
        break;
      case 'close':
        this.tone(out, now, 'sine', 700, 680, 0.05, 0.12);
        this.tone(out, now + 0.05, 'sine', 470, 460, 0.07, 0.12);
        break;
      case 'place':
        this.noiseBurst(out, now, 0.18, 400, 'lowpass', 0.5, 1);
        this.tone(out, now, 'sine', 120, 60, 0.2, 0.5);
        break;
      case 'complete':
        [0, 4, 7, 12].forEach((s, i) => this.pluck(out, now + i * 0.09, 523.25 * 2 ** (s / 12), 0.5, 0.28));
        break;
      case 'research':
        [7, 12, 16, 19].forEach((s, i) => this.bell(out, now + i * 0.12, 392 * 2 ** (s / 12), 0.2));
        break;
      case 'levelUp':
        [0, 4, 7, 12, 16].forEach((s, i) => this.pluck(out, now + i * 0.1, 392 * 2 ** (s / 12), 0.7, 0.3));
        [0, 4, 7].forEach((s) => this.pad(out, now + 0.5, 196 * 2 ** (s / 12), 1.4, 0.12));
        break;
      case 'newcomer':
        this.tone(out, now, 'sine', 880, 1320, 0.12, 0.16);
        this.tone(out, now + 0.16, 'sine', 990, 1480, 0.14, 0.16);
        break;
      case 'skillUp':
        [12, 16, 19].forEach((s, i) => this.pluck(out, now + i * 0.07, 523.25 * 2 ** (s / 12), 0.35, 0.18));
        break;
      case 'error':
        this.tone(out, now, 'triangle', 300, 280, 0.1, 0.2);
        this.tone(out, now + 0.1, 'triangle', 220, 210, 0.14, 0.2);
        break;
      case 'notify':
        this.bell(out, now, 880, 0.12);
        break;
    }
  }

  // --- Building blocks -------------------------------------------------------

  private tone(out: AudioNode, t: number, type: OscillatorType, f0: number, f1: number, dur: number, vol: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noiseBurst(out: AudioNode, t: number, dur: number, freq: number, type: BiquadFilterType, vol: number, q: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.02);
  }

  private pluck(out: AudioNode, t: number, freq: number, dur: number, vol: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    osc.type = 'triangle';
    osc2.type = 'sine';
    osc.frequency.value = freq;
    osc2.frequency.value = freq * 2;
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(freq * 6, t);
    lp.frequency.exponentialRampToValueAtTime(freq * 1.5, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const g2 = ctx.createGain();
    g2.gain.value = 0.25;
    osc.connect(lp);
    osc2.connect(g2).connect(lp);
    lp.connect(g).connect(out);
    osc.start(t);
    osc2.start(t);
    osc.stop(t + dur + 0.05);
    osc2.stop(t + dur + 0.05);
  }

  private bell(out: AudioNode, t: number, freq: number, vol: number): void {
    for (const [ratio, amp, decay] of [[1, 1, 1.2], [2.76, 0.4, 0.6], [5.4, 0.2, 0.3]]) {
      this.tone(out, t, 'sine', freq * ratio, freq * ratio, decay, vol * amp);
    }
  }

  private pad(out: AudioNode, t: number, freq: number, dur: number, vol: number): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + dur * 0.35);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    lp.connect(g).connect(out);
    for (const detune of [-6, 6]) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      osc.detune.value = detune;
      osc.connect(lp);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    }
  }

  // --- Ambience & music --------------------------------------------------------

  private startAmbience(): void {
    const ctx = this.ctx!;
    const makeBed = (freq: number, type: BiquadFilterType, vol: number, lfoRate: number) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = vol;
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.frequency.value = lfoRate;
      lfoGain.gain.value = vol * 0.6;
      lfo.connect(lfoGain).connect(g.gain);
      src.connect(f).connect(g).connect(this.ambienceBus);
      src.start();
      lfo.start();
    };
    makeBed(420, 'lowpass', 0.22, 0.07); // wind through leaves
    makeBed(1600, 'bandpass', 0.05, 0.23); // distant creek
  }

  private maybeBird(): void {
    const ctx = this.ctx;
    if (!ctx || Math.random() > 0.45) return;
    const out = ctx.createGain();
    out.gain.value = 0.18 + Math.random() * 0.15;
    out.connect(this.ambienceBus);
    const t = ctx.currentTime + Math.random() * 0.5;
    const base = 2200 + Math.random() * 1600;
    const notes = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < notes; i++) {
      const start = t + i * (0.09 + Math.random() * 0.06);
      this.tone(out, start, 'sine', base * (1 + Math.random() * 0.2), base * (0.8 + Math.random() * 0.5), 0.07 + Math.random() * 0.05, 0.25);
    }
  }

  private scheduleMusic(): void {
    const ctx = this.ctx;
    if (!ctx || this.settings.music <= 0 || this.settings.muted) {
      if (ctx) this.nextBar = Math.max(this.nextBar, ctx.currentTime + 0.2);
      return;
    }
    const barLen = 3.2; // 4 beats at 75 bpm
    while (this.nextBar < ctx.currentTime + 1.2) {
      const chord = CHORDS[this.bar % CHORDS.length];
      const root = 261.63;
      for (const s of chord) this.pad(this.musicBus, this.nextBar, (root / 2) * 2 ** (s / 12), barLen * 1.05, 0.05);
      this.tone(this.musicBus, this.nextBar, 'sine', (root / 4) * 2 ** (chord[0] / 12), (root / 4) * 2 ** (chord[0] / 12), barLen * 0.9, 0.08);
      // A sparse, wandering melody — rests are part of the charm.
      let degree = Math.floor(Math.random() * MELODY.length);
      for (let beat = 0; beat < 8; beat++) {
        if (Math.random() < 0.45) continue;
        degree = Math.max(0, Math.min(MELODY.length - 1, degree + Math.round((Math.random() - 0.5) * 3)));
        const f = root * 2 ** (MELODY[degree] / 12);
        this.pluck(this.musicBus, this.nextBar + beat * (barLen / 8), f, 0.9, 0.07);
      }
      this.nextBar += barLen;
      this.bar++;
    }
  }

  dispose(): void {
    window.clearInterval(this.musicTimer);
    window.clearInterval(this.birdTimer);
    void this.ctx?.close();
    this.ctx = null;
  }
}
