import { FRAME_RATE_OPTIONS, type FrameRate } from "../core/frame-rate.ts";
import { BACKGROUND_OPTIONS, type BackgroundMode } from "../core/background.ts";
const key = "shuyra.frame-rate";
type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;
export function readBackground(storage?: PreferenceStorage): BackgroundMode {
  try {
    const value = (storage ?? window.localStorage).getItem("shuyra.background");
    return (
      BACKGROUND_OPTIONS.find((option) => option.value === value)?.value ??
      "flow"
    );
  } catch {
    return "flow";
  }
}
export function saveBackground(
  value: BackgroundMode,
  storage?: PreferenceStorage,
): void {
  try {
    (storage ?? window.localStorage).setItem("shuyra.background", value);
  } catch {
    /* Background choice remains available in this session without storage. */
  }
}
export function readFrameRate(storage?: PreferenceStorage): FrameRate {
  try {
    const value = (storage ?? window.localStorage).getItem(key);
    return (
      FRAME_RATE_OPTIONS.find((option) => String(option.value) === value)
        ?.value ?? "adaptive"
    );
  } catch {
    return "adaptive";
  }
}
export function saveFrameRate(
  value: FrameRate,
  storage?: PreferenceStorage,
): void {
  try {
    (storage ?? window.localStorage).setItem(key, String(value));
  } catch {
    /* Preferences are optional when browser storage is unavailable. */
  }
}
