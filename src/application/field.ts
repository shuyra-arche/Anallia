import { frameRateFromAction, frameRateLabel } from "../core/frame-rate.ts";
import {
  BACKGROUND_OPTIONS,
  backgroundFromAction,
} from "../core/background.ts";
import type {
  Camera,
  Command,
  FieldState,
  Hub,
  Snapshot,
  TransitionKind,
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
  readingRotation,
  readingBearing,
  cameraPinnedToPoint,
  arcLengthAt,
  overviewCamera,
  screenToWorld,
  orbitCamera,
  material,
  nodeS,
  outwardNormal,
  pitch,
  cameraPinnedToHubPoint,
  hubToScreen,
  worldToScreen,
} from "../geometry/field.ts";
import {
  classifyTransition,
  selectSpatialTransition,
  MOTION,
} from "../core/transitions.ts";
import { Catalog } from "../content/catalog.ts";
import { needsColorSweep, THEME_OPTIONS, themeFromAction } from "../core/palette.ts";
import { localBandForHub } from "./attachments.ts";

export class Field {
  readonly state: FieldState;
  readonly impulses: { center: Vec; started: number; maxRadius: number }[] = [];
  private tween: {
    start: Camera;
    end: Camera;
    started: number;
    duration: number;
    profile: "ordinary" | "flight" | "axis" | "remote";
  } | null = null;
  private follow = false;
  private readingPin: Vec | null = null;
  private autoFit = true;
  private graspStart: number | null = null;
  private queuedCommand: Command | null = null;
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
            readingBearing: h.angle,
            readingStart: 0,
            targetMorph: h.morph,
            fold: 0,
            scroll: 0,
            scrollTarget: 0,
            textOffset: 0,
            textOffsetTarget: 0,
            path: [h.root],
            anchorOffset: 0,
            localScroll: 0,
            localScrollTarget: 0,
          },
        ]),
      ),
      focus,
      overview: false,
      theme: catalog.definitions[0].theme,
      camera: { x: 0, y: 0, z: 1, rotation: 0 },
      viewport,
      settings: {
        background: "flow",
        speed: 1,
        range: 0.62,
        blur: 1,
        reducedMotion,
        frameRate: "adaptive",
        sound: true,
      },
      history: [],
      passage: null,
      morphTurn: null,
      contentTurn: null,
      loading: false,
      description:
        "Anallia · 空白处滚动切换章节 · 正文内滚动读长文 · 点击高亮标签切换圆／线",
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
  private approach(hub: Hub, index: number, count: number, origin: Vec) {
    const s = this.state;
    const toward = sub(origin, hub.center);
    if (Math.hypot(toward.x, toward.y) < 1) return;
    const angle = (Math.atan2(toward.y, toward.x) * 180) / Math.PI;
    const settled = {
      ...hub,
      angle: 0,
      anchorOffset: 0,
      morph: hub.targetMorph,
      scroll: index,
    };
    const n = outwardNormal(
      settled,
      nodeS(settled, index, count, s.camera, s.viewport),
    );
    hub.angle = angle - (Math.atan2(n.y, n.x) * 180) / Math.PI;
    hub.readingBearing = angle + s.camera.rotation;
    hub.readingStart = index;
    this.autoFit = true;
  }

  private pinReading() {
    const s = this.state;
    const along = nodeS(
      this.hub,
      this.hub.scroll,
      this.siblings().length,
      s.camera,
      s.viewport,
    );
    this.readingPin = worldToScreen(
      material(this.hub, along, 48),
      s.camera,
      s.viewport,
    );
  }

  /** Fit the measured reading window after automatic movement, once. Manual
   * pan and zoom deliberately relinquish this viewport constraint. */
  fitReading(
    bounds: { left: number; top: number; width: number; height: number } | null,
  ) {
    const s = this.state;
    if (!this.autoFit || !bounds || this.isAnimating || s.overview || s.loading)
      return;
    this.autoFit = false;
    const margin = s.viewport.width < 700 ? 16 : 24;
    const dx =
      bounds.left < margin
        ? margin - bounds.left
        : bounds.left + bounds.width > s.viewport.width - margin
          ? s.viewport.width - margin - bounds.left - bounds.width
          : 0;
    const dy =
      bounds.top < 76
        ? 76 - bounds.top
        : bounds.top + bounds.height > s.viewport.height - 48
          ? s.viewport.height - 48 - bounds.top - bounds.height
          : 0;
    if (Math.abs(dx) + Math.abs(dy) < 1) return;
    const delta = rot(
      { x: dx / s.camera.z, y: dy / s.camera.z },
      (-s.camera.rotation * Math.PI) / 180,
    );
    this.fly(
      { ...s.camera, x: s.camera.x - delta.x, y: s.camera.y - delta.y },
      MOTION.resize,
    );
  }

  private duration(ms: number) {
    return this.state.settings.reducedMotion
      ? 1
      : ms / this.state.settings.speed;
  }
  private fly(
    camera: Camera,
    ms: number = MOTION.focus,
    profile: "ordinary" | "flight" | "axis" | "remote" = "ordinary",
  ) {
    this.follow = false;
    this.tween = {
      start: { ...this.state.camera },
      end: {
        ...camera,
        rotation: unwrapAngle(this.state.camera.rotation, camera.rotation),
      },
      started: this.now,
      duration: this.duration(ms),
      profile,
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
            anchorOffset: h.anchorOffset,
            angle: h.angle,
            readingBearing: h.readingBearing,
            readingStart: h.readingStart,
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
        textOffset: 0,
        textOffsetTarget: 0,
        anchorOffset: h.anchorOffset ?? 0,
        angle: h.angle ?? s.hubs[id].angle,
        readingBearing: h.readingBearing,
        readingStart: h.readingStart,
        localScroll: 0,
        localScrollTarget: 0,
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
    kind: TransitionKind,
    direction: "forward" | "reverse" = "forward",
    duration = MOTION[kind],
    destinationMorph?: number,
  ) {
    const s = this.state;
    const sourceHub = this.hub;
    const targetHub = s.hubs[target];
    s.passage = {
      kind,
      direction,
      source: s.focus,
      target,
      from: {
        center: { ...sourceHub.center },
        angle: sourceHub.angle,
        morph: sourceHub.morph,
      },
      to: {
        center: { ...targetHub.center },
        angle: targetHub.angle,
        morph: destinationMorph ?? targetHub.morph,
      },
      sourceTheme: s.theme,
      theme,
      commit,
      started: this.now,
      duration: this.duration(duration),
      phase: 0,
      committed: false,
    };
    this.fly(
      camera,
      duration,
      kind === "flight" || kind === "axis" || kind === "remote"
        ? kind
        : "ordinary",
    );
    this.pulse();
  }

  /** Replace the semantic payload at the same material attachment point. */
  private replaceContent(
    destId: string,
    commit: () => void,
    direction: 1 | -1 = 1,
  ) {
    this.autoFit = true;
    const s = this.state;
    const hub = this.hub;
    const oldSiblings = this.siblings(hub);
    const oldIndex = oldSiblings.findIndex(
      (n) => n.id === this.selected(hub).id,
    );
    const newSiblings = this.catalog.siblings(destId, s.searchResults);
    const newIndex = newSiblings.findIndex((n) => n.id === destId);
    const oldCount = oldSiblings.length;
    const fromId = this.selected(hub).id;
    s.contentTurn = {
      hub: hub.id,
      from: fromId,
      to: destId,
      started: this.now,
      duration: this.duration(MOTION.page),
      phase: 0,
      direction,
      committed: false,
      commit: () => {
        const previous = arcLengthAt(
          hub,
          nodeS(hub, oldIndex, oldCount, s.camera, s.viewport),
        );
        const targetCount = newSiblings.length;
        const circleRef = hub.layout === "anchored" ? 0 : (targetCount - 1) / 2;
        const baseArc =
          hub.layout === "anchored" ? 68 : targetCount > 6 ? 118 : 165;
        hub.anchorOffset = previous - (newIndex - circleRef) * baseArc;
        commit();
        hub.textOffset = hub.textOffsetTarget = 0;
        hub.localScroll = hub.localScrollTarget = 0;
      },
    };
    this.follow = false;
    this.tween = null;
    s.description = `${hub.glyph} · ${this.catalog.get(destId).name} · 翻页切换内容`;
  }

  private navigateSibling(path: string[], target: string) {
    const hub = this.hub;
    this.pinReading();
    this.autoFit = true;
    hub.path = path;
    hub.localScroll = hub.localScrollTarget = 0;
    hub.scrollTarget = this.catalog
      .siblings(target, this.state.searchResults)
      .findIndex((n) => n.id === target);
    hub.textOffsetTarget = 0;
    this.follow = hub.targetMorph < 0.99;
    this.tween = null;
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
        s.loading ||
        s.passage ||
        s.morphTurn ||
        s.contentTurn
      )
        return;
      s.searchQuery = command.query;
      const matches = this.catalog.search(command.query);
      s.searchResults = matches.map((node) => node.id);
      const qHub = s.hubs[searchHub.id];
      if (qHub) {
        qHub.path = [searchHub.root];
        qHub.localScroll = qHub.localScrollTarget = 0;
        qHub.scroll = 0;
        qHub.scrollTarget = 0;
        qHub.textOffset = 0;
        qHub.textOffsetTarget = 0;
        qHub.anchorOffset = 0;
      }
      this.follow = false;
      this.tween = null;
      s.description = command.query.trim()
        ? `⌕ 检索「${command.query.trim()}」· 已实时更新 ${matches.length} 个周界标签`
        : `⌕ 检索枢 · 已挂载 ${matches.length} 个常用周界标签`;
      return;
    }
    if (command.type === "float-text") {
      if (s.overview || s.loading) return;
      const h = this.hub;
      const limit = Math.max(0, command.maxOffset ?? 600);
      h.textOffsetTarget = clamp(h.textOffsetTarget + command.delta, 0, limit);
      return;
    }
    if (command.type === "navigate" && command.target.startsWith("act:")) {
      this.setting(command.target.slice(4));
      return;
    }
    if (s.passage || s.morphTurn || s.contentTurn) {
      if (command.type === "step" && this.queuedCommand?.type === "step") {
        this.queuedCommand = {
          type: "step",
          delta: this.queuedCommand.delta + command.delta,
        };
      } else {
        this.queuedCommand = command;
      }
      s.description = "转场进行中 · 下一操作已接收";
      return;
    }
    if (s.loading) return;
    switch (command.type) {
      case "navigate": {
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
          this.navigateSibling(chain, node.id);
          return;
        }
        if (s.overview) {
          this.remember();
          this.approach(
            dest,
            this.catalog
              .siblings(node.id, s.searchResults)
              .findIndex((n) => n.id === node.id),
            this.catalog.siblings(node.id, s.searchResults).length,
            s.camera,
          );
          s.focus = dest.id;
          s.overview = false;
          dest.path = chain;
          dest.anchorOffset = 0;
          dest.scroll = dest.scrollTarget = this.catalog
            .siblings(node.id, s.searchResults)
            .findIndex((n) => n.id === node.id);
          dest.textOffset = dest.textOffsetTarget = 0;
          s.theme = dest.theme;
          this.fly(this.frame());
          this.pulse();
          return;
        }
        this.remember();
        if (dest.id === s.focus) {
          this.replaceContent(node.id, () => {
            dest.path = chain;
            dest.scroll = dest.scrollTarget = this.catalog
              .siblings(node.id, s.searchResults)
              .findIndex((n) => n.id === node.id);
          });
          return;
        }
        const index = this.catalog
          .siblings(node.id, s.searchResults)
          .findIndex((n) => n.id === node.id);
        this.approach(
          dest,
          index,
          this.catalog.siblings(node.id, s.searchResults).length,
          this.hub.center,
        );
        const settledDest = { ...dest, anchorOffset: 0 };
        const camera = frameFor(
          settledDest,
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
            dest.anchorOffset = 0;
            dest.scroll = dest.scrollTarget = index;
            dest.textOffset = dest.textOffsetTarget = 0;
          },
          camera,
          selectSpatialTransition(this.hub, dest, s.camera, s.viewport),
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
        if (s.overview)
          this.approach(h, h.scrollTarget, this.siblings(h).length, s.camera);
        this.autoFit = true;
        s.focus = h.id;
        s.overview = false;
        s.theme = h.theme;
        this.fly(this.frame());
        this.pulse();
        return;
      }
      case "morph": {
        const hub = this.hub;
        this.autoFit = true;
        const to = hub.targetMorph > 0.5 ? 0 : 1;
        const siblings = this.siblings();
        const focusIndex = siblings.findIndex(
          (n) => n.id === this.selected().id,
        );
        const point = material(
          hub,
          nodeS(hub, focusIndex, siblings.length, s.camera, s.viewport),
        );
        const screenAnchor = hubToScreen(hub, point, s.camera, s.viewport);
        s.morphTurn = {
          hub: hub.id,
          from: hub.morph,
          to,
          started: this.now,
          duration: this.duration(MOTION.morph),
          phase: 0,
          screenAnchor,
          startRotation: s.camera.rotation,
        };
        hub.targetMorph = to;
        hub.textOffsetTarget = 0;
        this.follow = false;
        this.tween = null;
        this.pulse();
        s.description = `${hub.glyph} · ${to ? "展开为直线 (LINE)" : "收拢为圆 (CIRCLE)"} · 几何连续变换`;
        return;
      }
      case "scroll-local": {
        if (s.overview) return;
        const h = this.hub;
        const here = this.selected();
        const band = localBandForHub(
          h,
          here,
          this.siblings(),
          s.camera,
          s.viewport,
        );
        h.localScrollTarget = clamp(
          h.localScrollTarget + command.delta,
          0,
          band.maxScroll,
        );
        return;
      }
      case "step": {
        if (s.overview) return;
        const here = this.selected(),
          nodes = this.siblings(),
          index = nodes.findIndex((n) => n.id === here.id),
          next = clamp(index + command.delta, 0, nodes.length - 1);
        if (next !== index) {
          this.dispatch({ type: "navigate", target: nodes[next].id });
        }
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
        if (s.overview || previous.overview) {
          this.restore(previous);
          s.theme = previous.theme;
          this.fly(previous.camera);
          return;
        }
        const target = previous.hubs[previous.focus];
        const kind = classifyTransition(
          s.focus,
          this.hub.path,
          previous.focus,
          target.path,
        );
        if (kind === "traverse") {
          this.restore(previous);
          s.theme = previous.theme;
          this.fly(previous.camera);
          return;
        }
        if (previous.focus === s.focus) {
          this.replaceContent(
            target.path.at(-1)!,
            () => {
              const offset = this.hub.anchorOffset;
              const currentMorph = this.hub.morph;
              const currentTargetMorph = this.hub.targetMorph;
              this.restore(previous);
              this.hub.anchorOffset = offset;
              this.hub.morph = currentMorph;
              this.hub.targetMorph = currentTargetMorph;
              s.theme = previous.theme;
            },
            -1,
          );
          return;
        }
        const spatialKind = selectSpatialTransition(
          this.hub,
          s.hubs[previous.focus],
          s.camera,
          s.viewport,
        );
        this.passage(
          previous.focus,
          previous.theme,
          () => this.restore(previous),
          previous.camera,
          spatialKind,
          "reverse",
          MOTION[spatialKind],
          target.morph,
        );
        return;
      }
      case "overview":
        this.remember();
        s.overview = true;
        this.fly(overviewCamera(s.viewport));
        s.description =
          "全域视图 (⊙) · 9 个枢的几何关系与流场分布 · 点击任意枢进入阅读";
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
          "loading",
        );
        return;
    }
  }
  private setting(action: string) {
    const settings = this.state.settings;
    const theme = themeFromAction(action);
    if (theme !== undefined) {
      this.state.theme = theme;
      const label = THEME_OPTIONS.find((option) => option.value === theme)!.label;
      this.state.description = `配色已切换为：${label}`;
      return;
    }
    const background = backgroundFromAction(action);
    if (background !== undefined) {
      settings.background = background;
      this.state.description = `背景已设置为：${BACKGROUND_OPTIONS.find((option) => option.value === background)!.label}`;
      return;
    }
    const frameRate = frameRateFromAction(action);
    if (frameRate !== undefined) {
      settings.frameRate = frameRate;
      this.state.description = `帧率已设置为：${frameRateLabel(frameRate)}`;
      return;
    }
    if (action === "reset_defaults") {
      settings.background = "flow";
      settings.range = 0.62;
      settings.blur = 1;
      settings.speed = 1;
      settings.reducedMotion = this.systemReducedMotion;
      settings.frameRate = "adaptive";
      settings.sound = true;
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
      toggle_sound: () => (settings.sound = settings.sound === false ? true : false),
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
    this.autoFit = true;
    this.state.viewport = viewport;
    this.fly(
      this.state.overview ? overviewCamera(viewport) : this.frame(),
      MOTION.resize,
    );
  }
  /** Grab the visible hub curve directly, without triggering Morph or Page Flip.
   * In Circle Mode, only rotates camera around hub.center preserving zoom/pan.
   * In Line Mode, keeps camera state 100% unchanged while sliding chapters along the line. */
  grasp(delta: number | null) {
    const s = this.state;
    if (s.overview || s.loading || s.passage || s.contentTurn || s.morphTurn)
      return;
    const hub = this.hub;
    const siblings = this.siblings();
    if (siblings.length < 2) return;
    if (delta === null) {
      if (this.graspStart === null) return;
      const index = Math.round(clamp(hub.scroll, 0, siblings.length - 1));
      hub.path = this.catalog.chain(siblings[index].id);
      hub.scrollTarget = index;
      hub.localScroll = hub.localScrollTarget = 0;
      hub.textOffsetTarget = 0;
      this.pinReading();
      this.autoFit = true;
      this.follow = hub.targetMorph < 0.99;
      this.graspStart = null;
      s.description = `${hub.glyph} · ${siblings[index].name} · 吸附到阅读锚点`;
      return;
    }
    if (this.graspStart === null) {
      this.remember();
      this.graspStart = hub.scrollTarget;
      this.follow = false;
      this.tween = null;
    }
    const index = clamp(this.graspStart + delta, 0, siblings.length - 1);
    hub.scroll = hub.scrollTarget = index;
    const nearest = Math.round(index);
    hub.path = this.catalog.chain(siblings[nearest].id);
    if (hub.targetMorph < 0.99) {
      const target = frameFor(
        hub,
        index,
        siblings.length,
        s.camera,
        s.viewport,
      );
      const rotation = unwrapAngle(s.camera.rotation, target.rotation);
      Object.assign(s.camera, orbitCamera(s.camera, hub.center, rotation));
    }
    s.description = `${hub.glyph} · 抓握浏览 · ${siblings[nearest].name}`;
  }
  graspGeometry() {
    const h = this.hub,
      s = this.state;
    if (s.overview || s.loading || s.passage || s.morphTurn || s.contentTurn)
      return null;
    const nodes = this.siblings();
    const pos = nodeS(h, h.scroll, nodes.length, s.camera, s.viewport);
    const normal = outwardNormal(h, pos);
    const a = (s.camera.rotation * Math.PI) / 180;
    const rotated = rot(normal, a);
    return {
      mode: h.morph > 0.5 ? ("line" as const) : ("circle" as const),
      center: worldToScreen(h.center, s.camera, s.viewport),
      tangent: { x: -rotated.y, y: rotated.x },
      stepPx: pitch(h, s.camera, s.viewport) * s.camera.z,
      stepRad: (nodes.length > 6 ? 118 : 165) / 195,
    };
  }
  pan(delta: Vec, start: Camera) {
    if (
      this.state.loading ||
      this.state.passage ||
      this.state.contentTurn ||
      this.state.morphTurn
    )
      return;
    this.tween = null;
    this.follow = false;
    this.autoFit = false;
    const d = rot(mul(delta, 1 / start.z), (-start.rotation * Math.PI) / 180);
    Object.assign(this.state.camera, { x: start.x - d.x, y: start.y - d.y });
  }
  zoom(factor: number, point: Vec) {
    if (
      this.state.loading ||
      this.state.passage ||
      this.state.contentTurn ||
      this.state.morphTurn
    )
      return;
    this.tween = null;
    this.follow = false;
    this.autoFit = false;
    const s = this.state,
      before = screenToWorld(point, s.camera, s.viewport);
    s.camera.z = clamp(s.camera.z * factor, 0.18, 2.4);
    const after = screenToWorld(point, s.camera, s.viewport);
    Object.assign(s.camera, add(s.camera, sub(before, after)));
  }
  /**
   * Manually rotate the camera (via Alt+wheel around the focused reading anchor,
   * or two-finger touch twist around the gesture midpoint) and preserve the new
   * outward reading bearing when subsequently stepping through chapters.
   */
  rotate(deltaDeg: number, screenPoint?: Vec) {
    if (
      !Number.isFinite(deltaDeg) ||
      Math.abs(deltaDeg) < 1e-6 ||
      this.state.loading ||
      this.state.passage ||
      this.state.contentTurn ||
      this.state.morphTurn
    )
      return;
    this.tween = null;
    this.follow = false;
    this.autoFit = false;
    const s = this.state;
    const nextRotation = s.camera.rotation + deltaDeg;
    if (screenPoint) {
      const worldPivot = screenToWorld(screenPoint, s.camera, s.viewport);
      Object.assign(s.camera, orbitCamera(s.camera, worldPivot, nextRotation));
    } else if (s.overview) {
      const center = { x: s.viewport.width / 2, y: s.viewport.height / 2 };
      const worldPivot = screenToWorld(center, s.camera, s.viewport);
      Object.assign(s.camera, orbitCamera(s.camera, worldPivot, nextRotation));
    } else {
      const hub = this.hub;
      const count = this.siblings().length;
      const along = nodeS(hub, hub.scroll, count, s.camera, s.viewport);
      const readingAnchor = material(hub, along, 76);
      Object.assign(
        s.camera,
        orbitCamera(s.camera, readingAnchor, nextRotation),
      );
    }
    if (!s.overview) {
      const hub = this.hub;
      const count = this.siblings().length;
      const along = nodeS(hub, hub.scroll, count, s.camera, s.viewport);
      const n = outwardNormal(hub, along);
      hub.readingStart = hub.scroll;
      hub.readingBearing =
        s.camera.rotation + (Math.atan2(n.y, n.x) * 180) / Math.PI;
    }
  }
  get isAnimating(): boolean {
    return !!(
      this.tween ||
      this.follow ||
      this.graspStart !== null ||
      this.state.passage ||
      this.state.morphTurn ||
      this.state.contentTurn ||
      this.state.loading ||
      Object.values(this.state.hubs).some(
        (h) =>
          h.morph !== h.targetMorph ||
          h.scroll !== h.scrollTarget ||
          h.localScroll !== h.localScrollTarget ||
          h.textOffset !== h.textOffsetTarget,
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
      : 1 - Math.exp((-dt * s.settings.speed) / MOTION.scrollTimeConstant);
    for (const h of Object.values(s.hubs)) {
      if (!s.morphTurn || s.morphTurn.hub !== h.id)
        h.morph = mix(h.morph, h.targetMorph, k);
      h.scroll = mix(h.scroll, h.scrollTarget, k);
      h.localScroll = mix(h.localScroll, h.localScrollTarget, k);
      if (Math.abs(h.localScroll - h.localScrollTarget) < 1e-3)
        h.localScroll = h.localScrollTarget;
      const kt = s.settings.reducedMotion
        ? 1
        : 1 - Math.exp((-dt * s.settings.speed) / MOTION.textTimeConstant);
      h.textOffset = mix(h.textOffset, h.textOffsetTarget, kt);
      if (Math.abs(h.morph - h.targetMorph) < 1e-4) h.morph = h.targetMorph;
      if (Math.abs(h.scroll - h.scrollTarget) < 1e-4) h.scroll = h.scrollTarget;
      if (Math.abs(h.textOffset - h.textOffsetTarget) < 0.01)
        h.textOffset = h.textOffsetTarget;
    }
    if (s.morphTurn) {
      const turn = s.morphTurn;
      turn.phase = clamp((now - turn.started) / turn.duration, 0, 1);
      const movingHub = s.hubs[turn.hub];
      movingHub.morph = mix(turn.from, turn.to, ease(turn.phase));
      const siblingNodes = this.siblings(movingHub);
      const focusIndex = siblingNodes.findIndex(
        (n) => n.id === this.selected(movingHub).id,
      );
      const along = nodeS(
        movingHub,
        focusIndex,
        siblingNodes.length,
        s.camera,
        s.viewport,
      );
      const point = material(movingHub, along);
      const normal = outwardNormal(movingHub, along);
      const desiredRotation =
        readingBearing(movingHub) -
        (Math.atan2(normal.y, normal.x) * 180) / Math.PI;
      const rotation = unwrapAngle(turn.startRotation, desiredRotation);
      Object.assign(
        s.camera,
        cameraPinnedToHubPoint(
          movingHub,
          point,
          turn.screenAnchor,
          s.camera,
          s.viewport,
          rotation,
        ),
      );
      if (turn.phase === 1) {
        s.hubs[turn.hub].morph = turn.to;
        s.morphTurn = null;
      }
    }
    if (this.follow && !s.overview && !s.passage && !s.morphTurn) {
      const hub = this.hub;
      const count = this.siblings().length;
      const rotation = unwrapAngle(
        s.camera.rotation,
        readingRotation(hub, hub.scroll, count, s.camera, s.viewport),
      );
      const along = nodeS(hub, hub.scroll, count, s.camera, s.viewport);
      if (!this.readingPin) this.pinReading();
      Object.assign(
        s.camera,
        cameraPinnedToPoint(
          material(hub, along, 48),
          this.readingPin!,
          s.camera,
          s.viewport,
          rotation,
        ),
      );
      if (hub.scroll === hub.scrollTarget) {
        this.follow = false;
        this.readingPin = null;
      }
    }
    if (this.tween) {
      const t = this.tween,
        p = clamp((now - t.started) / t.duration, 0, 1),
        e = ease(p);
      for (const key of ["x", "y", "rotation"] as const)
        s.camera[key] = mix(t.start[key], t.end[key], e);
      s.camera.z = Math.exp(mix(Math.log(t.start.z), Math.log(t.end.z), e));
      const prominence = Math.sin(Math.PI * e);
      if (t.profile === "flight" || t.profile === "remote") {
        s.camera.z *= 1 - (t.profile === "remote" ? 0.52 : 0.32) * prominence;
      } else if (t.profile === "axis") {
        const dx = t.end.x - t.start.x,
          dy = t.end.y - t.start.y;
        s.camera.x += -dy * 0.16 * prominence;
        s.camera.y += dx * 0.16 * prominence;
        s.camera.rotation +=
          (t.end.rotation >= t.start.rotation ? 1 : -1) * 42 * prominence;
        s.camera.z *= 1 - 0.18 * prominence;
      }
      if (p === 1) this.tween = null;
    }
    if (s.contentTurn) {
      const t = s.contentTurn;
      const p = clamp((now - t.started) / t.duration, 0, 1);
      t.phase = p;
      if (p >= 0.5 && !t.committed) {
        t.commit();
        t.committed = true;
      }
      if (p === 1) s.contentTurn = null;
    }
    if (s.passage) {
      const t = s.passage,
        p = clamp((now - t.started) / t.duration, 0, 1);
      t.phase = p;
      if (
        (t.kind === "remote" || t.kind === "loading") &&
        needsColorSweep(t.sourceTheme, t.theme)
      ) {
        const fold = p < 0.5 ? ease(2 * p) : ease(2 - 2 * p);
        s.hubs[t.source].fold = fold;
        s.hubs[t.target].fold = fold;
      } else {
        s.hubs[t.source].fold = 0;
        s.hubs[t.target].fold = 0;
      }
      if (p >= 0.5 && !t.committed) {
        t.commit();
        t.committed = true;
      }
      if (p === 1) {
        s.hubs[t.source].fold = 0;
        s.hubs[t.target].fold = 0;
        s.theme = t.theme;
        s.passage = null;
        const queued = this.queuedCommand;
        this.queuedCommand = null;
        if (queued) this.dispatch(queued);
      }
    }
    if (!s.passage && !s.morphTurn && !s.contentTurn && this.queuedCommand) {
      const queued = this.queuedCommand;
      this.queuedCommand = null;
      this.dispatch(queued);
    }
    while (this.impulses.length && s.elapsed - this.impulses[0].started >= 2200)
      this.impulses.shift();
  }
}
