import { buildStaticReader } from "../content-builder.ts";
import type { ReaderDefinition } from "../core/content.ts";
import type { StaticChapter } from "../core/static-content.ts";

export const tidePlaces = [
  { hub: "SHORE", chapter: "shore-entry", mark: "01", name: "岸", description: "看见留下的痕迹" },
  { hub: "LIGHT", chapter: "light-entry", mark: "02", name: "塔", description: "换一个距离观看" },
  { hub: "LETTER", chapter: "letter-entry", mark: "03", name: "信", description: "把远方带回此处" },
] as const;

const chapters: readonly StaticChapter[] = [
  { id: "shore-entry", hub: "SHORE", name: "岸", title: "潮汐之间", body:
`一座岛，三种抵达的方式。

潮水退去以后，岸上留下痕迹；灯亮起来以后，远方有了方向。一封没有寄出的信，把两者连在一起。

从{潮线|shore-tide}读起。也可以循着远处的光，先去{灯塔|light-entry}。`, refs: [{ label: "塔", target: "light-entry" }, { label: "信", target: "letter-entry" }] },
  { id: "shore-tide", hub: "SHORE", parent: "shore-entry", name: "潮", title: "水曾到过这里", body:
`沙面上有一道颜色更深的弧。它不围住任何东西，只记得水曾经停在哪里。

我沿着它走。贝壳、细枝和一只褪色的瓶盖，恰好落在同一条线上。潮水没有替它们分类；让它们相遇的，是同一次停顿。

沿岸继续，下一处是{拾得物|shore-found}。想靠近看，就读一枚{贝壳的背面|shell-back}。`, refs: [{ label: "壳", target: "shell-back" }] },
  { id: "shell-back", hub: "SHORE", parent: "shore-tide", name: "壳", title: "贝壳的背面", body:
`正面留着细密的纹路，背面被海磨得很平。指尖在两种触感之间经过，同一枚壳，像有两个时代。

形状改变了，手里的东西没有换。试着把这一页展开为线，再收拢为圆；这里仍然是这里。

壳的缺口朝向海。许多年以前，它属于一个活着的身体。现在它属于一段{未寄出的信|letter-entry}。`, refs: [{ label: "信", target: "letter-entry" }] },
  { id: "shore-found", hub: "SHORE", parent: "shore-entry", name: "拾", title: "留下来的东西", body:
`口袋里不必装满。离开海岸时，我只带走了三样东西。

[vlist] 一枚有缺口的白色贝壳 | 一张被盐水洇开的蓝纸 | 一段还没有找到收信人的话

纸背写着一个时间：十七点四十。那正是{塔上换灯的人|light-keeper}开始工作的时刻。`, refs: [{ label: "灯", target: "light-keeper" }] },
  { id: "shore-return", hub: "SHORE", parent: "shore-entry", name: "返", title: "岸不是边界", body:
`回程时，潮线已经不在原处。先前的脚印，一半在水里，一半还留着。

我终于明白，岸不是陆地的句号。它是一处反复修改的相遇：水向前一步，人退后一步。

如果你愿意，可以从这里去{塔上|light-entry}，或在{回信|letter-reply}里留下自己的结尾。`, refs: [{ label: "塔", target: "light-entry" }, { label: "回", target: "letter-reply" }] },
  { id: "light-entry", hub: "LIGHT", name: "塔", title: "远方有一盏灯", body:
`从岸上看，灯塔像一个句点。走到塔下，才发现句点也有门，有台阶，有人在里面生活。

光每隔一会儿扫过海面。看见它的人各不相识，却在同一刻知道：这里有人。

读{守灯人的一晚|light-keeper}，或者走到{窗边|light-window}。`, refs: [{ label: "岸", target: "shore-tide" }, { label: "信", target: "letter-entry" }] },
  { id: "light-keeper", hub: "LIGHT", parent: "light-entry", name: "灯", title: "守灯人的一晚", body:
`十七点四十，守灯人把一只空杯放到窗台上。海还没有变暗，玻璃已经先于天空亮了起来。

他每天做的第一件事，不是开灯，而是看岸。今天潮水退得很远，小路尽头的礁石露出了平整的背。他知道有人会走过去，也知道他们会在天黑以前回来。灯要等到那时，才真正成为灯。

年轻的时候，他以为守灯是一件关于远方的工作。海图上标着水深和暗礁，每一条航线都通往一个他没有去过的地名。他把那些名字念出声来，好像只要念得准确，就能听见另一座港口的钟。

后来他发现，大多数夜晚并没有船经过。灯照向空旷的水面，又慢慢转回来。窗里的杯子明了，暗了，再明了。重复没有减少这件工作的意义，因为海上的人不会提前告诉他，哪一晚需要光。

他曾收到一封没有地址的信。信封上只有“岛上亮灯的地方”。邮递员把它送到塔下时笑了很久，说这个地址比许多门牌都清楚。信里没有请求，也没有署名，只夹着一片很薄的蓝纸。

蓝纸被水浸过，边缘像一条小小的海岸。守灯人没有把它压平。他把纸放在窗边，让灯从褶皱间穿过去。白天看不见的纹路，到了夜里，像一张从未测绘过的地图。

那天以后，空杯旁边多了一片纸。有人问他为什么留着，他说，灯能告诉人方向，却不知道人从哪里来。这片纸提醒他，远方不只是需要照亮的地方，也有人正在回望。

夜深的时候，风会从门缝里进来。楼梯发出轻微的响声，像有人停在下一层。守灯人不急着去看；他先等光完成这一圈，再把杯子收进屋里。每一件小事，都有自己的停顿。

清晨，灯熄灭了。海没有因此失去方向。第一班船把新的声音带到岸边，面包店开门，潮线又向前移动了一点。他沿楼梯走下去，经过昨天捡到的那枚贝壳，把它翻到另一面。

故事在这里暂时停下。若想知道蓝纸后来去了哪里，读{那封没有寄出的信|letter-unsent}；若想回到这个夜晚的起点，沿{潮线|shore-tide}走一次。`, refs: [{ label: "信", target: "letter-unsent" }, { label: "潮", target: "shore-tide" }] },
  { id: "light-window", hub: "LIGHT", parent: "light-entry", name: "窗", title: "从窗里看海", body:
`同一片海，从岸上看是声音，从塔上看是距离。

窗框没有改变海，却给了目光一个尺度。远处的船变成一个点；刚才踩过的潮线，也成为地图上的一笔。

把视野拉到全域，再回来。你带走的不是另一张地图，而是同一处位置的两种理解。`, refs: [{ label: "岸", target: "shore-entry" }] },
  { id: "letter-entry", hub: "LETTER", name: "信", title: "给尚未抵达的人", body:
`这封信没有日期。纸角留着盐，像一句话说到一半，又被海风打断。

你可以把它当作岛的结尾，也可以把它当作另一条路的开头。

{展开这封信|letter-unsent}。读完以后，替它想一个{回音|letter-reply}。`, refs: [{ label: "岸", target: "shore-entry" }, { label: "灯", target: "light-keeper" }] },
  { id: "letter-unsent", hub: "LETTER", parent: "letter-entry", name: "纸", title: "没有寄出的信", body:
`见字如面。

我本来想告诉你，这座岛很小。后来走了许久，发现小的只是地图。一个人愿意停下来的地方，总比走过的路更深。

今天我在岸边捡到一枚贝壳。正面和背面不一样，握在手里却是同一件东西。我想，我们讲述同一件事的时候，也许只是站在不同的一面。

塔上的灯亮了。我不知道是谁在守着它，也不知道此刻有多少人正在看。只要有人看见，这一圈光就不是白走的。

等你来，我们不必把所有地方都去一遍。沿着潮线走，找到一处愿意停下的地方，就很好。

信写到这里，纸的背面仍然空着。把它留给{你的回音|letter-reply}。`, refs: [{ label: "壳", target: "shell-back" }, { label: "塔", target: "light-entry" }] },
  { id: "letter-reply", hub: "LETTER", parent: "letter-entry", name: "回", title: "把回音留在这里", body:
`如果要给这座岛写一句回信，你会从哪一处开始？

是水曾到过的地方，是一扇亮着的窗，还是纸上没有写完的那一句？

这里没有输入框。先把答案放在心里，再回到{岸边|shore-entry}。同一条路，第二次走，会有不同的读法。`, refs: [{ label: "岸", target: "shore-entry" }] },
  { id: "atlas-find", hub: "FIND", name: "寻", title: "循词而行", body: "用一个词，找到岛上的另一处回声。试试「贝壳」「蓝纸」或「灯」。" },
  { id: "atlas-settings", hub: "SETTINGS", name: "调", title: "让阅读合身", body:
`按自己的节奏留在这里。

[hlist] {减少动效|act:toggle_motion} | {声音开关|act:toggle_sound}

[hlist] {浅色纸面|act:theme_light} | {深色纸面|act:theme_dark}

圆线变化和空间关系保持不变。减少动效后，位置变化直接完成；声音默认关闭。` },
];

export function createTideAtlas(): ReaderDefinition {
  return buildStaticReader({ title: "潮汐之间 · Anallia", entry: "shore-entry", hubs: [
    { id: "SHORE", glyph: "岸", center: { x: 1600, y: 1300 }, angle: 0, theme: "light" },
    { id: "LIGHT", glyph: "塔", center: { x: 3200, y: 400 }, angle: -24, theme: "parchment", presentation: "line", parentHub: "SHORE" },
    { id: "LETTER", glyph: "信", center: { x: 3400, y: 2300 }, angle: 18, theme: "ivory", parentHub: "SHORE" },
    { id: "FIND", glyph: "寻", kind: "search", center: { x: 300, y: 2600 }, theme: "light", recommendations: ["shore-tide", "light-keeper", "letter-unsent"] },
    { id: "SETTINGS", glyph: "调", kind: "settings", center: { x: 0, y: 200 }, theme: "light" },
  ], chapters });
}
