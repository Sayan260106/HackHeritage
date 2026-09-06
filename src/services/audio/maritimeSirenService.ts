/**
 * Maritime Emergency Audio Siren Synthesizer
 * 
 * Uses native Web Audio API to synthesize official maritime emergency signals:
 * 1. Dual-tone alternating nautical horn (520 Hz / 660 Hz) for CRITICAL_BREACH and EXTREME risk.
 * 2. Multi-tone ascending chime (440 Hz - 554 Hz - 659 Hz) for PROXIMITY_WARNING and CAUTION.
 * 
 * Zero external audio files required. Completely offline-capable.
 */

class MaritimeSirenService {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private isMuted: boolean = false;
  private isPlaying: boolean = false;
  private activeOscillators: OscillatorNode[] = [];
  private autoStopTimer: number | null = null;
  private listeners: Set<(isPlaying: boolean) => void> = new Set();

  public getAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtxClass) return null;
      this.ctx = new AudioCtxClass();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(0.3, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public subscribe(listener: (isPlaying: boolean) => void): () => void {
    this.listeners.add(listener);
    listener(this.isPlaying);
    return () => this.listeners.delete(listener);
  }

  private setPlaying(playing: boolean) {
    this.isPlaying = playing;
    this.listeners.forEach((fn) => fn(playing));
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
    if (muted) {
      this.stop();
    }
  }

  public getIsMuted(): boolean {
    return this.isMuted;
  }

  /**
   * Unlock Web Audio API on first user gesture.
   */
  public async unlock(): Promise<boolean> {
    const ctx = this.getAudioContext();
    if (!ctx) return false;
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    return ctx.state === 'running';
  }

  /**
   * Play high-urgency dual-tone maritime horn for critical incursions and extreme risks.
   * Alternates between 520 Hz and 660 Hz with sawtooth harmonic grit.
   * Automatically stops after durationSec (default 3.5 seconds) to allow voice warning to speak.
   */
  public playCriticalSiren(durationSec = 3.5): boolean {
    if (this.isMuted) return false;
    const ctx = this.getAudioContext();
    if (!ctx || !this.masterGain) return false;

    this.stop();
    this.setPlaying(true);

    const now = ctx.currentTime;
    const gainNode = ctx.createGain();
    gainNode.connect(this.masterGain);

    // Fade-in envelope to avoid speaker click
    gainNode.gain.setValueAtTime(0.001, now);
    gainNode.gain.exponentialRampToValueAtTime(0.35, now + 0.08);

    // Primary maritime horn oscillator (520 Hz)
    const osc1 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(520, now);

    // Sub-harmonic depth oscillator for authentic acoustic weight (260 Hz)
    const subOsc = ctx.createOscillator();
    subOsc.type = 'triangle';
    subOsc.frequency.setValueAtTime(260, now);

    // Modulate pitch between 520Hz and 660Hz every 0.35s (Standard nautical dual-tone emergency beacon)
    const cycles = Math.ceil(durationSec / 0.7);
    for (let i = 0; i < cycles; i++) {
      const t1 = now + i * 0.7;
      const t2 = t1 + 0.35;
      osc1.frequency.setValueAtTime(520, t1);
      osc1.frequency.setValueAtTime(660, t2);
      subOsc.frequency.setValueAtTime(260, t1);
      subOsc.frequency.setValueAtTime(330, t2);
    }

    // Lowpass filter to emulate atmospheric marine horn acoustic damping
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1400, now);

    osc1.connect(filter);
    subOsc.connect(filter);
    filter.connect(gainNode);

    osc1.start(now);
    subOsc.start(now);

    this.activeOscillators = [osc1, subOsc];

    // Fade-out and stop
    const stopTime = now + durationSec;
    gainNode.gain.setValueAtTime(0.35, stopTime - 0.2);
    gainNode.gain.exponentialRampToValueAtTime(0.001, stopTime);

    osc1.stop(stopTime);
    subOsc.stop(stopTime);

    if (this.autoStopTimer) clearTimeout(this.autoStopTimer);
    this.autoStopTimer = window.setTimeout(() => {
      this.activeOscillators = [];
      this.setPlaying(false);
    }, durationSec * 1000);

    return true;
  }

  /**
   * Play ascending cautionary chime (A4 - C#5 - E5) for proximity advisories.
   */
  public playProximityChime(): boolean {
    if (this.isMuted) return false;
    const ctx = this.getAudioContext();
    if (!ctx || !this.masterGain) return false;

    this.stop();
    this.setPlaying(true);

    const now = ctx.currentTime;
    const notes = [440, 554.37, 659.25]; // A major triad
    const noteDuration = 0.18;

    notes.forEach((freq, idx) => {
      if (!ctx || !this.masterGain) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * noteDuration);

      const startTime = now + idx * noteDuration;
      gain.gain.setValueAtTime(0.001, startTime);
      gain.gain.exponentialRampToValueAtTime(0.25, startTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + noteDuration + 0.15);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(startTime);
      osc.stop(startTime + noteDuration + 0.2);
      this.activeOscillators.push(osc);
    });

    const totalDuration = notes.length * noteDuration + 0.3;
    if (this.autoStopTimer) clearTimeout(this.autoStopTimer);
    this.autoStopTimer = window.setTimeout(() => {
      this.activeOscillators = [];
      this.setPlaying(false);
    }, totalDuration * 1000);

    return true;
  }

  /**
   * Immediately halt any currently sounding tones.
   */
  public stop() {
    if (this.autoStopTimer) {
      clearTimeout(this.autoStopTimer);
      this.autoStopTimer = null;
    }
    this.activeOscillators.forEach((osc) => {
      try {
        osc.stop();
        osc.disconnect();
      } catch {
        // Oscillator may already have completed.
      }
    });
    this.activeOscillators = [];
    this.setPlaying(false);
  }
}

export const maritimeSiren = new MaritimeSirenService();
