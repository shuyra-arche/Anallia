import { FRAME_RATE_OPTIONS, type FrameRate } from "../core/frame-rate.ts";
const key = "shuyra.frame-rate";
type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;
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
