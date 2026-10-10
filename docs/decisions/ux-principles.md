# UX principles

- **Simple, clean, sharp.** Few controls, generous whitespace, crisp type, and clear hierarchy. Every control earns its place.
- **Mobile first.** The web UI must always work great on an iPhone-sized screen, since Stefan uses it from his phone. Design for a 393 px wide viewport first and widen from there.
  - **Layout.** Below 768 px the sidebar becomes a drawer behind a menu button, a floating add button opens quick add, and quick add and task details open as bottom sheets. From 768 px up the sidebar is always visible and sheets float as a centered dialog and a side panel.
  - **Touch.** Every tap target is at least 44 px on phones and touch screens, using an invisible hit area where the visible control is smaller. Fields use at least 16 px text so iOS does not zoom on focus.
  - **No hover-only interactions.** Hover only adds polish. Every action is reachable by tap, and hover styles apply only on devices that can hover.
  - **Safe areas.** The layout respects `env(safe-area-inset-*)` for the notch, the Dynamic Island, and the home indicator.
  - **On-screen keyboard.** Quick add stays usable while the keyboard is open. Sheets dock above the keyboard by tracking the visual viewport, and the return key submits.
  - **Same shapes as iOS.** The drawer, floating add button, and inset bottom sheets map directly to the Liquid Glass port.
- **Motion on every interaction.** Opening, closing, adding, completing, and switching views all animate. Motion is short (about 150 to 250 ms), eased like a spring, and never gates input.
- **Reduced motion.** Under `prefers-reduced-motion`, CSS transitions and animations collapse to instant, and Svelte transitions pass their params through `motion()` in `ui.svelte.ts`, which zeroes the duration. CSS cannot reach Svelte transitions because they animate from script.
- **Liquid Glass parity.** The web UI ports to iOS with Liquid Glass. See [Visual language](visual-language.md) for layering, materials, shapes, motion, spacing, and controls.
