import { ICE_TIMES, POUR } from "./recipe.ts";

interface Cue {
  id: string;
  at: number;
  play: (when: number) => void;
}

export interface Score {
  readonly muted: boolean;
  setMuted: (muted: boolean) => void;
  unlock: () => void;
  stop: () => void;
  reset: () => void;
  sync: (previous: number, next: number) => void;
}

export function createScore(): Score {
  let context: AudioContext | null = null;
  let noise: AudioBuffer | null = null;
  let muted = true;
  const fired = new Set<string>();
  const live: Array<AudioBufferSourceNode | OscillatorNode> = [];

  function audio(): AudioContext {
    if (!context) {
      context = new AudioContext();
      noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    return context;
  }

  function track<T extends AudioBufferSourceNode | OscillatorNode>(node: T): T {
    live.push(node);
    node.onended = () => {
      const index = live.indexOf(node);
      if (index >= 0) live.splice(index, 1);
    };
    return node;
  }

  function envelope(when: number, peak: number, duration: number): GainNode {
    const ctx = audio();
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), when + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    gain.connect(ctx.destination);
    return gain;
  }

  function clink(when: number, frequency: number, peak = 0.045): void {
    const ctx = audio();
    const tone = track(ctx.createOscillator());
    tone.type = "sine";
    tone.frequency.setValueAtTime(frequency, when);
    tone.frequency.exponentialRampToValueAtTime(Math.max(80, frequency * 0.55), when + 0.09);
    tone.connect(envelope(when, peak, 0.14));
    tone.start(when);
    tone.stop(when + 0.15);

    if (!noise) return;
    const tick = track(ctx.createBufferSource());
    tick.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 2200;
    filter.Q.value = 3.2;
    tick.connect(filter);
    filter.connect(envelope(when, peak * 0.7, 0.05));
    tick.start(when);
    tick.stop(when + 0.06);
  }

  function pour(when: number, duration: number, cutoff: number, peak: number): void {
    const ctx = audio();
    if (!noise) return;
    const source = track(ctx.createBufferSource());
    source.buffer = noise;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(cutoff, when);
    filter.frequency.linearRampToValueAtTime(cutoff * 0.75, when + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(peak, when + 0.08);
    gain.gain.setValueAtTime(peak, when + Math.max(0.12, duration - 0.15));
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    source.start(when);
    source.stop(when + duration + 0.02);
  }

  const cues: Cue[] = [
    ...ICE_TIMES.map((at, index) => ({
      id: `ice-${index}`,
      at,
      play: (when: number) => clink(when, 1280 + index * 70, 0.04),
    })),
    {
      id: "vodka",
      at: POUR.vodka.from,
      play: (when: number) => pour(when, POUR.vodka.to - POUR.vodka.from, 780, 0.04),
    },
    {
      id: "lime",
      at: POUR.lime.from,
      play: (when: number) => {
        for (let i = 0; i < 4; i++) clink(when + i * 0.16, 860 + i * 50, 0.03);
      },
    },
    {
      id: "ginger",
      at: POUR.ginger.from,
      play: (when: number) => {
        pour(when, POUR.ginger.to - POUR.ginger.from, 1500, 0.05);
        for (let i = 0; i < 8; i++) clink(when + 0.45 + i * 0.7, 1700 + (i % 4) * 140, 0.018);
      },
    },
    {
      id: "stir",
      at: 21.85,
      play: (when: number) => pour(when, 1.8, 420, 0.025),
    },
    {
      id: "garnish",
      at: 24.85,
      play: (when: number) => clink(when, 640, 0.035),
    },
  ];

  return {
    get muted() {
      return muted;
    },
    setMuted(next: boolean) {
      muted = next;
      if (!context) return;
      if (muted) {
        this.stop();
        void context.suspend();
      } else {
        void context.resume();
      }
    },
    unlock() {
      const ctx = audio();
      if (!muted && ctx.state === "suspended") void ctx.resume();
    },
    stop() {
      for (const node of live) {
        try {
          node.stop();
        } catch {
          // Already stopped.
        }
      }
      live.length = 0;
    },
    reset() {
      this.stop();
      fired.clear();
    },
    sync(previous: number, next: number) {
      if (next < previous - 0.05) fired.clear();
      if (next > previous + 0.45) {
        for (const cue of cues) {
          if (cue.at <= next) fired.add(cue.id);
        }
        return;
      }
      const when = audio().currentTime + 0.02;
      for (const cue of cues) {
        if (next < cue.at || fired.has(cue.id)) continue;
        fired.add(cue.id);
        if (!muted && previous < cue.at) cue.play(when);
      }
    },
  };
}
