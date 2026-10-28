import type { Theme } from "./types.ts";

export interface ThemeOption {
  value: Theme;
  label: string;
  action: string;
}

export const THEME_OPTIONS: readonly ThemeOption[] = [
  { value: "light", label: "松烟宣纸", action: "theme_light" },
  { value: "parchment", label: "暖砂赭石", action: "theme_parchment" },
  { value: "celadon", label: "天青汝瓷", action: "theme_celadon" },
  { value: "rosewood", label: "暮色绛梅", action: "theme_rosewood" },
  { value: "ivory", label: "月白青金", action: "theme_ivory" },
  { value: "dark", label: "深林松墨", action: "theme_dark" },
  { value: "obsidian", label: "玄武黑曜", action: "theme_obsidian" },
  { value: "abyss", label: "群青深海", action: "theme_abyss" },
];

export function themeFromAction(action: string): Theme | undefined {
  return THEME_OPTIONS.find((option) => option.action === action)?.value;
}

export const PAPER: Record<Theme, string> = {
  light: "#F5F6F2",
  parchment: "#F6EFE4",
  celadon: "#EAF2F3",
  rosewood: "#F3EDF1",
  ivory: "#EEF0F6",
  dark: "#10191B",
  obsidian: "#0C0E10",
  abyss: "#0D1424",
};

export function needsColorSweep(source: Theme, target: Theme): boolean {
  return PAPER[source].toLowerCase() !== PAPER[target].toLowerCase();
}

export const BOUNDARY: Record<Theme, string> = {
  light: "#986632",
  parchment: "#B05A2B",
  celadon: "#2B6E84",
  rosewood: "#8A4566",
  ivory: "#3E588F",
  dark: "#E7B879",
  obsidian: "#BCA789",
  abyss: "#82B4F5",
};

export function isDarkTheme(theme: Theme): boolean {
  return theme === "dark" || theme === "obsidian" || theme === "abyss";
}

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
