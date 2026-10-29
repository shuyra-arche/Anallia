import type { FieldState } from "../core/types.ts";
import type { LoadingSnapshot } from "../core/loading.ts";
import { geometryForSnapshot } from "./loading.ts";
import type { LoadingGeometry } from "../geometry/loading.ts";
import { hubToScreen, material, nodeS, outwardNormal } from "../geometry/field.ts";
import { rot } from "../core/math.ts";
import type { Catalog } from "../content/catalog.ts";

/** Anchors task feedback to the target's material frame; it never moves the camera. */
export class TaskGeometry {
  private taskId = "";
  private scale = 0.55;
  private previousTime = 0;

  update(snapshot: LoadingSnapshot | null, state: FieldState, catalog: Catalog, now: number): LoadingGeometry | null {
    if (!snapshot) { this.taskId = ""; return null; }
    if (this.taskId !== snapshot.id) {
      this.taskId = snapshot.id;
      this.scale = snapshot.firstReadable ? 0.18 : 0.55;
      this.previousTime = now;
    }
    const dt = Math.min(50, Math.max(0, now - this.previousTime));
    this.previousTime = now;
    const targetScale = snapshot.firstReadable ? 0.18 : 0.55;
    this.scale += (targetScale - this.scale) * (1 - Math.exp(-dt / 70));
    const hub = state.hubs[snapshot.hubId] ?? state.hubs[state.focus];
    const selected = snapshot.chapterId ?? hub.path.at(-1)!;
    const siblings = catalog.siblings(selected, state.searchResults);
    const count = siblings.length;
    const index = Math.max(0, siblings.findIndex(node => node.id === selected));
    const along = nodeS(hub, index, count, state.camera, state.viewport);
    const tangentPoint = hubToScreen(hub, material(hub, along), state.camera, state.viewport);
    const normal = rot(outwardNormal(hub, along), state.camera.rotation * Math.PI / 180);
    const scale = this.scale * state.camera.z;
    const angle = Math.atan2(normal.y, normal.x) + Math.PI;
    const geometry = geometryForSnapshot(snapshot, {
      anchor: { x: tangentPoint.x - normal.x * 140 * scale, y: tangentPoint.y - normal.y * 140 * scale },
      angle, scale, theme: hub.id === state.focus ? state.theme : hub.theme,
    });
    const entrance = snapshot.reducedMotion ? 1 : snapshot.enter;
    for (const shape of [...geometry.circles, ...geometry.arcs, ...geometry.points]) shape.opacity *= entrance;
    return geometry;
  }
}
