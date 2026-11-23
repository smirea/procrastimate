# Tooltips

On the web, every control that shows only an icon names what it does in a small glass tooltip when the mouse rests on it or keyboard focus lands on it: a row's Postpone and React buttons, the `…` list actions, the sidebar's `Add project`, task details' toolbar, quick add's icon buttons, the project icon grid, and theme swatches. A few controls with text carry a longer hint the same way, and a reaction chip names who reacted. Touch never shows one. iOS has none; its icon buttons carry VoiceOver labels.

## Sub-features

- `tooltip-icon` shows an icon-only control's accessible name after the pointer rests on it for half a second, and at once when the pointer moves straight to another control.
- `tooltip-hint` shows a control's `data-tooltip` text instead, such as `Plain text: …` or a reaction chip's names.
- `tooltip-keyboard` shows the tooltip at once when keyboard focus reaches the control, on devices that can hover.
- `tooltip-dismiss` hides it on press, scroll, wheel, Escape, blur, or when the control leaves, and a pressed control shows none until the pointer leaves it.
- `tooltip-top` renders above menus, popovers, and sheets, inside the viewport, below the control or above it when there is no room.
- `tooltip-touch` never shows for touch or pen.

## How to get to it (user POV)

- Web desktop: hover any icon-only button, or Tab to it.
- Web touch and iOS: not offered.

## Driving it with the browser

Preconditions: the baseline state with one task that has a reaction (hover the row, `React to <title>`, `React 👀`), at 1280 px wide, in light and dark.

- **Row.** Hover `Postpone <title>`: after about 500 ms a tooltip reads `Postpone <title>` under the button, and the row does not move. Move to `React to <title>`: its tooltip shows at once. Hover the `👀 You` chip: it reads `You`.
- **Menus.** Click a project's `Project actions`, then hover an icon in the icon grid: its name shows above the menu.
- **Elsewhere.** Hover the sidebar's `Add project`, task details' `Share task`, `Copy task as Markdown`, and `Close`, quick add's `Ramble` and `Add subtask`, and a theme swatch in Settings: each names itself.
- **Dismiss.** Click `Postpone <title>`: the tooltip goes as the due picker opens and does not come back while the pointer stays on the button.
- **Keyboard.** Tab to `Add project`: its tooltip shows at once.
- **Audit.** In dev, an icon-only control without an `aria-label` logs `An icon-only control has no aria-label…` to the console when hovered.

## Gotchas

- The tooltip is one root element (`#app-tooltip`); a snapshot lists it as `tooltip` even while closed.
- Synthetic hovers need `pointerType: 'mouse'`; a touch pointer never opens it.
- A row's full-width title button has no icon, so it gets no tooltip by design.
