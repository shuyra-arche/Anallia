export const BACKGROUND_OPTIONS = [
  { value: "flow", label: "流场", action: "background_flow" },
  { value: "stars", label: "星空", action: "background_stars" },
  { value: "none", label: "关闭", action: "background_none" },
] as const;
export type BackgroundMode = (typeof BACKGROUND_OPTIONS)[number]["value"];
export function backgroundFromAction(
  action: string,
): BackgroundMode | undefined {
  return BACKGROUND_OPTIONS.find((option) => option.action === action)?.value;
}
