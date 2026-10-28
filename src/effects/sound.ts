import type { FieldState } from "../core/types.ts";
import { clamp, ease, mix, rot } from "../core/math.ts";
import { hubToScreen, material, nodeS, outwardNormal } from "../geometry/field.ts";

/**
 * Harmonic fundamental frequencies (in Hz) for each Hub in the Shuyra Field.
 * Shifted to a clear, airy upper-middle register (A4 = 440 Hz lattice) with
 * high-pass filtering so there is zero low-frequency droning or humming ("无低频嗡鸣").
 */
export const HUB_FUNDAMENTAL_HZ: Record<string, number> = {
  A: 440.0, // A4
  B: 495.0, // B4 (9/8)
  C: 550.0, // C#5 (5/4)
  D: 392.0, // G4
  E: 586.67, // D5 (4/3)
  L: 330.0, // E4
  M: 523.25, // C5
  S: 660.0, // E5 (3/2)
  Q: 784.0, // G5
};

const MODAL_RATIOS = [1, 9 / 8, 5 / 4, 4 / 3, 3 / 2, 5 / 3, 15 / 8, 2];

export interface SoundSynthesisFrame {
  enabled: boolean;
  fundamentalHz: number;
  morphRatio: number;
  voiceHz: number;
  filterCutoffHz: number;
  harmonicMix: number;
  stereoPan: number;
  continuousGain: number;
}

export function computeSoundFrame(
  state: FieldState,
  morphVelocity = 0,
  scrollVelocity = 0,
): SoundSynthesisFrame {
  const enabled = state.settings.sound !== false && !state.loading;
  const hub = state.hubs[state.focus];
  const baseHz = HUB_FUNDAMENTAL_HZ[state.focus] ?? 440;
  let fundamentalHz = baseHz;
  let effectiveMorph = hub ? clamp(hub.morph, 0, 1) : 0;

  if (state.passage) {
    const p = ease(clamp(state.passage.phase, 0, 1));
    const fromHz = HUB_FUNDAMENTAL_HZ[state.passage.source] ?? baseHz;
    const toHz = HUB_FUNDAMENTAL_HZ[state.passage.target] ?? baseHz;
    fundamentalHz = mix(fromHz, toHz, p);
    effectiveMorph = mix(state.passage.from.morph, state.passage.to.morph, p);
  }

  const morphRatio = 1 + 0.5 * ease(effectiveMorph);
  const chapterIndex = hub ? Math.max(0, Math.round(hub.scroll)) : 0;
  const modalStep = MODAL_RATIOS[chapterIndex % MODAL_RATIOS.length];
  const octaveLift = chapterIndex >= MODAL_RATIOS.length ? 1.2 : 1;
  const voiceHz = fundamentalHz * morphRatio * (0.88 + 0.12 * modalStep * octaveLift);

  let filterCutoffHz = mix(680, 2240, ease(effectiveMorph));
  if (state.contentTurn) {
    const edgeOcclusion = Math.abs(Math.cos(state.contentTurn.phase * Math.PI));
    filterCutoffHz *= 0.42 + 0.58 * edgeOcclusion;
  } else if (state.passage && (state.passage.kind === "remote" || state.passage.kind === "loading")) {
    const singularity = Math.sin(state.passage.phase * Math.PI);
    filterCutoffHz = mix(filterCutoffHz, 2600, singularity * 0.6);
  }

  const harmonicMix = clamp(0.12 + 0.68 * effectiveMorph, 0, 1);

  let stereoPan = 0;
  if (hub) {
    const along = nodeS(hub, hub.scroll, Math.max(1, hub.path.length), state.camera, state.viewport);
    const anchorScreen = hubToScreen(hub, material(hub, along, 76), state.camera, state.viewport);
    const n = rot(outwardNormal(hub, along), (state.camera.rotation * Math.PI) / 180);
    const screenNormX =
      (anchorScreen.x - state.viewport.width / 2) / Math.max(1, state.viewport.width / 2);
    stereoPan = clamp(screenNormX * 0.5 + n.x * 0.3, -0.8, 0.8);
  }

  const motionEnergy = clamp(
    Math.abs(morphVelocity) * 1.1 +
      Math.abs(scrollVelocity) * 0.25 +
      (state.morphTurn ? 0.45 * Math.sin(state.morphTurn.phase * Math.PI) : 0) +
      (state.passage ? 0.4 * Math.sin(state.passage.phase * Math.PI) : 0) +
      (state.contentTurn ? 0.35 * Math.sin(state.contentTurn.phase * Math.PI) : 0),
    0,
    1,
  );

  // Kept strictly as a whisper-light envelope metric (no continuous oscillator drone is run).
  const continuousGain = enabled ? motionEnergy * 0.015 : 0;

  return {
    enabled,
    fundamentalHz,
    morphRatio,
    voiceHz,
    filterCutoffHz,
    harmonicMix,
    stereoPan,
    continuousGain,
  };
}

/**
 * Transient-only crystalline acoustic synthesizer:
 * Produces zero continuous background hum/drone. Discrete geometric events
 * (chapter steps, circle↔line morphs, page turns, cross-hub passages) emit
 * delicate, short-decay harmonic glass chimes high-passed above 340 Hz.
 */
export class GeometricSoundscape {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private highpass: BiquadFilterNode | null = null;

  private lastMorph: number | null = null;
  private lastScroll: number | null = null;
  private lastScrollStep: number | null = null;
  private lastFocus: string | null = null;
  private lastOverview: boolean | null = null;
  private lastMorphTurnKey = "";
  private lastContentTurnKey = "";
  private lastPassageKey = "";

  unlock(): void {
    if (typeof window === "undefined") return;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;
    if (!this.ctx) {
      try {
        const ctx = new AudioCtx();
        const highpass = ctx.createBiquadFilter();
        highpass.type = "highpass";
        highpass.frequency.value = 340;
        highpass.Q.value = 0.7;

        const master = ctx.createGain();
        master.gain.value = 0.55;
        highpass.connect(master);
        master.connect(ctx.destination);

        this.ctx = ctx;
        this.highpass = highpass;
        this.masterGain = master;
      } catch {
        /* AudioContext creation blocked or unsupported in environment. */
      }
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
  }

  private triggerChime(
    freqHz: number,
    pan: number,
    durationSec = 0.11,
    peakGain = 0.014,
  ): void {
    if (!this.ctx || !this.highpass || this.ctx.state !== "running") return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const env = this.ctx.createGain();
    const panner = this.ctx.createStereoPanner();

    osc.type = "sine";
    const safeHz = clamp(freqHz, 320, 2400);
    osc.frequency.setValueAtTime(safeHz, now);
    osc.frequency.exponentialRampToValueAtTime(safeHz * 0.997, now + durationSec);

    filter.type = "lowpass";
    filter.frequency.setValueAtTime(Math.min(2600, safeHz * 2.6), now);
    filter.frequency.exponentialRampToValueAtTime(
      Math.max(420, safeHz * 1.15),
      now + durationSec,
    );

    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(peakGain, now + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);

    panner.pan.setValueAtTime(clamp(pan, -0.8, 0.8), now);

    osc.connect(filter);
    filter.connect(env);
    env.connect(panner);
    panner.connect(this.highpass);

    osc.start(now);
    osc.stop(now + durationSec + 0.015);
  }

  private triggerInterval(
    fromHz: number,
    toHz: number,
    pan: number,
    durationSec = 0.16,
  ): void {
    if (!this.ctx || !this.highpass || this.ctx.state !== "running") return;
    this.triggerChime(fromHz, pan * 0.8, durationSec * 0.7, 0.013);
    const ctx = this.ctx;
    const now = ctx.currentTime + 0.055;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    const panner = this.ctx.createStereoPanner();

    const safeToHz = clamp(toHz, 340, 2400);
    osc.type = "sine";
    osc.frequency.setValueAtTime(safeToHz, now);

    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(0.014, now + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);

    panner.pan.setValueAtTime(clamp(pan, -0.8, 0.8), now);

    osc.connect(env);
    env.connect(panner);
    panner.connect(this.highpass);

    osc.start(now);
    osc.stop(now + durationSec + 0.015);
  }

  update(state: FieldState, dtMs: number): SoundSynthesisFrame {
    const hub = state.hubs[state.focus];
    const dtSec = Math.max(0.001, dtMs / 1000);
    const morphVel =
      this.lastMorph !== null && hub && this.lastFocus === state.focus
        ? (hub.morph - this.lastMorph) / dtSec
        : 0;
    const scrollVel =
      this.lastScroll !== null && hub && this.lastFocus === state.focus
        ? (hub.scroll - this.lastScroll) / dtSec
        : 0;

    const frame = computeSoundFrame(state, morphVel, scrollVel);

    if (this.ctx && this.ctx.state === "running" && this.masterGain) {
      const now = this.ctx.currentTime;
      this.masterGain.gain.setTargetAtTime(frame.enabled ? 0.55 : 0, now, 0.025);

      if (frame.enabled && hub) {
        const currentStep = Math.round(hub.scroll);
        if (
          this.lastFocus === state.focus &&
          this.lastScrollStep !== null &&
          currentStep !== this.lastScrollStep
        ) {
          const stepRatio =
            MODAL_RATIOS[Math.abs(currentStep) % MODAL_RATIOS.length];
          this.triggerChime(
            frame.fundamentalHz * (0.85 + 0.15 * stepRatio) * (1 + 0.18 * hub.morph),
            frame.stereoPan,
            0.095,
            0.013,
          );
        }

        const mt = state.morphTurn;
        const mtKey = mt ? `${mt.hub}:${mt.from}->${mt.to}:${mt.started}` : "";
        if (mt && mtKey !== this.lastMorphTurnKey) {
          this.lastMorphTurnKey = mtKey;
          const f0 = frame.fundamentalHz;
          if (mt.to > mt.from) {
            this.triggerInterval(f0, f0 * 1.25, frame.stereoPan, 0.16);
          } else {
            this.triggerInterval(f0 * 1.25, f0, frame.stereoPan, 0.16);
          }
        } else if (!mt) {
          this.lastMorphTurnKey = "";
        }

        const ct = state.contentTurn;
        const ctKey = ct ? `${ct.hub}:${ct.from}->${ct.to}:${ct.started}` : "";
        if (ct && ctKey !== this.lastContentTurnKey) {
          this.lastContentTurnKey = ctKey;
          const f0 = frame.fundamentalHz;
          if (ct.direction > 0) {
            this.triggerInterval(f0, f0 * (9 / 8), frame.stereoPan, 0.14);
          } else {
            this.triggerInterval(f0 * (9 / 8), f0, frame.stereoPan, 0.14);
          }
        } else if (!ct) {
          this.lastContentTurnKey = "";
        }

        const pas = state.passage;
        const pasKey = pas ? `${pas.source}->${pas.target}:${pas.started}` : "";
        if (pas && pasKey !== this.lastPassageKey) {
          this.lastPassageKey = pasKey;
          const fromHz = HUB_FUNDAMENTAL_HZ[pas.source] ?? 440;
          const toHz = HUB_FUNDAMENTAL_HZ[pas.target] ?? 523.25;
          this.triggerInterval(fromHz, toHz, frame.stereoPan, 0.18);
        } else if (!pas) {
          this.lastPassageKey = "";
        }

        if (this.lastOverview !== null && this.lastOverview !== state.overview) {
          const f0 = frame.fundamentalHz;
          if (state.overview) {
            this.triggerInterval(f0, f0 * 0.8, 0, 0.16);
          } else {
            this.triggerInterval(f0 * 0.8, f0, frame.stereoPan, 0.16);
          }
        }
      }
    }

    this.lastMorph = hub ? hub.morph : null;
    this.lastScroll = hub ? hub.scroll : null;
    this.lastScrollStep = hub ? Math.round(hub.scroll) : null;
    this.lastFocus = state.focus;
    this.lastOverview = state.overview;

    return frame;
  }
}
