import { BACKGROUND_OPTIONS } from "./background.ts";
import { FRAME_RATE_OPTIONS } from "./frame-rate.ts";
import { THEME_OPTIONS } from "./palette.ts";

const actions = new Set([
  ...BACKGROUND_OPTIONS.map(option => option.action),
  ...FRAME_RATE_OPTIONS.map(option => option.action),
  ...THEME_OPTIONS.map(option => option.action),
  "pulse", "reset_defaults", "cancel_confirm", "refresh_content", "retry_content",
  "range06", "range12", "range32", "blur10", "blur16",
  "speed075", "speed100", "speed125", "toggle_blur", "toggle_range", "toggle_motion", "toggle_sound",
]);

export function isContentAction(target: string): boolean {
  return target.startsWith("act:") && actions.has(target.slice(4));
}
