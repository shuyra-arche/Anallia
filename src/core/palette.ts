import type { Theme } from "./types.ts";

export const PAPER: Record<Theme, string> = {
  light: "#F5F6F2",
  dark: "#10191B",
  obsidian: "#0C0E10",
};
export function needsColorSweep(source: Theme, target: Theme): boolean {
  return PAPER[source].toLowerCase() !== PAPER[target].toLowerCase();
}
export const BOUNDARY: Record<Theme, string> = {
  light: "#986632",
  dark: "#E7B879",
  obsidian: "#BCA789",
};

export function blendHex(a: string, b: string, t: number): string {
  const p = Math.min(1, Math.max(0, t));
  return (
    "#" +
    [1, 3, 5]
      .map((i) => {
        const v = Math.round(
          parseInt(a.slice(i, i + 2), 16) * (1 - p) +
            parseInt(b.slice(i, i + 2), 16) * p,
        );
        return v.toString(16).padStart(2, "0");
      })
      .join("")
  );
}
