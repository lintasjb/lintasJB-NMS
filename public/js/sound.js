/* lintasJB NMS — WebAudio alarm engine */
let ctx = null;
let master = null;
let activeNodes = [];
let stopTimer = null;

function ensureContext() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 1;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

export function unlock() {
  const audio = ensureContext();
  if (!audio) return false;
  if (audio.state === 'suspended') audio.resume().catch(() => {});
  return audio.state === 'running';
}

export function isReady() {
  return Boolean(ctx && ctx.state === 'running');
}

function tone({ freq = 880, start = 0, duration = 0.2, volume = 0.5, type = 'sine', sweepTo = null, attack = 0.01, release = 0.05 }) {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  const t0 = ctx.currentTime + start;
  osc.frequency.setValueAtTime(freq, t0);
  if (sweepTo) osc.frequency.linearRampToValueAtTime(sweepTo, t0 + duration);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), t0 + attack);
  gain.gain.setValueAtTime(Math.max(0.0002, volume), Math.max(t0 + attack, t0 + duration - release));
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(gain);
  gain.connect(master);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
  activeNodes.push(osc);
  osc.onended = () => {
    activeNodes = activeNodes.filter((n) => n !== osc);
    try { gain.disconnect(); } catch { /* ignore */ }
  };
}

const patterns = {
  siren(volume, repeat) {
    for (let r = 0; r < repeat; r += 1) {
      const base = r * 1.35;
      tone({ freq: 620, sweepTo: 1000, start: base, duration: 0.6, volume, type: 'sawtooth' });
      tone({ freq: 1000, sweepTo: 620, start: base + 0.66, duration: 0.62, volume, type: 'sawtooth' });
    }
    return repeat * 1.35;
  },
  beep(volume, repeat) {
    for (let r = 0; r < repeat; r += 1) {
      const base = r * 0.9;
      tone({ freq: 1046, start: base, duration: 0.16, volume, type: 'square' });
      tone({ freq: 1318, start: base + 0.22, duration: 0.16, volume, type: 'square' });
      tone({ freq: 1046, start: base + 0.44, duration: 0.2, volume, type: 'square' });
    }
    return repeat * 0.9;
  },
  pulse(volume, repeat) {
    for (let r = 0; r < repeat; r += 1) {
      tone({ freq: 1240, start: r * 0.55, duration: 0.12, volume, type: 'sine' });
      tone({ freq: 1660, start: r * 0.55 + 0.16, duration: 0.09, volume: volume * 0.7, type: 'sine' });
    }
    return repeat * 0.55;
  },
  alarm(volume, repeat) {
    const seq = [880, 660, 880, 660, 1046];
    for (let r = 0; r < repeat; r += 1) {
      seq.forEach((freq, i) => {
        tone({ freq, start: r * 1.5 + i * 0.24, duration: 0.18, volume, type: 'triangle' });
      });
    }
    return repeat * 1.5;
  },
};

export function play(pattern = 'siren', volume = 0.55, repeat = 3) {
  const audio = ensureContext();
  if (!audio) return 0;
  stopSound(false);
  const safeVolume = Math.max(0, Math.min(1, Number(volume) || 0.5)) * 0.32;
  const safeRepeat = Math.max(1, Math.min(20, Number(repeat) || 3));
  const fn = patterns[pattern] || patterns.siren;
  const duration = fn(safeVolume, safeRepeat);
  stopTimer = setTimeout(() => { stopTimer = null; }, duration * 1000 + 150);
  return duration;
}

export function stopSound(hard = true) {
  if (stopTimer) clearTimeout(stopTimer);
  stopTimer = null;
  const nodes = activeNodes;
  activeNodes = [];
  for (const osc of nodes) {
    try {
      osc.stop();
      osc.disconnect();
    } catch { /* ignore */ }
  }
  if (hard && master) {
    try { master.gain.cancelScheduledValues(ctx.currentTime); } catch { /* ignore */ }
  }
}

export function destroy() {
  stopSound();
  if (ctx) {
    ctx.close().catch(() => {});
    ctx = null;
    master = null;
  }
}

export default { unlock, isReady, play, stopSound, destroy };
