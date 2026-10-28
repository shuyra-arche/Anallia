# Shuyra Field v6 · Hub–Anchor–Attachment–Presentation

## Scope

This revision turns the main label placement paths into a shared data model.
It does **not** redesign transitions, user content, or the 2.5D camera.

### Four independent concerns

- **Hub** (`core/types.ts`): world identity, parent relation, material geometry (circle/line/Möbius), focused path, local scroll state.
- **SemanticAnchor** (`core/attachments.ts`): stable ID, host hub, material parameter; never stores screen coordinates. Its ID remains stable during Morph and host switch; the material projection is recalculated each frame.
- **FieldAttachment** (`core/attachments.ts`): independent element identity, semantic scope (`global | hub | chapter`), role (`operation | local | ordinary | background`), anchor, presentation side (`content | opposite`), world-unit distance, action, and opacity.
- **Presentation / Projection** (`core/layout.ts`, `geometry/attachments.ts`): screen-space layout chooses an orientation, then projects a material anchor and its local normal. Camera zoom scales hub positions, normal offsets, labels, icons, typography, strokes, backgrounds, and hit targets together. This user-requested rule supersedes the original fixed-screen-size projection.

The element identity and scope do not change when its host hub changes:

```text
operation:settings (global scope)
       │
       ▼
focused-hub:alpha / operation:settings
       │ focus changes
       ▼
focused-hub:beta  / operation:settings
```

### Placement grammar

`ordinary` and `local` use the same `content` side of the focused hub.
Local items appear immediately before or after the ordinary focused tag, following the same generalized-circle arc-length ordering and bounded scrolling band. When ordinary-label scrolling changes focus, the outgoing local group folds closed around its material hinges before the new group unfolds. Retired leaves retain their old glyphs and commands until removed; turning leaves are not interactive. Rapid scrolling drops unopened intermediate groups, and reduced motion settles the current group immediately. Their visible count widens neighboring ordinary-label gaps; the focused material anchor stays fixed.

In focused reading at camera zoom 0.45 or above, global operations `⊙ ⌕ ⚙ ◌ ↶` attach to material points on the opposite side of the host hub. During cross-hub passages they use the destination host immediately. The attachment planner also defines an overview refocus action; the renderer uses a fixed toolbar in overview and below zoom 0.45, including `⌖`. Global scope describes the operation's meaning independently of either presentation.

At a semantic material point `s`:

```text
H = project(material(hub, s))
N = projected unit Darboux normal(hub, s)
P_content  = H + D_content × sign × N
P_global   = H - D_global  × sign × N
```

The renderer currently uses `sign = 1` for material-side composition. A line and a circle share this rule, and morphing changes only the geometry chart.

The final anchor is never moved by adaptive layout. Text can extend outside the viewport. No clamping or automatic camera movement is added here.

### Runtime responsibilities

1. `application/attachments.ts` produces read-only, DOM-independent attachment plans from Catalog + Hub + focus state. It also computes the local scrolling capacity.
2. `geometry/attachments.ts` projects all attachment roles with the same material point and normal.
3. `rendering/scene.ts` paints the resolved attachments and maps their commands; it no longer creates ad-hoc global command locations or modifies local scroll state.
4. `application/field.ts` bounds local scroll by its actual geometric band, avoiding invisible scrolling dead zones.

Hub-attached global actions are declared in `GLOBAL_OPERATIONS` and resolve target hubs through Catalog definitions. The fixed toolbar retains its existing q0 / s0 destinations. Search uses the declared search role and anchored layout rather than a Q ID in geometry.

### Existing transition grammar remains unchanged

- Content replacement at the same semantic hinge: Page Flip.
- Circle↔line form: Möbius Morph, no unconditional Page Flip.
- Same hub between material anchors: Traverse / Grasp.
- Parent/child hubs: Axis Rotation when parent relation is declared.
- Cross-hub: Near / Flight / Remote according to topology and distance.

### Known constraints

- In very narrow viewports, hub-attached global operations can be outside the screen. This is deliberately **not** repaired by shrinking labels or shifting hubs; it is the consequence of the requested spatial-composition rule. A future discoverability strategy can be designed separately.
- Presentation still uses existing article layout/cache and transition rendering. v6 unifies **label attachment semantics and geometry projection**, not the complete article or all effects pipelines.
- No new parent–child hub links are inferred automatically.
