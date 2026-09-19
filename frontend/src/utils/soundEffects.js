/**
 * Sound Effects Engine using browser-native Web Audio API.
 * High-fidelity, zero-latency, zero external audio asset dependencies.
 * Designed to provide tactile, rewarding feedback for eCommerce interactions.
 */

let audioCtx = null;

const getAudioContext = () => {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
};

// Local storage sound preferences
const SOUND_KEY = "store_sound_fx_enabled";

export const isSoundEnabled = () => {
  if (typeof window === "undefined") return true;
  const stored = localStorage.getItem(SOUND_KEY);
  return stored === null ? true : stored === "true";
};

export const setSoundEnabled = (enabled) => {
  if (typeof window === "undefined") return;
  localStorage.setItem(SOUND_KEY, String(enabled));
  window.dispatchEvent(new CustomEvent("sound-setting-changed", { detail: { enabled } }));
};

export const toggleSound = () => {
  const current = isSoundEnabled();
  setSoundEnabled(!current);
  return !current;
};

/**
 * 1. Variety / Color / Size Switch Sound
 * A subtle, tactile, organic pop/click with warmth.
 */
export const playSwitchSound = () => {
  if (!isSoundEnabled()) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    const now = ctx.currentTime;

    // Pitch drop creates a tactile "pop"
    osc.frequency.setValueAtTime(540, now);
    osc.frequency.exponentialRampToValueAtTime(180, now + 0.04);

    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.05);
  } catch (e) {
    // Graceful fallback if audio is blocked
  }
};

/**
 * 2. Quantity / Counter Stepper Sound
 * A light, crisp micro-tick with subtle pitch shift.
 */
export const playCountSound = (direction = "inc", count = 1) => {
  if (!isSoundEnabled()) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "triangle";
    const now = ctx.currentTime;

    const baseFreq = direction === "inc" ? 440 + Math.min(count * 20, 200) : 380;
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.2, now + 0.03);

    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.04);
  } catch (e) {
    // Silently ignore
  }
};

/**
 * 3. Add to Cart Celebratory Chime
 * An uplifting, luxurious 3-note harmonic chime (e.g. C5 -> E5 -> G5)
 * evoking success and reward.
 */
export const playAddToCartSound = () => {
  if (!isSoundEnabled()) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
    const times = [0, 0.06, 0.12];

    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + times[idx]);

      gain.gain.setValueAtTime(0, now + times[idx]);
      gain.gain.linearRampToValueAtTime(0.12, now + times[idx] + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + times[idx] + 0.35);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + times[idx]);
      osc.stop(now + times[idx] + 0.36);
    });
  } catch (e) {
    // Silently ignore
  }
};
