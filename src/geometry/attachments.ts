import type { Camera, Hub, Vec, Viewport } from "../core/types.ts";
import type { FieldAttachment } from "../core/attachments.ts";
import { unit, rot } from "../core/math.ts";
import { hubToScreen, material, outwardNormal } from "./field.ts";

/**
 * Section 3.3 & 3.5 — Primary sequence and focus extensions share the content normal side,
 * while global operations occupy the opposite normal side. Adaptive screenSide (1 | -1)
 * selects which material normal points toward the chosen expansion side while preserving
 * the opposite-side relation.
 */
export function contentMaterialSide(
  hub: Hub,
  focusParameter: number,
  camera: Camera,
  screenSide: 1 | -1 = 1,
): 1 | -1 {
  const normal = rot(
    outwardNormal(hub, focusParameter),
    (camera.rotation * Math.PI) / 180,
  );
  if (Math.abs(normal.x) <= 0.18) return screenSide;
  return normal.x * screenSide >= 0 ? 1 : -1;
}

export interface ProjectedAttachment {
  hinge: Vec;
  position: Vec;
  normal: Vec;
  degree: number;
}
export function projectAttachment(
  hub: Hub,
  attachment: FieldAttachment,
  camera: Camera,
  viewport: Viewport,
  ordinaryMaterialSide: 1 | -1 = 1,
): ProjectedAttachment {
  if (attachment.anchor.hostHub !== hub.id)
    throw new Error("Attachment host mismatch");
  const s = attachment.anchor.parameter;
  const sign =
    attachment.side === "content"
      ? ordinaryMaterialSide
      : -ordinaryMaterialSide;
  const hinge = hubToScreen(hub, material(hub, s), camera, viewport);
  const position = hubToScreen(
    hub,
    material(hub, s, attachment.distance * sign),
    camera,
    viewport,
  );
  const normal = unit(
    rot(outwardNormal(hub, s), (camera.rotation * Math.PI) / 180),
  );
  const degree = (Math.atan2(normal.y, normal.x) * 180) / Math.PI;
  return { hinge, position, normal, degree };
}
