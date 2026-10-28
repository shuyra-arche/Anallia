import { clamp, mix, quint } from "../core/math.ts";
/** The original V24 drawing kernel owns only its supplied SVG subtree. */
/**
 * @param {HTMLElement} root
 * @param {() => void} onFinish
 * @param {(description: string) => void} onDescription
 */
export function createLoading(root, onFinish, onDescription) {
  const $ = (selector) => root.querySelector(selector);
  const descBar = {
    set textContent(value) {
      onDescription(value);
    },
  };
  let motionSpeed = 1;
  let lActive = false,
    lStage = "intro",
    lElapsed = 0,
    lCycle = 0,
    lExitQueued = false;
  const finishLoadingMode = () => {
    lActive = false;
    onFinish();
  };
  const L_PI = Math.PI,
    L_TAU = 2 * Math.PI;
  const L_C = [-9 / 14, -2 / 7, 3 / 7],
    L_RADII = [140, 70, 35];
  const lMain = [$("#circle0"), $("#circle1"), $("#circle2")];
  const lLines = [$("#straight0"), $("#straight1"), $("#straight2")];
  const lArcs = [$("#mark0"), $("#mark1")];
  const lFine = [$("#arc-fine0"), $("#arc-fine1")];
  const lTips = [$("#tip0"), $("#tip1"), $("#tip2")];
  const L_DUR = {
    intro: 1.55,
    introArc: 0.58,
    loop: 5.45,
    outroArc: 0.58,
    outro: 1.55,
  };
  const L_LOOP = {
    leftTailEnd: 0.72,
    morphStart: 0.58,
    morphEnd: 3.04,
    rightHeadStart: 2.9,
    rightHeadEnd: 3.62,
    rightTailEnd: 4.28,
    rotateStart: 4.1,
    rotateEnd: 6.16,
    leftHeadStart: 5.98,
    leftHeadEnd: 6.82,
  };

  const lRound = (n) => Number(n.toFixed(4));
  const lNorm = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
  function lComplexMul(ar, ai, br, bi) {
    return [ar * br - ai * bi, ar * bi + ai * br];
  }
  function lComplexDiv(ar, ai, br, bi) {
    const d = br * br + bi * bi || 1e-9;
    return [(ar * br + ai * bi) / d, (ai * br - ar * bi) / d];
  }
  function lCurvParam(s) {
    const a = Math.abs(s);
    return s * (0.43 + 0.57 * a * a);
  }

  function lCurve(s, i) {
    if (Math.abs(s) < 1e-9) return { cx: NaN, cy: NaN, r: Infinity };
    const c = L_C[i],
      phi = (L_PI / 2) * (1 - s);
    const q = lCurvParam(s),
      qsR = q * Math.cos(phi),
      qsI = q * Math.sin(phi);
    const beta = s * s * phi;
    const BRe = 100 * Math.cos(beta),
      BIm = 100 * Math.sin(beta);
    const ARe = 220 + 40 * s,
      AIm = 220;
    const invq = lComplexDiv(1, 0, qsR, qsI);
    const Bq = lComplexDiv(BRe, BIm, qsR, qsI);
    const Q0 = ARe + Bq[0],
      Q1 = AIm + Bq[1];
    const D = lComplexDiv(Bq[0], Bq[1], qsR, qsI);
    const dist = c + invq[0];
    return {
      cx: Q0 - D[0] / (2 * dist),
      cy: Q1 - D[1] / (2 * dist),
      r: 100 / (2 * q * q * Math.abs(dist)),
    };
  }

  function lTransformedPt(s, c, y) {
    const phi = (L_PI / 2) * (1 - s),
      q = lCurvParam(s),
      qr = q * Math.cos(phi),
      qi = q * Math.sin(phi);
    const beta = s * s * phi;
    const nr = 100 * Math.cos(beta),
      ni = 100 * Math.sin(beta);
    const [a, b] = lComplexMul(nr, ni, c, y);
    const [x, z] = lComplexDiv(a, b, 1 + qr * c - qi * y, qr * y + qi * c);
    return [220 + 40 * s + x, 220 + z];
  }

  function lLinePath(s, i) {
    const pts = [];
    for (let j = 0; j <= 80; j++) {
      const y = -8 + (16 * j) / 80;
      const [x, v] = lTransformedPt(s, L_C[i], y);
      pts.push((j ? "L" : "M") + lRound(x) + " " + lRound(v));
    }
    return pts.join(" ");
  }

  function lStableCircle(side, i) {
    const r = L_RADII[i];
    return { cx: side === "left" ? 80 + r : 360 - r, cy: 220, r };
  }

  function lRotate(c, theta) {
    const dx = c.cx - 220,
      dy = c.cy - 220;
    return {
      cx: 220 + dx * Math.cos(theta) - dy * Math.sin(theta),
      cy: 220 + dx * Math.sin(theta) + dy * Math.cos(theta),
      r: c.r,
    };
  }

  function lFullCircle(c) {
    return `M${lRound(c.cx + c.r)} ${lRound(c.cy)} A${lRound(c.r)} ${lRound(c.r)} 0 1 1 ${lRound(c.cx - c.r)} ${lRound(c.cy)} A${lRound(c.r)} ${lRound(c.r)} 0 1 1 ${lRound(c.cx + c.r)} ${lRound(c.cy)}`;
  }

  function lCircleArc(c, s, i) {
    const r = c.r;
    const mid = lTransformedPt(s, L_C[i], 0);
    const base = Math.atan2(mid[1] - c.cy, mid[0] - c.cx);
    const a = Math.abs(s);
    const raw = Math.min(
      L_PI * 0.985,
      (210 / r) * (1 + 0.45 * a) + L_PI * a * a * a * a,
    );
    const closeEnd = quint(lNorm(a, 0.92, 1));
    const closeRad = 1 - quint(lNorm(r, 600, 850));
    const delta = mix(raw, L_PI, Math.max(closeEnd, closeRad));
    const p = (ang) => [c.cx + r * Math.cos(ang), c.cy + r * Math.sin(ang)];
    if (delta <= L_PI / 2 + 1e-6) {
      const p0 = p(base - delta),
        p1 = p(base + delta);
      return `M${lRound(p0[0])} ${lRound(p0[1])} A${lRound(r)} ${lRound(r)} 0 0 1 ${lRound(p1[0])} ${lRound(p1[1])}`;
    }
    const p0 = p(base - delta),
      pm = p(base),
      p1 = p(base + delta);
    return `M${lRound(p0[0])} ${lRound(p0[1])} A${lRound(r)} ${lRound(r)} 0 0 1 ${lRound(pm[0])} ${lRound(pm[1])} A${lRound(r)} ${lRound(r)} 0 0 1 ${lRound(p1[0])} ${lRound(p1[1])}`;
  }

  function lSetPath(el, d) {
    if (!el) return;
    el.setAttribute("d", d);
    el.style.display = d ? "" : "none";
  }

  function lDrawCircle(c, side, p) {
    if (p <= 1e-5) return "";
    if (p >= 0.99999) return lFullCircle(c);
    const start = side === "left" ? L_PI : 0;
    const sweep = L_TAU * p,
      a = start + sweep;
    const x0 = c.cx + c.r * Math.cos(start),
      y0 = c.cy + c.r * Math.sin(start);
    const x1 = c.cx + c.r * Math.cos(a),
      y1 = c.cy + c.r * Math.sin(a);
    if (sweep <= L_PI)
      return `M${lRound(x0)} ${lRound(y0)} A${lRound(c.r)} ${lRound(c.r)} 0 0 1 ${lRound(x1)} ${lRound(y1)}`;
    const mid = start + L_PI;
    const xm = c.cx + c.r * Math.cos(mid),
      ym = c.cy + c.r * Math.sin(mid);
    return `M${lRound(x0)} ${lRound(y0)} A${lRound(c.r)} ${lRound(c.r)} 0 0 1 ${lRound(xm)} ${lRound(ym)} A${lRound(c.r)} ${lRound(c.r)} 0 0 1 ${lRound(x1)} ${lRound(y1)}`;
  }

  function lDrawPenTip(c, side, p) {
    if (p <= 0.07 || p >= 0.995) return "";
    const a0 = (side === "left" ? L_PI : 0) + L_TAU * Math.max(0, p - 0.095);
    const a1 = (side === "left" ? L_PI : 0) + L_TAU * p;
    const pts = [];
    for (let j = 0; j <= 12; j++) {
      const a = mix(a0, a1, j / 12);
      pts.push(
        (j ? "L" : "M") +
          lRound(c.cx + c.r * Math.cos(a)) +
          " " +
          lRound(c.cy + c.r * Math.sin(a)),
      );
    }
    return pts.join(" ");
  }

  function lPaintArcs(side, tail, head) {
    const length = Math.max(0, head - tail);
    const op = clamp(length / 0.04, 0, 1);
    for (let i = 0; i < 2; i++) {
      const meta =
        side === "right"
          ? i === 0
            ? { cx: 360, cy: 80, a0: L_PI / 2, a1: L_PI }
            : { cx: 80, cy: 360, a0: -L_PI / 2, a1: 0 }
          : i === 0
            ? { cx: 80, cy: 360, a0: -L_PI / 2, a1: 0 }
            : { cx: 360, cy: 80, a0: L_PI / 2, a1: L_PI };
      if (head - tail < 0.0005) {
        lSetPath(lArcs[i], "");
        lSetPath(lFine[i], "");
        continue;
      }
      const ang0 = mix(meta.a0, meta.a1, tail),
        ang1 = mix(meta.a0, meta.a1, head);
      const x0 = meta.cx + 140 * Math.cos(ang0),
        y0 = meta.cy + 140 * Math.sin(ang0);
      const x1 = meta.cx + 140 * Math.cos(ang1),
        y1 = meta.cy + 140 * Math.sin(ang1);
      const d = `M${lRound(x0)} ${lRound(y0)} A140 140 0 0 1 ${lRound(x1)} ${lRound(y1)}`;
      lSetPath(lArcs[i], d);
      lSetPath(lFine[i], d);
      lArcs[i].style.strokeOpacity = String(op);
      lFine[i].style.strokeOpacity = String(op * 0.3);
    }
  }

  function lPaintCircles(side, prog) {
    for (let i = 0; i < 3; i++) {
      const c = lStableCircle(side, i);
      lSetPath(lMain[i], lDrawCircle(c, side, prog[i]));
      lSetPath(lTips[i], lDrawPenTip(c, side, prog[i]));
      lSetPath(lLines[i], "");
    }
  }

  function lPaintStable(side) {
    for (let i = 0; i < 3; i++) {
      lSetPath(lMain[i], lFullCircle(lStableCircle(side, i)));
      lSetPath(lLines[i], "");
      lSetPath(lTips[i], "");
    }
  }

  function updateLoadingV24(dtSec) {
    if (!lActive) return;
    lElapsed += dtSec * motionSpeed;
    while (lElapsed >= L_DUR[lStage] && lStage !== "done") {
      lElapsed -= L_DUR[lStage];
      if (lStage === "intro") lStage = "introArc";
      else if (lStage === "introArc")
        lStage = lExitQueued ? "outroArc" : "loop";
      else if (lStage === "loop") {
        lCycle++;
        if (lExitQueued || lCycle >= 1) lStage = "outroArc";
      } else if (lStage === "outroArc") lStage = "outro";
      else if (lStage === "outro") {
        lStage = "done";
        finishLoadingMode();
        return;
      }
    }

    const u = clamp(lElapsed / (L_DUR[lStage] || 1), 0, 1);
    if (lStage === "intro") {
      const p = quint(u);
      const d = [
        clamp(p / 0.34, 0, 1),
        clamp((p - 0.34) / 0.32, 0, 1),
        clamp((p - 0.66) / 0.34, 0, 1),
      ].map(quint);
      lPaintCircles("left", d);
      lPaintArcs("left", 0, 0);
      descBar.textContent =
        "LOADING V24 · 入场：大圆、中圆、小圆按尺寸依次从公共切点展开 (点击任意处可提前离场)";
    } else if (lStage === "introArc") {
      lPaintStable("left");
      lPaintArcs("left", 0, quint(u));
      descBar.textContent = "LOADING V24 · 灰弧向前生长，标记主复变换起点";
    } else if (lStage === "loop") {
      const l = u * 6.82;
      const leftTail = quint(lNorm(l, 0, L_LOOP.leftTailEnd));
      const s = -1 + 2 * quint(lNorm(l, L_LOOP.morphStart, L_LOOP.morphEnd));
      const rightHead = quint(
        lNorm(l, L_LOOP.rightHeadStart, L_LOOP.rightHeadEnd),
      );
      const rightTail = quint(
        lNorm(l, L_LOOP.rightHeadEnd, L_LOOP.rightTailEnd),
      );
      const rotP = quint(lNorm(l, L_LOOP.rotateStart, L_LOOP.rotateEnd));
      const leftHead = quint(
        lNorm(l, L_LOOP.leftHeadStart, L_LOOP.leftHeadEnd),
      );

      if (l < L_LOOP.morphStart) {
        lPaintStable("left");
        lPaintArcs("left", leftTail, 1);
        descBar.textContent =
          "LOADING V24 · 左侧灰弧回收，相切三圆准备进入复变反演";
      } else if (l < L_LOOP.morphEnd) {
        const useLine = Math.abs(s) < 0.065;
        for (let i = 0; i < 3; i++) {
          lSetPath(lTips[i], "");
          if (useLine) {
            lSetPath(lMain[i], "");
            lSetPath(lLines[i], lLinePath(s, i));
          } else {
            const side = s < 0 ? "left" : "right";
            const c =
              Math.abs(s) >= 1 - 1e-9 ? lStableCircle(side, i) : lCurve(s, i);
            lSetPath(
              lMain[i],
              c.r < 600 ? lFullCircle(c) : lCircleArc(c, s, i),
            );
            lSetPath(lLines[i], "");
          }
        }
        if (l < L_LOOP.leftTailEnd) lPaintArcs("left", leftTail, 1);
        else if (l > L_LOOP.rightHeadStart) lPaintArcs("right", 0, rightHead);
        else lPaintArcs("left", 0, 0);
        descBar.textContent =
          "LOADING V24 · 主变换连续穿越 (T₋₁ → T₀ 竖线簇 → T₊₁)";
      } else if (l < L_LOOP.rotateStart) {
        lPaintStable("right");
        if (l < L_LOOP.rightHeadEnd) lPaintArcs("right", 0, rightHead);
        else lPaintArcs("right", rightTail, 1);
        descBar.textContent = "LOADING V24 · 右侧相切三圆稳态与灰弧流动";
      } else if (l < L_LOOP.rotateEnd) {
        for (let i = 0; i < 3; i++) {
          lSetPath(lTips[i], "");
          lSetPath(
            lMain[i],
            lFullCircle(lRotate(lStableCircle("right", i), L_PI * rotP)),
          );
          lSetPath(lLines[i], "");
        }
        if (l < L_LOOP.rightTailEnd) lPaintArcs("right", rightTail, 1);
        else if (l > L_LOOP.leftHeadStart) lPaintArcs("left", 0, leftHead);
        else lPaintArcs("left", 0, 0);
        descBar.textContent = "LOADING V24 · 严格共切旋回 (R_θ ∘ T₊₁ → T₋₁)";
      } else {
        lPaintStable("left");
        lPaintArcs("left", 0, leftHead);
      }
    } else if (lStage === "outroArc") {
      lPaintStable("left");
      lPaintArcs("left", quint(u), 1);
      descBar.textContent = "LOADING V24 · 离场：弧尾追随收拢";
    } else if (lStage === "outro") {
      const p = quint(u);
      const d = [
        1 - quint(lNorm(p, 0.66, 1)),
        1 - quint(lNorm(p, 0.34, 0.66)),
        1 - quint(lNorm(p, 0, 0.34)),
      ];
      lPaintCircles("left", d);
      lPaintArcs("left", 0, 0);
      descBar.textContent =
        "LOADING V24 · 离场：小圆、中圆、大圆逆序收回，即将返回枢空间";
    }
  }

  return {
    start() {
      lActive = true;
      lStage = "intro";
      lElapsed = 0;
      lCycle = 0;
      lExitQueued = false;
    },
    exit() {
      if (lActive && lStage !== "outro" && lStage !== "outroArc") {
        lStage = "outroArc";
        lElapsed = 0;
        lExitQueued = true;
      }
    },
    update(dt, speed = 1) {
      motionSpeed = speed;
      updateLoadingV24(dt / 1000);
    },
  };
}
