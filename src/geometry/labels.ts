import type { Command, Vec } from "../core/types.ts";
import type { FieldAttachment } from "../core/attachments.ts";
import type { HitRegion, LabelFrame } from "../core/graphics.ts";
import { classifyLabelContent, resolveIconToken } from "../core/icons.ts";
import { resolveSymbolKind } from "../core/symbol-morph.ts";

export interface LabelInput {
  hubId: string;
  key: string;
  name: string;
  at: Vec;
  anchor: Vec;
  kind: string;
  degree: number;
  zoom: number;
  command: Command;
  aria: string;
  alpha: number;
  page: LabelFrame["page"];
  attachment?: FieldAttachment;
  interaction?: LabelFrame["interaction"];
  activity: number;
}

/** Positions use screen coordinates; offsets and dimensions precede one zoom. */
export function evaluateLabel(input: LabelInput): LabelFrame {
  const {
    hubId,
    key,
    name,
    at,
    anchor,
    kind,
    zoom,
    command,
    aria,
    alpha,
    page,
    attachment,
    interaction,
    activity,
  } = input;
  let { degree } = input;
  while (degree > 90) degree -= 180;
  while (degree < -90) degree += 180;
  const id = `${hubId}:${key}`;
  const interactive = !page || page.interactive;
  const deltaX = (at.x - anchor.x) / zoom,
    deltaY = (at.y - anchor.y) / zoom;
  const symbolKind =
    attachment?.symbolKind ??
    (attachment?.scope === "global" ? resolveSymbolKind(name) : undefined);
  const iconToken = attachment?.icon ?? resolveIconToken(name);
  const contentKind =
    attachment?.contentKind ??
    (symbolKind || iconToken ? "icon" : classifyLabelContent(name));
  const width =
    symbolKind || iconToken ? 44 : Math.max(44, name.length * 14 + 20);
  return {
    id,
    command,
    aria,
    hubId,
    attachment,
    glyph: name,
    visual: kind,
    contentKind,
    layout: {
      hinge: { ...anchor },
      position: { ...at },
      offset: { x: deltaX, y: deltaY },
      degree,
      width,
      height: 44,
      scale: zoom,
    },
    opacity: alpha,
    interactive,
    localScrollHub: key.startsWith("local:") ? hubId : undefined,
    icon: iconToken,
    symbolKind,
    symbolGeometry: attachment?.symbolGeometry,
    symbolActivity: symbolKind ? activity : undefined,
    interaction: interaction ? { ...interaction } : undefined,
    page,
    linkTarget: command.type === "navigate" ? command.target : undefined,
  };
}

export function labelHitRegion(label: LabelFrame): HitRegion | null {
  if (!label.interactive) return null;
  return {
    id: label.id,
    command: label.command,
    aria: label.aria,
    hubId: label.hubId,
    chapterId:
      label.attachment?.role === "ordinary" ? label.attachment.id : undefined,
    localScrollHub: label.localScrollHub,
    graspKind: "label",
    shape: {
      type: "rect",
      x: label.layout.position.x,
      y: label.layout.position.y,
      width: label.layout.width * label.layout.scale,
      height: label.layout.height * label.layout.scale,
      rotation: label.layout.degree,
    },
    priority: 30,
  };
}
