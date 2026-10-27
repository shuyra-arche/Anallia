export type FrameRate = "adaptive" | 30 | 60 | 90 | 120 | "display";
export const FRAME_RATE_OPTIONS: readonly {
  value: FrameRate;
  action: string;
  label: string;
}[] = [
  { value: "adaptive", action: "fpsadaptive", label: "省电自适应" },
  { value: 30, action: "fps30", label: "30 FPS" },
  { value: 60, action: "fps60", label: "60 FPS" },
  { value: 90, action: "fps90", label: "90 FPS" },
  { value: 120, action: "fps120", label: "120 FPS" },
  { value: "display", action: "fpsdisplay", label: "跟随屏幕刷新率" },
];
export const frameRateFromAction = (action: string): FrameRate | undefined =>
  FRAME_RATE_OPTIONS.find((option) => option.action === action)?.value;
export const frameRateLabel = (rate: FrameRate): string =>
  FRAME_RATE_OPTIONS.find((option) => option.value === rate)!.label;
export const frameRateLimit = (rate: FrameRate, animating: boolean): number =>
  rate === "adaptive"
    ? animating
      ? 60
      : 24
    : rate === "display"
      ? Infinity
      : rate;
