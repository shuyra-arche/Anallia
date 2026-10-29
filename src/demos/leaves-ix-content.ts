import type { ContentManifest, ContentSource } from "../core/content.ts";
import { buildSearchEntry } from "../content/search.ts";

/** Original text for a typographic study; no chapter text or page facsimiles. */
export const leavesIxPages = [
  {
    id: "ix-entry",
    name: "IX",
    parent: null,
    hub: "IX",
    title: "门开在句子的侧面",
    circle:
      "先沿着{正文|ix-turn}走。也可以从这里转入{注释 01|ix-note}，或穿过那扇{蓝色空窗|ix-void}。\n\n测量员在纸边画了一条线，作为房间的终点。第二次经过时，线仍在原处，房间却已经多出一个转角。\n\n你所读到的不是房间的说明。每一次离开主句，都在它的墙上添了一扇门。",
    line: "走廊倾斜了，字却仍然平放着。沿{正文|ix-turn}前行，或者从句子的侧面进入{注释 01|ix-note}。\n\n倾斜发生在空间里，阅读仍有自己的地平线。蓝色的{空室|ix-void}位于另一条路径上。",
    next: "ix-turn",
    note: "ix-note",
    label: "门槛",
  },
  {
    id: "ix-turn",
    name: "01",
    parent: "ix-entry",
    hub: "IX",
    title: "折角之后，还是折角",
    circle:
      "你已经走进{下一句|ix-echo}。右侧的{注释 02|ix-note-two}声称，这里曾有一条更短的路。\n\n我们把这条通道记作 A，又将返回的通道记作 B。直到第三次折返，才发现 A 和 B 的笔画完全相同。\n\n纸面没有增长。只是留给正文的地方越来越小。你可以继续走，也可以返回{门槛|ix-entry}。",
    line: "向前是{回声|ix-echo}，侧面是{注释 02|ix-note-two}。\n\n地图上的线并不比走廊更诚实。它只省略了等待，省略了回头，也省略了你曾在同一个地方停下两次。",
    next: "ix-echo",
    note: "ix-note-two",
    label: "折角",
  },
  {
    id: "ix-echo",
    name: "02",
    parent: "ix-entry",
    hub: "IX",
    title: "这里多出了一次回声",
    circle:
      "{出口|ix-exit}看上去很近。{注释 01|ix-note}却把你送回了进来时的位置。\n\n先有脚步，再有脚步的回答。我们等了很久，才明白第二个声音并没有晚到；是第一个声音尚未离开。\n\n空白不是停顿。空白是另一段尚未开始的路。",
    line: "走向{出口|ix-exit}，或者重读{注释 01|ix-note}。\n\n两条水平的句子之间，留下了一层无法标注的楼板。你在上面读，另一个方向的回声在下面继续。",
    next: "ix-exit",
    note: "ix-note",
    label: "回声",
  },
  {
    id: "ix-exit",
    name: "03",
    parent: "ix-entry",
    hub: "IX",
    title: "出口在你翻回的那一页",
    circle:
      "推开{门槛|ix-entry}，这一页便再次成为入口。你也可以最后看一眼{空室|ix-void}。\n\n墙上没有留下箭头。我们把沿途的注释折回原位，发现它们拼成了另一间屋子的平面。\n\n你没有走出纸张。你只是找到一种暂时不再转弯的读法。",
    line: "{回到门槛|ix-entry}，或者进入{空室|ix-void}。\n\n走廊终于平直了。没有人能确定，这是出口，还是地图忘记再画一个折角。",
    next: "ix-entry",
    note: "ix-note-two",
    label: "出口",
  },
  {
    id: "ix-note",
    name: "n.01",
    parent: null,
    hub: "IX-N",
    title: "注释 01：主句之外",
    circle:
      "这条注释通往{注释 02|ix-note-two}。若仍记得来路，可以回到{门槛|ix-entry}。\n\n原来写在页脚的文字，慢慢占满了房间。正文被挤到一旁，成了它自己的旁注。\n\n记录员写道：只需解释一个词。其后又补了一句，解释为什么这个词需要解释。",
    line: "{下一条注释|ix-note-two}，或{返回正文|ix-entry}。\n\n一条旁注不再附属于主句的时候，它是否也需要自己的页脚？这里暂不作答。答案另见旁注。",
    next: "ix-note-two",
    note: "ix-entry",
    label: "注释 01",
  },
  {
    id: "ix-note-two",
    name: "n.02",
    parent: "ix-note",
    hub: "IX-N",
    title: "注释 02：未出现之物",
    circle:
      "这一段通往{空室|ix-void}。索引的另一端则返回{注释 01|ix-note}。\n\n" +
      [
        "没有钟，没有向外的窗，没有第二把钥匙。",
        "没有挂画，没有门牌，没有被搬走的家具留下的浅印。",
        "没有可以证明这里曾经有人停留过的灰尘。",
        "没有一条清单能够把空缺逐项列完。",
        "没有信箱，没有尚未寄出的信，没有等待收信的人。",
        "没有窗帘，没有因日照而褪色的一小块地板。",
        "没有固定朝向。走近的墙和离开的墙，在纸上拥有同一个名字。",
        "没有能够展开的地图。折痕只通向更多折痕。",
        "没有一架停在这里的梯子。向上的意思留给了另一条注释。",
        "没有树，也没有被树影掩去的门。蓝色只属于边界。",
        "没有第二个脚步。你听见的只是第一步绕过了房间。",
        "没有尺子。每一次量出的距离，都比上一次多一个词。",
        "没有正面与背面的标记。纸张却仍然要求你继续转动它。",
        "没有终点。清单在绕完一圈之后，将下一句交给了下一行。",
        "没有人能读完所有空白。我们只把读到的地方留在同一条水平线上。",
      ].join("\n\n") +
      "\n\n记录到此，墙的另一面传来了翻页声。{回到正文|ix-echo}。",
    line: "{空室|ix-void}，或{正文|ix-echo}。\n\n没有钟。\n\n没有窗。\n\n没有墙的另一面。\n\n至少，纸上没有。",
    next: "ix-void",
    note: "ix-note",
    label: "注释 02",
  },
  {
    id: "ix-void",
    name: "□",
    parent: null,
    hub: "IX-V",
    title: "空室没有内部",
    circle:
      "从{蓝色边界|ix-entry}回去。或者读一读{它没有的东西|ix-note-two}。\n\n这间屋子里没有句子。句子留在边缘，围住一小块拒绝说明自己的空白。\n\n你停留得越久，边缘就显得越厚。",
    line: "从这里返回{门槛|ix-entry}。旁边仍保留着{未出现之物的清单|ix-note-two}。\n\n屋子被打开以后，内部并没有随之出现。只剩一条斜向延伸的界线，以及几行拒绝跟着它倾斜的文字。",
    next: "ix-entry",
    note: "ix-note-two",
    label: "空室",
  },
] as const;

export function createLeavesIxDemo(
  base: ContentManifest,
  fallback: ContentSource,
) {
  const pages = new Map<string, (typeof leavesIxPages)[number]>(
    leavesIxPages.map((page) => [page.id, page]),
  );
  const manifest: ContentManifest = {
    ...base,
    definitions: [
      {
        id: "IX",
        glyph: "IX",
        root: "ix-entry",
        center: { x: -2700, y: 1500 },
        angle: -12,
        morph: 0,
        theme: "parchment",
        readingLayoutMode: "geometric",
      },
      {
        id: "IX-N",
        glyph: "n.",
        root: "ix-note",
        center: { x: -1700, y: 2300 },
        angle: 22,
        morph: 0,
        theme: "parchment",
        readingLayoutMode: "geometric",
        parentHub: "IX",
      },
      {
        id: "IX-V",
        glyph: "□",
        root: "ix-void",
        center: { x: -3500, y: 2300 },
        angle: 28,
        morph: 1,
        theme: "parchment",
        readingLayoutMode: "geometric",
        parentHub: "IX",
      },
      ...base.definitions,
    ],
    chapters: [
      ...base.chapters,
      ...leavesIxPages.map((page) => ({
        id: page.id,
        name: page.name,
        parent: page.parent,
        title: page.title,
        hub: page.hub,
        refs: [
          { glyph: "→", target: page.next },
          { glyph: "n.", target: page.note },
        ],
        inlineTargets: [
          ...new Set([
            page.next,
            page.note,
            ...Array.from(
              (page.circle + page.line).matchAll(/\{[^{}|]+\|([^{}]+)\}/g),
              (match) => match[1],
            ),
          ]),
        ],
      })),
    ],
    searchIndex: [
      ...base.searchIndex,
      ...leavesIxPages.map((page) => buildSearchEntry(page)),
    ],
  };
  const source: ContentSource = {
    async *open(id, presentation, signal) {
      if (signal.aborted) return;
      const page = pages.get(id);
      if (page) yield { type: "replace", text: page[presentation] };
      else yield* fallback.open(id, presentation, signal);
    },
  };
  return { manifest, source, entry: "ix-entry" };
}
