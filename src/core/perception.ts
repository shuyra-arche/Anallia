import type { Catalog } from "../content/catalog.ts";
import type { FieldState, Hub } from "./types.ts";

export type DiscoveryStage = "threshold" | "orienting" | "immersed";
export type HubAttentionTier = "focused" | "resonating" | "related" | "ambient";
export type HubSemanticRelation = "self" | "parent" | "child" | "ref" | "none";
export type HubArchetype =
  | "origin"
  | "spine"
  | "oblique"
  | "portal"
  | "vortex"
  | "cosmos"
  | "manuscript"
  | "instrument"
  | "lens";

export interface HubSignature {
  id: string;
  archetype: HubArchetype;
  /** Companion structural ring / rail offset in local hub units. */
  auraOffset: number;
  /** Distinct dash cadence for the companion structural ring/rail. */
  auraDash: string;
  /** Primary stroke dash pattern when unfocused ("" for solid). */
  curveDash: string;
  /** Tick style multiplier for interior graduations. */
  tickScale: number;
  /** Signature color in light palettes. */
  lightStroke: string;
  /** Signature color in dark palettes. */
  darkStroke: string;
  /** Signature highlight accent. */
  accentColor: string;
}

export const HUB_SIGNATURES: Record<string, HubSignature> = {
  A: {
    id: "A",
    archetype: "origin",
    auraOffset: 15,
    auraDash: "",
    curveDash: "",
    tickScale: 1.15,
    lightStroke: "#256B63",
    darkStroke: "#7AD4C4",
    accentColor: "#B87333",
  },
  B: {
    id: "B",
    archetype: "spine",
    auraOffset: -13,
    auraDash: "10 5",
    curveDash: "",
    tickScale: 1.0,
    lightStroke: "#2E6278",
    darkStroke: "#7BC2DE",
    accentColor: "#3A88A8",
  },
  C: {
    id: "C",
    archetype: "oblique",
    auraOffset: -10,
    auraDash: "5 4",
    curveDash: "14 4",
    tickScale: 0.9,
    lightStroke: "#A64B2A",
    darkStroke: "#E68A65",
    accentColor: "#C86239",
  },
  D: {
    id: "D",
    archetype: "portal",
    auraOffset: 19,
    auraDash: "12 4 2 4",
    curveDash: "",
    tickScale: 1.25,
    lightStroke: "#386B66",
    darkStroke: "#88CEC0",
    accentColor: "#E7B879",
  },
  E: {
    id: "E",
    archetype: "vortex",
    auraOffset: 13,
    auraDash: "16 6",
    curveDash: "18 5 3 5",
    tickScale: 1.05,
    lightStroke: "#245C78",
    darkStroke: "#6EB8DC",
    accentColor: "#2B7A9E",
  },
  L: {
    id: "L",
    archetype: "cosmos",
    auraOffset: 24,
    auraDash: "3 5",
    curveDash: "",
    tickScale: 1.35,
    lightStroke: "#6B5E4C",
    darkStroke: "#D2BE9E",
    accentColor: "#C9A875",
  },
  M: {
    id: "M",
    archetype: "manuscript",
    auraOffset: -16,
    auraDash: "",
    curveDash: "",
    tickScale: 0.95,
    lightStroke: "#783A59",
    darkStroke: "#D88AB2",
    accentColor: "#9E4B73",
  },
  S: {
    id: "S",
    archetype: "instrument",
    auraOffset: 11,
    auraDash: "2 4",
    curveDash: "6 3",
    tickScale: 1.1,
    lightStroke: "#8C6228",
    darkStroke: "#E2B26B",
    accentColor: "#D49542",
  },
  Q: {
    id: "Q",
    archetype: "lens",
    auraOffset: 17,
    auraDash: "8 3 2 3",
    curveDash: "",
    tickScale: 1.1,
    lightStroke: "#344E86",
    darkStroke: "#8EB2F8",
    accentColor: "#4A6BB3",
  },
};

export interface HubPerception {
  hubId: string;
  tier: HubAttentionTier;
  relation: HubSemanticRelation;
  signature: HubSignature;
  curveOpacity: number;
  auraOpacity: number;
  traceOpacity: number;
  beaconOpacity: number;
  strokeWidthScale: number;
  dotScale: number;
}

export interface FieldPerception {
  stage: DiscoveryStage;
  focusedHubId: string;
  resonatingHubId: string | null;
  resonatingTargetId: string | null;
  linkedHubIds: string[];
  hubs: Record<string, HubPerception>;
}

/**
 * Extract all cross-hub chapter target IDs referenced by a chapter's local `refs`
 * and inline `{label|target}` buttons in its current presentation text.
 */
export function collectChapterTargetIds(
  state: FieldState,
  catalog: Catalog,
  hub: Hub = state.hubs[state.focus],
): string[] {
  const currentId = hub.path.at(-1);
  if (!currentId || !catalog.chapters.has(currentId)) return [];
  const chapter = catalog.get(currentId);
  const targets = new Set<string>();
  for (const ref of chapter.refs) {
    if (catalog.chapters.has(ref.target)) targets.add(ref.target);
  }
  const presentation = hub.morph > 0.5 ? "line" : "circle";
  for (const reference of catalog.document(chapter.id, presentation).references) {
    const id = reference.target;
    if (!id.startsWith("act:") && catalog.chapters.has(id)) {
      targets.add(id);
    }
  }
  return [...targets];
}

/**
 * Determine the progressive cognitive onboarding stage purely from exploration state:
 * - "threshold": initial arrival at α₀ before any scroll, morph, or navigation.
 * - "orienting": first interactions on the origin hub (morphing α₀ or stepping along α).
 * - "immersed": deeper recursive exploration, cross-hub travel, or overview inspection.
 */
export function resolveDiscoveryStage(state: FieldState): DiscoveryStage {
  if (state.overview || state.focus !== "A" || state.history.length >= 2) {
    return "immersed";
  }
  const hub = state.hubs[state.focus];
  if (!hub) return "immersed";
  if (
    state.history.length === 0 &&
    hub.path.length === 1 &&
    Math.abs(hub.scroll) < 0.05 &&
    hub.morph < 0.05 &&
    hub.targetMorph < 0.05 &&
    hub.textOffset < 1 &&
    !state.passage &&
    !state.morphTurn &&
    !state.contentTurn
  ) {
    return "threshold";
  }
  if (hub.path.length <= 2 && state.history.length <= 1) {
    return "orienting";
  }
  return "immersed";
}

/**
 * Compute the relational attention hierarchy and per-hub structural signature across all hubs.
 */
export function evaluatePerception(
  state: FieldState,
  catalog: Catalog,
  hoveredTarget: string | null = null,
): FieldPerception {
  const activeHubId = state.passage ? state.passage.target : state.focus;
  const activeHub = state.hubs[activeHubId] ?? state.hubs[state.focus];
  const stage = resolveDiscoveryStage(state);

  const refHubIds = new Set<string>();
  for (const targetId of collectChapterTargetIds(state, catalog, activeHub)) {
    const ch = catalog.chapters.get(targetId);
    if (ch && ch.hub !== activeHub.id) {
      refHubIds.add(ch.hub);
    }
  }

  let resonatingHubId: string | null = null;
  let resonatingTargetId: string | null = null;
  if (hoveredTarget) {
    if (hoveredTarget.startsWith("hub:")) {
      const hid = hoveredTarget.slice(4);
      if (state.hubs[hid]) resonatingHubId = hid;
    } else if (catalog.chapters.has(hoveredTarget)) {
      const ch = catalog.get(hoveredTarget);
      resonatingTargetId = ch.id;
      resonatingHubId = ch.hub;
    }
  }

  const linkedHubIds: string[] = [];
  const hubs: Record<string, HubPerception> = {};

  for (const h of Object.values(state.hubs)) {
    const signature = HUB_SIGNATURES[h.id] ?? HUB_SIGNATURES.A;
    let relation: HubSemanticRelation = "none";
    if (h.id === activeHub.id) {
      relation = "self";
    } else if (activeHub.parentHub === h.id) {
      relation = "parent";
    } else if (h.parentHub === activeHub.id) {
      relation = "child";
    } else if (refHubIds.has(h.id)) {
      relation = "ref";
    }
    if (relation === "parent" || relation === "child" || relation === "ref") {
      linkedHubIds.push(h.id);
    }

    const isFocused = h.id === state.focus && !state.overview && !state.loading;
    const isResonating = !isFocused && resonatingHubId === h.id && !state.loading;
    const isRelated = !isFocused && relation !== "none";

    const tier: HubAttentionTier = isFocused
      ? "focused"
      : isResonating
        ? "resonating"
        : isRelated
          ? "related"
          : "ambient";

    let curveOpacity = 0.22;
    let auraOpacity = 0.08;
    let traceOpacity = 0.2;
    let beaconOpacity = 0.25;
    let strokeWidthScale = 0.85;
    let dotScale = 1;

    if (state.loading) {
      curveOpacity = 0.08;
      auraOpacity = 0;
      traceOpacity = 0.08;
      beaconOpacity = 0;
    } else if (state.overview) {
      if (isResonating) {
        curveOpacity = 0.98;
        auraOpacity = 0.56;
        traceOpacity = 0.88;
        beaconOpacity = 1;
        strokeWidthScale = 1.65;
        dotScale = 1.45;
      } else if (h.id === state.focus) {
        curveOpacity = 0.92;
        auraOpacity = 0.45;
        traceOpacity = 0.78;
        beaconOpacity = 0.95;
        strokeWidthScale = 1.5;
        dotScale = 1.25;
      } else if (isRelated) {
        curveOpacity = 0.78;
        auraOpacity = 0.32;
        traceOpacity = 0.64;
        beaconOpacity = 0.86;
        strokeWidthScale = 1.25;
        dotScale = 1.15;
      } else {
        curveOpacity = 0.42;
        auraOpacity = 0.14;
        traceOpacity = 0.3;
        beaconOpacity = 0.55;
        strokeWidthScale = 0.92;
      }
    } else {
      if (isFocused) {
        curveOpacity = 1;
        auraOpacity = 0.34;
        traceOpacity = 0;
        beaconOpacity = 0;
        strokeWidthScale = 1.75;
      } else if (isResonating) {
        curveOpacity = 0.92;
        auraOpacity = 0.52;
        traceOpacity = 0.82;
        beaconOpacity = 0.96;
        strokeWidthScale = 1.55;
        dotScale = 1.45;
      } else if (isRelated) {
        curveOpacity = stage === "threshold" ? 0.54 : 0.68;
        auraOpacity = stage === "threshold" ? 0.22 : 0.32;
        traceOpacity = stage === "threshold" ? 0.48 : 0.62;
        beaconOpacity = stage === "threshold" ? 0.68 : 0.82;
        strokeWidthScale = 1.22;
        dotScale = 1.2;
      } else {
        curveOpacity = stage === "threshold" ? 0.12 : 0.18;
        auraOpacity = 0.05;
        traceOpacity = stage === "threshold" ? 0.1 : 0.16;
        beaconOpacity = stage === "threshold" ? 0.16 : 0.26;
        strokeWidthScale = 0.72;
        dotScale = 0.82;
      }
    }

    hubs[h.id] = {
      hubId: h.id,
      tier,
      relation,
      signature,
      curveOpacity,
      auraOpacity,
      traceOpacity,
      beaconOpacity,
      strokeWidthScale,
      dotScale,
    };
  }

  return {
    stage,
    focusedHubId: activeHub.id,
    resonatingHubId,
    resonatingTargetId,
    linkedHubIds,
    hubs,
  };
}
