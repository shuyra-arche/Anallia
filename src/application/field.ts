import { frameRateFromAction, frameRateLabel } from "../core/frame-rate.ts";
import type {
  Camera,
  Command,
  FieldState,
  Snapshot,
  Vec,
  Viewport,
} from "../core/types.ts";
import {
  clamp,
  ease,
  mix,
  unwrapAngle,
  rot,
  sub,
  add,
  mul,
} from "../core/math.ts";
import {
  frameFor,
  overviewCamera,
  screenToWorld,
  orbitCamera,
} from "../geometry/field.ts";
import { Catalog } from "../content/catalog.ts";
export class Field {
  readonly state: FieldState;
  readonly impulses: { center: Vec; started: number; maxRadius: number }[] = [];
  private tween: {
    start: Camera;
    end: Camera;
    started: number;
    duration: number;
  } | null = null;
  private follow = false;
  private now = 0;
  private systemReducedMotion: boolean;
  private loadingTheme: FieldState["theme"] = "light";
  readonly catalog: Catalog;
  constructor(catalog: Catalog, viewport: Viewport, reducedMotion = false) {
    this.catalog = catalog;
    this.systemReducedMotion = reducedMotion;
    const focus = catalog.definitions[0].id;
    this.state = {
      hubs: Object.fromEntries(
        catalog.definitions.map((h) => [
          h.id,
          {
            ...h,
            center: { ...h.center },
            targetMorph: h.morph,
            fold: 0,
            scroll: 0,
            scrollTarget: 0,
            path: [h.root],
          },
        ]),
      ),
      focus,
      overview: false,
      theme: catalog.definitions[0].theme,
      camera: { x: 0, y: 0, z: 1, rotation: 0 },
      viewport,
      settings: {
        speed: 1,
        range: 0.62,
        blur: 1,
        reducedMotion,
        frameRate: "adaptive",
      },
      history: [],
      passage: null,
      loading: false,
      description:
        "Shuyra · 滚动阅读 · Alt/Ctrl + 滚轮缩放 · 点击当前标签切换圆／线 · ⊙ 全域观察 · ⌕ 检索枢",
      elapsed: 0,
      searchQuery: "",
      searchResults: catalog.search("").map((node) => node.id),
    };
    this.state.camera = this.frame();
  }
  get hub() {
    return this.state.hubs[this.state.focus];
  }
  selected(hub = this.hub) {
    return this.catalog.get(hub.path.at(-1)!);
  }
  siblings(hub = this.hub) {
    return this.catalog.siblings(
      this.selected(hub).id,
      this.state.searchResults,
    );
  }
  private frame(): Camera {
    return frameFor(
      this.hub,
      this.hub.scrollTarget,
      this.siblings().length,
      this.state.camera,
      this.state.viewport,
    );
  }
  private duration(ms: number) {
    return this.state.settings.reducedMotion
      ? 1
      : ms / this.state.settings.speed;
  }
  private fly(camera: Camera, ms = 820) {
    this.follow = false;
    this.tween = {
      start: { ...this.state.camera },
      end: {
        ...camera,
        rotation: unwrapAngle(this.state.camera.rotation, camera.rotation),
      },
      started: this.now,
      duration: this.duration(ms),
    };
  }
  private remember() {
    const s = this.state;
    s.history.push({
      searchQuery: s.searchQuery,
      focus: s.focus,
      overview: s.overview,
      theme: s.theme,
      camera: { ...s.camera },
      hubs: Object.fromEntries(
        Object.values(s.hubs).map((h) => [
          h.id,
          {
            path: [...h.path],
            scroll: h.scroll,
            target: h.scrollTarget,
            morph: h.targetMorph,
          },
        ]),
      ),
    });
    if (s.history.length > 30) s.history.shift();
  }
  private restore(previous: Snapshot) {
    const s = this.state;
    s.focus = previous.focus;
    s.searchQuery = previous.searchQuery;
    s.searchResults = this.catalog
      .search(previous.searchQuery)
      .map((node) => node.id);
    s.overview = previous.overview;
    for (const [id, h] of Object.entries(previous.hubs))
      Object.assign(s.hubs[id], {
        path: [...h.path],
        scroll: h.scroll,
        scrollTarget: h.target,
        targetMorph: h.morph,
        morph: h.morph,
      });
  }
  pulse(center = this.hub.center, maxRadius = 380) {
    this.impulses.push({
      center: { ...center },
      started: this.state.elapsed,
      maxRadius,
    });
    if (this.impulses.length > 8) this.impulses.shift();
  }
  private passage(
    target: string,
    theme: FieldState["theme"],
    commit: () => void,
    camera: Camera,
    duration = 1080,
  ) {
    const s = this.state;
    s.passage = {
      source: s.focus,
      target,
      theme,
      commit,
      started: this.now,
      duration: this.duration(duration),
      phase: 0,
      committed: false,
    };
    this.fly(camera, duration);
    this.pulse();
  }
  dispatch(command: Command) {
    const s = this.state;
    if (command.type === "close-loading") {
      s.loading = false;
      s.theme = this.loadingTheme;
      this.fly(this.frame());
      return;
    }
    if (command.type === "search") {
      const searchHub = this.catalog.searchHub;
      if (
        !searchHub ||
        s.focus !== searchHub.id ||
        s.overview ||
        s.passage ||
        s.loading
      )
        return;
      s.searchQuery = command.query;
      const matches = this.catalog.search(command.query);
      s.searchResults = matches.map((node) => node.id);
      const qHub = s.hubs[searchHub.id];
      if (qHub) {
        qHub.path = [searchHub.root];
        qHub.scroll = 0;
        qHub.scrollTarget = 0;
      }
      this.follow = false;
      this.tween = null;
      s.description = command.query.trim()
        ? `⌕ 检索「${command.query.trim()}」· 已实时更新 ${matches.length} 个周界标签`
        : `⌕ 检索枢 · 已挂载 ${matches.length} 个常用周界标签`;
      return;
    }
    if (s.passage || s.loading) return;
    switch (command.type) {
      case "navigate": {
        if (command.target.startsWith("act:")) {
          this.setting(command.target.slice(4));
          return;
        }
        const node = this.catalog.chapters.get(command.target);
        if (!node) return;
        const dest = s.hubs[node.hub],
          chain = this.catalog.chain(node.id);
        if (
          !s.overview &&
          dest.id === s.focus &&
          chain.length === dest.path.length &&
          chain.at(-2) === dest.path.at(-2)
        ) {
          if (this.selected().id === node.id) return;
          dest.path = chain;
          dest.scrollTarget = this.siblings(dest).findIndex(
            (n) => n.id === node.id,
          );
          this.follow = true;
          this.tween = null;
          this.pulse();
          return;
        }
        this.remember();
        const index = this.catalog
          .siblings(node.id, s.searchResults)
          .findIndex((n) => n.id === node.id);
        const camera = frameFor(
          dest,
          index,
          this.catalog.siblings(node.id, s.searchResults).length,
          s.camera,
          s.viewport,
        );
        this.passage(
          dest.id,
          dest.theme,
          () => {
            s.focus = dest.id;
            s.overview = false;
            dest.path = chain;
            dest.scroll = dest.scrollTarget = index;
          },
          camera,
        );
        s.description = `${dest.glyph} / ${node.name} · ${node.title}`;
        return;
      }
      case "focus": {
        const h = s.hubs[command.hub];
        if (!h) return;
        if (!s.overview && s.focus !== h.id) {
          this.dispatch({ type: "navigate", target: this.selected(h).id });
          return;
        }
        this.remember();
        s.focus = h.id;
        s.overview = false;
        s.theme = h.theme;
        this.fly(this.frame());
        this.pulse();
        return;
      }
      case "morph":
        this.hub.targetMorph = this.hub.targetMorph > 0.5 ? 0 : 1;
        this.fly(this.frame(), 840);
        this.pulse();
        s.description = `${this.hub.glyph} · ${this.hub.targetMorph ? "展开为直线 (LINE)" : "收拢为圆 (CIRCLE)"}`;
        return;
      case "step": {
        if (s.overview) return;
        const nodes = this.siblings(),
          index = nodes.findIndex((n) => n.id === this.selected().id),
          next = clamp(index + command.delta, 0, nodes.length - 1);
        if (next !== index)
          this.dispatch({ type: "navigate", target: nodes[next].id });
        return;
      }
      case "up":
        if (this.selected().parent)
          this.dispatch({ type: "navigate", target: this.selected().parent! });
        return;
      case "back": {
        const previous = s.history.pop();
        if (!previous) {
          this.dispatch({ type: "overview" });
          return;
        }
        this.passage(
          previous.focus,
          previous.theme,
          () => this.restore(previous),
          previous.camera,
        );
        return;
      }
      case "overview":
        this.remember();
        s.overview = true;
        this.fly(overviewCamera(s.viewport));
        s.description = "全域视图 (⊙) · 点击任意枢进入阅读";
        return;
      case "loading":
        this.loadingTheme = s.theme;
        this.passage(
          s.focus,
          "obsidian",
          () => {
            s.loading = true;
          },
          s.camera,
          1180,
        );
        return;
    }
  }
  private setting(action: string) {
    const settings = this.state.settings;
    const frameRate = frameRateFromAction(action);
    if (frameRate !== undefined) {
      settings.frameRate = frameRate;
      this.state.description = `帧率已设置为：${frameRateLabel(frameRate)}`;
      return;
    }
    if (action === "reset_defaults") {
      settings.range = 0.62;
      settings.blur = 1;
      settings.speed = 1;
      settings.reducedMotion = this.systemReducedMotion;
      settings.frameRate = "adaptive";
      if (this.selected().parent) this.dispatch({ type: "up" });
      this.state.description = "✓ 已通过枢原生确认子层恢复全部默认设置";
      return;
    }
    if (action === "cancel_confirm") {
      if (this.selected().parent) this.dispatch({ type: "up" });
      return;
    }
    const values: Record<string, () => void> = {
      range06: () => (settings.range = 0.62),
      range12: () => (settings.range = 1.25),
      range32: () => (settings.range = 3.2),
      blur10: () => (settings.blur = 1),
      blur16: () => (settings.blur = 1.65),
      speed075: () => (settings.speed = 0.75),
      speed100: () => (settings.speed = 1),
      speed125: () => (settings.speed = 1.25),
      toggle_blur: () => (settings.blur = settings.blur > 0 ? 0 : 1),
      toggle_range: () => (settings.range = settings.range > 0.9 ? 0.62 : 1.25),
      toggle_motion: () => (settings.reducedMotion = !settings.reducedMotion),
      loading: () => this.dispatch({ type: "loading" }),
      pulse: () => {
        Object.values(this.state.hubs).forEach((h) =>
          this.pulse(h.center, 460),
        );
        this.dispatch({ type: "overview" });
      },
    };
    values[action]?.();
    this.state.description = `设置已生效 · 显现范围 ${settings.range} · 景深 ${settings.blur}× · 速率 ${settings.speed}×`;
  }
  setSystemReducedMotion(value: boolean) {
    this.systemReducedMotion = value;
    this.state.settings.reducedMotion = value;
  }
  resize(viewport: Viewport) {
    this.state.viewport = viewport;
    this.fly(
      this.state.overview ? overviewCamera(viewport) : this.frame(),
      250,
    );
  }
  pan(delta: Vec, start: Camera) {
    if (this.state.loading || this.state.passage) return;
    this.tween = null;
    this.follow = false;
    const d = rot(mul(delta, 1 / start.z), (-start.rotation * Math.PI) / 180);
    Object.assign(this.state.camera, { x: start.x - d.x, y: start.y - d.y });
  }
  zoom(factor: number, point: Vec) {
    if (this.state.loading || this.state.passage) return;
    this.tween = null;
    this.follow = false;
    const s = this.state,
      before = screenToWorld(point, s.camera, s.viewport);
    s.camera.z = clamp(s.camera.z * factor, 0.18, 2.4);
    const after = screenToWorld(point, s.camera, s.viewport);
    Object.assign(s.camera, add(s.camera, sub(before, after)));
  }
  get isAnimating(): boolean {
    return !!(
      this.tween ||
      this.follow ||
      this.state.passage ||
      this.state.loading ||
      Object.values(this.state.hubs).some(
        (h) => h.morph !== h.targetMorph || h.scroll !== h.scrollTarget,
      )
    );
  }
  update(now: number, dt: number) {
    this.now = now;
    const s = this.state;
    dt = Math.min(dt, 50);
    s.elapsed += dt * s.settings.speed;
    const k = s.settings.reducedMotion
      ? 1
      : 1 - Math.exp((-dt * s.settings.speed) / 190);
    for (const h of Object.values(s.hubs)) {
      h.morph = mix(h.morph, h.targetMorph, k);
      h.scroll = mix(h.scroll, h.scrollTarget, k);
      if (Math.abs(h.morph - h.targetMorph) < 1e-4) h.morph = h.targetMorph;
      if (Math.abs(h.scroll - h.scrollTarget) < 1e-4) h.scroll = h.scrollTarget;
    }
    if (this.follow && !s.overview && !s.passage) {
      const target = frameFor(
        this.hub,
        this.hub.scroll,
        this.siblings().length,
        s.camera,
        s.viewport,
      );
      const rotation = mix(
        s.camera.rotation,
        unwrapAngle(s.camera.rotation, target.rotation),
        k,
      );
      if (this.hub.targetMorph === 0 && this.hub.morph < 0.01) {
        Object.assign(
          s.camera,
          orbitCamera(s.camera, this.hub.center, rotation),
        );
      } else {
        for (const key of ["x", "y"] as const)
          s.camera[key] = mix(s.camera[key], target[key], k);
        s.camera.rotation = rotation;
      }
      const aligned =
        Math.abs(
          unwrapAngle(s.camera.rotation, target.rotation) - s.camera.rotation,
        ) < 0.001;
      const positioned =
        this.hub.targetMorph === 0 ||
        Math.hypot(s.camera.x - target.x, s.camera.y - target.y) < 0.01;
      if (this.hub.scroll === this.hub.scrollTarget && aligned && positioned)
        this.follow = false;
    }
    if (this.tween) {
      const t = this.tween,
        p = clamp((now - t.started) / t.duration, 0, 1),
        e = ease(p);
      for (const key of ["x", "y", "rotation"] as const)
        s.camera[key] = mix(t.start[key], t.end[key], e);
      s.camera.z = Math.exp(mix(Math.log(t.start.z), Math.log(t.end.z), e));
      if (p === 1) this.tween = null;
    }
    if (s.passage) {
      const t = s.passage,
        p = clamp((now - t.started) / t.duration, 0, 1);
      t.phase = p;
      const fold = p < 0.5 ? ease(2 * p) : ease(2 - 2 * p);
      s.hubs[t.source].fold = fold;
      s.hubs[t.target].fold = fold;
      if (p >= 0.5 && !t.committed) {
        t.commit();
        t.committed = true;
      }
      if (p === 1) {
        s.hubs[t.source].fold = 0;
        s.hubs[t.target].fold = 0;
        s.theme = t.theme;
        s.passage = null;
      }
    }
    while (this.impulses.length && s.elapsed - this.impulses[0].started >= 2200)
      this.impulses.shift();
  }
}
