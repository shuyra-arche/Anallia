import type { ReaderDefinition } from "../core/content.ts";
import type { ContentRow, HubDefinition } from "../core/types.ts";
import { LocalContentSource } from "../content/source.ts";
import { buildStaticReader } from "../content-builder.ts";

// Fictional field notes: a content-only integration, with no renderer or Field access.
const observations = [
  "门檐落下的水把门口分成两种声音，靠墙的一侧更轻，石阶上的一侧更密。",
  "桥下的倒影先于岸上的树枝晃动。记录者把这段差别留在页边，没有替它寻找结论。",
  "旧砖的接缝留下了一条弯线，走近时才看见，弯线并没有连到下一块砖。",
  "同一片叶子在两个观察位置呈现不同的颜色。手册保留了两种描述，没有选其中一种覆盖另一种。",
  "巷口的招牌倒映在水面，字的顺序没有改变，笔画的间距却随脚步拉开。",
  "有人把伞收在门外，短暂的水声与路面上的声响重合，随后又分开。",
];
const longRecord = [
  "这是一篇虚构的连续观察记录，不是现场数据，也不用于出行或工程判断。可以顺着记录读，也可以沿引用回到具体的观察位置。",
  ...Array.from({ length: 36 }, (_, i) => `记录 ${String(i + 1).padStart(2, "0")} · ${6 + Math.floor(i / 2)}:${i % 2 ? "30" : "00"}。${observations[i % observations.length]}记录中保留了观察的顺序：先写下所见，再写下当时站立的位置，最后记下仍然无法确定的部分。下一段并不替上一段作解释；它只是把另一时刻放在旁边。`),
  "回到{砖缝旁的标记|obs-mark}，可以找到这篇长记录的细小起点。对照{记录尺度|atlas-scale}，也可以换一种方式阅读相同的段落。",
].join("\n\n");
const same = (id: string, name: string, parent: string | null, title: string, body: string, refs: [string, string][] = []): ContentRow =>
  [id, name, parent, title, body, body, refs];

export const notebookRows: Record<string, ContentRow[]> = {
  OBS: [
    same("obs-start", "迹₀", null, "雨后观察手册", "一份虚构的街巷观察笔记。这里有三条可交叉的阅读路径：现场、连续记录和对照页。\n\n从{巷口路线|obs-walk}进入细节，或直接读{一天的连续记录|log-day}。章节深浅不一，回到来处时，仍保留刚才读到的位置。", [["录", "log-day"], ["尺", "atlas-start"]]),
    same("obs-walk", "迹₁", "obs-start", "沿着巷口走", "从{门檐下|obs-gate}开始，经过{桥边|obs-bridge}。这里记录位置之间的关系，不给出推荐路线。", [["尺", "atlas-scale"]]),
    same("obs-gate", "迹₁₁", "obs-walk", "门檐下", "雨已经停了。门檐上的声音还在继续。\n\n再靠近一点，读{石阶边缘|obs-curb}。"),
    same("obs-curb", "迹₁₁₁", "obs-gate", "石阶边缘", "一道浅痕。\n\n它的末端有一个{砖缝旁的标记|obs-mark}。"),
    same("obs-mark", "迹₁₁₁₁", "obs-curb", "砖缝旁的标记", "两片叶子，一条没有闭合的水线。\n\n这个很小的位置，后来出现在{连续记录|log-day}里。", [["录", "log-day"]]),
    same("obs-bridge", "迹₁₂", "obs-walk", "桥边的另一种声音", "桥下没有新的章节，只有一条通往{傍晚便签|log-evening}的引用。它与门檐是同级观察位置。", [["录", "log-evening"]]),
    same("obs-method", "迹₂", "obs-start", "留下未确定的部分", "相邻的笔记可以互相补充，也可以保留差异。不要把后写的记录自动当作前一条的修正。\n\n{词语对照|atlas-words}收录了这份手册反复使用的几个词。"),
  ],
  LOG: [
    same("log-start", "录₀", null, "连续记录", "这里用一条线排列密度不同的文字。\n\n{长记录|log-day}保留完整顺序；{午后便签|log-noon}很短；{傍晚便签|log-evening}保留了一次回看。"),
    same("log-day", "录₁", "log-start", "一天的连续记录", longRecord, [["迹", "obs-mark"], ["尺", "atlas-scale"]]),
    ["log-noon", "录₂", "log-start", "午后便签", "圆态便签：先看水线的缺口。\n\n风经过巷口，两片叶子交换了位置。没有新的结论。", "线态便签：记录顺序放在前面。\n\n刚才的观察仍然成立，但这里不重复解释。\n\n风经过巷口，两片叶子交换了位置。没有新的结论。", []],
    same("log-evening", "录₃", "log-start", "傍晚便签", "回看时，最初写下的几句话显得太肯定。于是这张便签只补上一个问号，保留原来的句子。\n\n{桥边|obs-bridge}的声音仍可以从另一条路径找到。", [["迹", "obs-bridge"]]),
  ],
  ATLAS: [
    same("atlas-start", "尺₀", null, "对照页", "这里不沿时间排列，先选择一种对照方式。\n\n{记录尺度|atlas-scale}说明一段文字看多远，{词语对照|atlas-words}说明它如何命名。"),
    same("atlas-scale", "尺₁", "atlas-start", "记录尺度", "[vlist]\n近处 :: 一条砖缝、两片叶子；见{标记|obs-mark}。\n中间 :: 门檐与桥边之间没有直接的父子关系。\n远处 :: {连续记录|log-day}把一天并排放在纸上。\n\n这些是阅读尺度，不是测量单位。", [["迹", "obs-mark"], ["录", "log-day"]]),
    same("atlas-words", "尺₂", "atlas-start", "词语对照", "[vlist]\n水线 :: 留下方向的短暂边界。\n回看 :: 重新进入旧记录，不删除先前的描述。\n空缺 :: 明确留下尚未确定的部分。\n\n{回到手册起点|obs-start}。"),
  ],
  FIND: [same("find-start", "⌕", null, "查找手册", "试着搜索「砖缝」或「连续记录」，从结果返回原来的观察位置。")],
};

export function createStaticFieldNotebook(): ReaderDefinition {
  const definitions: HubDefinition[] = [
    { id: "OBS", glyph: "迹", root: "obs-start", center: { x: 3000, y: 1500 }, angle: -12, morph: 0, theme: "celadon" },
    { id: "LOG", glyph: "录", root: "log-start", center: { x: 4500, y: 1900 }, angle: 24, morph: 1, theme: "parchment", parentHub: "OBS" },
    { id: "ATLAS", glyph: "尺", root: "atlas-start", center: { x: 3500, y: 400 }, angle: -34, morph: 0, theme: "ivory", readingLayoutMode: "geometric" },
    { id: "FIND", glyph: "⌕", root: "find-start", kind: "search", layout: "anchored", recommendations: ["obs-start", "obs-mark", "log-day", "atlas-scale"], center: { x: 4900, y: 600 }, angle: 0, morph: 0, theme: "ivory" },
  ];
  return buildStaticReader({
    title: "雨后观察手册 · Anallia", entry: "obs-start",
    hubs: definitions.map(({ morph, ...hub }) => ({ ...hub, presentation: morph > 0.5 ? "line" : "circle" })),
    chapters: Object.entries(notebookRows).flatMap(([hub, rows]) => rows.map(([id, name, parent, title, circle, line, refs]) => ({
      id, name, parent, title, hub, body: circle === line ? circle : { circle, line },
      refs: refs.map(([label, target]) => ({ label, target })),
    }))),
  });
}

/** The advanced chunked source remains available; authoring uses the same builder. */
export function createFieldNotebook(): ReaderDefinition {
  const definition = createStaticFieldNotebook();
  const loaders = Object.fromEntries(Object.entries(notebookRows).map(([hub, rows]) => [hub, async () => Object.fromEntries(rows.map(([id, , , , circle, line]) => [id, { circle, line }]))]));
  return { ...definition, source: new LocalContentSource(definition.manifest, loaders, { chunkSize: 96 }) };
}
