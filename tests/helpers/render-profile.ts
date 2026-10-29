import type { RenderSample, RenderStage } from "../../src/core/render-profile.ts";

const p95 = (values: number[]): number => {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.max(0, Math.ceil(ordered.length * 0.95) - 1)] ?? 0;
};

function group(samples: RenderSample[]) {
  const total = samples.reduce((sum, sample) => sum + sample.total, 0);
  const names = new Set(samples.flatMap(sample => Object.keys(sample.stages) as RenderStage[]));
  const stages = Object.fromEntries([...names].map(name => {
    const values = samples.flatMap(sample => sample.stages[name] === undefined ? [] : [sample.stages[name]!]);
    const sum = values.reduce((sum, value) => sum + value, 0);
    return [name, { samples: values.length, p95: p95(values), mean: sum / values.length, sharePercent: total > 0 ? 100 * sum / total : 0 }];
  }));
  return { samples: samples.length, totalP95: p95(samples.map(sample => sample.total)), stages };
}

export function summarizeRenderProfiles(samples: RenderSample[]) {
  return {
    ...group(samples),
    full: group(samples.filter(sample => sample.path === "full")),
    cached: group(samples.filter(sample => sample.path === "cached")),
    slowFrames: [...samples].sort((a, b) => b.total - a.total).slice(0, 5),
  };
}
