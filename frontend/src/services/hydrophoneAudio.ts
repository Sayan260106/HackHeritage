/**
 * Hydrophone & Oceanic Ambient Audio Engine
 * Uses native Web Audio API to synthesize realistic deep-sea ocean swells
 * and hydrophone sonar pings without downloading external audio files.
 */

class HydrophoneAudioEngine {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = true;
  private masterGain: GainNode | null = null;
  private swellGain: GainNode | null = null;
  private noiseSource: AudioBufferSourceNode | null = null;
  private lfo: OscillatorNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private pingInterval: number | null = null;
  private listeners: Set<(active: boolean) => void> = new Set();

  private initContext() {
    if (this.ctx) return;
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AudioContextClass();

    // Master volume control with smooth ramp
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.setValueAtTime(0, this.ctx.currentTime);
    this.masterGain.connect(this.ctx.destination);
  }

  /**
   * Create a 5-second buffer of custom pink/brown ocean noise
   */
  private createOceanNoiseBuffer(): AudioBuffer {
    if (!this.ctx) throw new Error("AudioContext not initialized");
    const bufferSize = this.ctx.sampleRate * 5;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);

    let lastOut = 0.0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      // Brown noise integration filter for deep oceanic rumbling
      data[i] = (lastOut + 0.02 * white) / 1.02;
      lastOut = data[i];
      data[i] *= 2.5; // Scale gain
    }
    return buffer;
  }

  /**
   * Starts ambient ocean swell synthesis
   */
  private startOceanSwell() {
    if (!this.ctx || !this.masterGain) return;

    // Ocean noise buffer loop
    const noiseBuffer = this.createOceanNoiseBuffer();
    this.noiseSource = this.ctx.createBufferSource();
    this.noiseSource.buffer = noiseBuffer;
    this.noiseSource.loop = true;

    // Lowpass filter for underwater muffling
    this.filter = this.ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.setValueAtTime(240, this.ctx.currentTime);
    this.filter.Q.setValueAtTime(1.5, this.ctx.currentTime);

    // Swell Gain
    this.swellGain = this.ctx.createGain();
    this.swellGain.gain.setValueAtTime(0.18, this.ctx.currentTime);

    // LFO Oscillator for periodic ocean surge (0.12 Hz ~ 8s wave cycle)
    this.lfo = this.ctx.createOscillator();
    this.lfo.type = "sine";
    this.lfo.frequency.setValueAtTime(0.12, this.ctx.currentTime);

    const lfoGain = this.ctx.createGain();
    lfoGain.gain.setValueAtTime(110, this.ctx.currentTime); // Filter modulation range

    // Connect LFO to filter frequency
    this.lfo.connect(lfoGain);
    lfoGain.connect(this.filter.frequency);

    // Connect Noise -> Filter -> SwellGain -> Master
    this.noiseSource.connect(this.filter);
    this.filter.connect(this.swellGain);
    this.swellGain.connect(this.masterGain);

    this.noiseSource.start();
    this.lfo.start();
  }

  /**
   * Synthesize a hydrophone sonar ping with underwater decay and reverb delay
   */
  public triggerSonarPing(freq = 1040) {
    if (this.isMuted || !this.ctx || !this.masterGain) return;

    try {
      const now = this.ctx.currentTime;

      // Primary ping oscillator
      const osc = this.ctx.createOscillator();
      const pingGain = this.ctx.createGain();

      osc.type = "sine";
      // Slight pitch drop simulating underwater Doppler / sound propagation
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.78, now + 0.35);

      // Envelope: Instant attack, smooth exponential decay
      pingGain.gain.setValueAtTime(0.001, now);
      pingGain.gain.linearRampToValueAtTime(0.22, now + 0.02);
      pingGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);

      // Underwater echo delay line
      const delay = this.ctx.createDelay();
      delay.delayTime.setValueAtTime(0.22, now);

      const feedback = this.ctx.createGain();
      feedback.gain.setValueAtTime(0.35, now);

      delay.connect(feedback);
      feedback.connect(delay);

      // Connect ping
      osc.connect(pingGain);
      pingGain.connect(this.masterGain);
      pingGain.connect(delay);
      delay.connect(this.masterGain);

      osc.start(now);
      osc.stop(now + 1.3);
    } catch {
      // Ignore audio context state exceptions
    }
  }

  /**
   * Toggle ambient audio on or off
   */
  public async toggleAudio(): Promise<boolean> {
    this.initContext();

    if (!this.ctx || !this.masterGain) return false;

    if (this.ctx.state === "suspended") {
      await this.ctx.resume();
    }

    if (this.isMuted) {
      // Unmute & start audio
      this.isMuted = false;
      if (!this.noiseSource) {
        this.startOceanSwell();
      }

      // Smooth volume fade-in
      const now = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now);
      this.masterGain.gain.linearRampToValueAtTime(0.35, now + 0.8);

      // Trigger initial hydrophone ping
      this.triggerSonarPing(1080);

      // Schedule periodic pings every 9 seconds
      if (!this.pingInterval) {
        this.pingInterval = window.setInterval(() => {
          if (!this.isMuted) {
            this.triggerSonarPing(980 + Math.random() * 120);
          }
        }, 9000);
      }
    } else {
      // Mute audio with smooth fade-out
      this.isMuted = true;
      const now = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now);
      this.masterGain.gain.linearRampToValueAtTime(0.0001, now + 0.5);

      if (this.pingInterval) {
        clearInterval(this.pingInterval);
        this.pingInterval = null;
      }
    }

    this.notifyListeners();
    return !this.isMuted;
  }

  public getIsActive(): boolean {
    return !this.isMuted;
  }

  public subscribe(listener: (active: boolean) => void): () => void {
    this.listeners.add(listener);
    listener(this.getIsActive());
    return () => this.listeners.delete(listener);
  }

  private notifyListeners() {
    const active = this.getIsActive();
    this.listeners.forEach((l) => l(active));
  }
}

export const hydrophoneEngine = new HydrophoneAudioEngine();
