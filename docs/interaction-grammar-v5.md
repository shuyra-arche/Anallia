# Shuyra Field · v5 Attachment & Navigation Grammar

This document supersedes v4 wherever layout or scale constraints conflict.

## Decisions fixed in this iteration

1. **Ordinary and local labels share one renderer and one hub curve.** Local labels are transient items *appended before or after the focused ordinary label*, along its material arc-length coordinate. They are not a separate vertical menu, card or side panel.
2. **The nearest ordinary siblings constrain the local aperture.** Ordinary labels never move to make room. For 1–4 visible slots, use a finite arc-length interval; when items exceed capacity, keep that interval fixed and scroll its items (wheel on local label, or single-finger drag on local label). Local scroll never triggers chapter navigation, grasp, content flip or Möbius.
3. **Some global commands are spatially attached.** `⌕` and `⚙` have global semantic scope but are rendered from dedicated material anchors of the focused hub. `⊙` and `↶` remain screen-available in overview/free exploration. The global operation identity is independent of its attachment host.
4. **Adaptive Orientation selects direction only.** It never changes the hub centre, material anchors, other labels, camera or article dimensions. It does not clamp article bounds to the viewport or place all content inside it. Text blocks may cross or be wholly outside viewport bounds.
5. **Constant screen-size drawing.** The camera projects hub *centres* and their relative spatial arrangement. Individual hub radius, line geometry, line width, label text, hit targets, article sizes and atmospheric brush scale stay in screen units independent of zoom. Material point projection is `hubToScreen`; `hubScreenCamera` supplies its invariant drawing chart.
6. **Camera focus framing is explicit.** When entering a hub, the reading anchor is framed in a readable location, including on narrow displays. Subsequent adaptive direction changes are forbidden to reposition the camera.
7. **Existing motion grammar is preserved.** Content replacement at one hinge → Page Flip; circle↔line → Möbius Morph; ordinary sibling → Traverse; parent↔child → Axis Rotation when relation exists; other hub switches → Near/Flight/Remote by distance. Local scrolling/heading orientation must not start these transitions.

## Arc-length aperture

For a focused tag at arc position `s`, determine the available gap from the prior and next ordinary tags. Choose the side that accommodates more 45-pixel slots (ties preserve the previous direction), leave a 30-pixel reserve next to a neighbour, cap visible slots at four. For local index `i` and local scroll position `q`:

```
slot = i - q
s_local = arcOffsetS(hub, s_focus, direction * (slot + 1) * 45)
```

Only slots inside the finite aperture are rendered. Edge opacity is reduced to avoid an abrupt cut. The SVG label rendering and accessibility hit targets are the same as for ordinary labels.

## Ownership and boundaries

`Catalog` owns semantic chapter/link identity. `Hub` owns material curve, focus and local scroll offset. `Scene` derives projected anchors and the per-frame local aperture. `Input` routes wheel / pointer displacement based on whether the pointer holds a local label, the hub curve, article or free canvas. `Camera` never changes the size of attached UI objects.

The UI deliberately allows clipping at the viewport edge. This is not a signal to rearrange the graph.
