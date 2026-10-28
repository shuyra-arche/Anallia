import type { Camera, Theme, Vec, Viewport } from "../core/types.ts";
import type { BackgroundMode } from "../core/background.ts";
import type { WaveImpulse } from "./flow-field.ts";
import { Ambient } from "./ambient.ts";
import { Stars } from "./stars.ts";
import { svg } from "../rendering/dom.ts";
export class Background {
  private readonly flowRoot: SVGGElement;
  private readonly starsRoot: SVGGElement;
  private readonly flow: Ambient;
  private readonly stars: Stars;
  constructor(root: SVGGElement) {
    this.flowRoot = svg("g", root, { class: "background-flow" });
    this.starsRoot = svg("g", root, { class: "background-stars" });
    this.flow = new Ambient(this.flowRoot);
    this.stars = new Stars(this.starsRoot);
  }
  render(
    mode: BackgroundMode,
    camera: Camera,
    viewport: Viewport,
    elapsed: number,
    impulses: readonly WaveImpulse[],
    overview: boolean,
    loading: boolean,
    theme: Theme,
    reduced: boolean,
    quiet?: Vec,
  ) {
    const flowDisplay = mode === "flow" ? "" : "none",
      starsDisplay = mode === "stars" ? "" : "none";
    if (this.flowRoot.style.display !== flowDisplay)
      this.flowRoot.style.display = flowDisplay;
    if (this.starsRoot.style.display !== starsDisplay)
      this.starsRoot.style.display = starsDisplay;
    if (mode === "flow")
      this.flow.render(
        camera,
        viewport,
        reduced ? 0 : elapsed,
        impulses,
        overview,
        loading,
        quiet,
      );
    else if (mode === "stars")
      this.stars.render(
        camera,
        viewport,
        elapsed,
        theme,
        reduced,
        loading,
        quiet,
      );
  }
}
