/**
 * Nexus P2P Messenger - Authentic Telephone & Cellular Ringtone Engine
 * Synthesizes realistic mobile phone incoming call ringtones, telephone bell cadence,
 * outgoing ringback tones, and message notification chimes using Web Audio API + Vibration.
 * Includes auto-unlock for mobile browser autoplay policies and Android WebView hooks.
 */

class AudioRinger {
  constructor() {
    this.audioCtx = null;
    this.ringInterval = null;
    this.isPlaying = false;
    this.currentMode = null; // 'incoming' | 'outgoing' | null
    this.activeNodes = [];
    this.unlocked = false;

    // Auto-unlock AudioContext on first touch/click on device
    if (typeof window !== 'undefined') {
      const unlock = () => {
        this.getAudioContext();
        this.unlocked = true;
        window.removeEventListener('touchstart', unlock);
        window.removeEventListener('click', unlock);
        window.removeEventListener('keydown', unlock);
      };
      window.addEventListener('touchstart', unlock, { passive: true, once: true });
      window.addEventListener('click', unlock, { passive: true, once: true });
      window.addEventListener('keydown', unlock, { passive: true, once: true });
    }
  }

  getAudioContext() {
    if (!this.audioCtx || this.audioCtx.state === 'closed') {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      if (AudioCtxClass) {
        this.audioCtx = new AudioCtxClass();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
    return this.audioCtx;
  }

  /**
   * Start authentic cellular phone incoming call ringtone
   * Uses dual-tone PBX telephone bell harmonics + melodic smartphone cadence
   */
  startIncomingRingtone() {
    this.stop();
    this.isPlaying = true;
    this.currentMode = 'incoming';

    // 1. Android Native WebView hook (if running in custom Android wrapper)
    if (typeof window !== 'undefined') {
      const android = window.AndroidBridge || window.Android;
      if (android && typeof android.playRingtone === 'function') {
        try {
          android.playRingtone();
        } catch (e) {}
      }
    }

    // 2. Continuous Phone Call Vibration (1 sec vibrate, 0.5 sec pause, 1 sec vibrate...)
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try {
        navigator.vibrate([1000, 500, 1000, 500, 1200, 800]);
      } catch (e) {}
    }

    // 3. Play realistic mobile phone ring sequence
    const playPhoneRingCycle = () => {
      if (!this.isPlaying || this.currentMode !== 'incoming') return;
      const ctx = this.getAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;

      // Master compressor & limiter to ensure high volume without harsh distortion
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.setValueAtTime(-12, now);
      compressor.knee.setValueAtTime(40, now);
      compressor.ratio.setValueAtTime(12, now);
      compressor.attack.setValueAtTime(0.003, now);
      compressor.release.setValueAtTime(0.25, now);

      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(0.85, now);
      masterGain.connect(compressor);
      compressor.connect(ctx.destination);

      // Authentic Cellular Smartphone Melody Notes (Hz) - Upbeat, high-resonance telephone ring
      // Combines classic digital ring cadence: E6, B5, C#6, D#6, G#5, F#5, E5 with dual-tone ring
      const melody = [
        { freq: 1318.5, time: 0.00, dur: 0.14 }, // E6
        { freq: 987.77, time: 0.16, dur: 0.14 }, // B5
        { freq: 1108.7, time: 0.32, dur: 0.14 }, // C#6
        { freq: 1244.5, time: 0.48, dur: 0.16 }, // D#6
        { freq: 1318.5, time: 0.70, dur: 0.22 }, // E6 long
        { freq: 987.77, time: 0.96, dur: 0.14 }, // B5
        { freq: 1108.7, time: 1.12, dur: 0.16 }, // C#6
        { freq: 1318.5, time: 1.32, dur: 0.35 }, // E6 resolution
      ];

      // Play melodic ringtone tones
      melody.forEach(({ freq, time, dur }) => {
        const osc = ctx.createOscillator();
        const oscHarmonic = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'triangle';
        oscHarmonic.type = 'sine';

        osc.frequency.setValueAtTime(freq, now + time);
        oscHarmonic.frequency.setValueAtTime(freq * 2, now + time);

        gain.gain.setValueAtTime(0.001, now + time);
        gain.gain.linearRampToValueAtTime(0.4, now + time + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + time + dur);

        osc.connect(gain);
        oscHarmonic.connect(gain);
        gain.connect(masterGain);

        osc.start(now + time);
        osc.stop(now + time + dur + 0.05);
        oscHarmonic.start(now + time);
        oscHarmonic.stop(now + time + dur + 0.05);

        this.activeNodes.push(osc, oscHarmonic);
      });

      // Layer classic telephone bell undertone (440Hz + 480Hz modulated)
      [440, 480].forEach((freq) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.12, now + 0.05);
        gain.gain.setValueAtTime(0.12, now + 1.5);
        gain.gain.linearRampToValueAtTime(0.001, now + 1.7);

        osc.connect(gain);
        gain.connect(masterGain);

        osc.start(now);
        osc.stop(now + 1.75);
        this.activeNodes.push(osc);
      });
    };

    // Play immediately and repeat in 2.8 second telephone cadence
    playPhoneRingCycle();
    this.ringInterval = setInterval(() => {
      if (!this.isPlaying || this.currentMode !== 'incoming') return;
      playPhoneRingCycle();
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try {
          navigator.vibrate([1000, 500, 1000, 500]);
        } catch (e) {}
      }
    }, 2800);
  }

  /**
   * Play standard outgoing ringback tone ("brrr... brrr...")
   */
  startOutgoingRingback() {
    this.stop();
    this.isPlaying = true;
    this.currentMode = 'outgoing';

    const playTone = () => {
      if (!this.isPlaying || this.currentMode !== 'outgoing') return;
      const ctx = this.getAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;
      [440, 480].forEach((freq) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.12, now + 0.05);
        gain.gain.setValueAtTime(0.12, now + 1.1);
        gain.gain.linearRampToValueAtTime(0.001, now + 1.25);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now);
        osc.stop(now + 1.3);
        this.activeNodes.push(osc);
      });
    };

    playTone();
    this.ringInterval = setInterval(playTone, 3200);
  }

  /**
   * Play crisp, audible incoming message pop chime
   */
  playMessageBeep() {
    const ctx = this.getAudioContext();
    if (!ctx) return;

    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try {
        navigator.vibrate([120, 60, 120]);
      } catch (e) {}
    }

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, now); // D5
    osc.frequency.exponentialRampToValueAtTime(880.0, now + 0.1); // A5

    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(1174.66, now); // D6
    osc2.frequency.exponentialRampToValueAtTime(1760.0, now + 0.1);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.35, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

    osc.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc2.start(now);
    osc.stop(now + 0.24);
    osc2.stop(now + 0.24);
  }

  /**
   * Stop all ringing sounds and vibrations immediately
   */
  stop() {
    this.isPlaying = false;
    this.currentMode = null;

    if (this.ringInterval) {
      clearInterval(this.ringInterval);
      this.ringInterval = null;
    }

    // Stop active oscillators safely
    if (this.activeNodes && this.activeNodes.length > 0) {
      this.activeNodes.forEach((node) => {
        try {
          node.stop();
          node.disconnect();
        } catch (e) {}
      });
      this.activeNodes = [];
    }

    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try {
        navigator.vibrate(0);
      } catch (e) {}
    }

    // Stop Android Native WebView ringtone if supported
    if (typeof window !== 'undefined') {
      const android = window.AndroidBridge || window.Android;
      if (android && typeof android.stopRingtone === 'function') {
        try {
          android.stopRingtone();
        } catch (e) {}
      }
    }
  }
}

export const audioRinger = new AudioRinger();
export default audioRinger;
