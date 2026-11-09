## Interactive visual reliability (required)

### Hidden overlays must remain hidden

- An error overlay is hidden in the healthy initial state. Reveal it only after a real initialization or rendering failure; do not leave a fallback message over a working canvas.
- Author styles such as `.error-box { display: grid; }` can override the browser's ordinary `hidden` behavior. Whenever an element uses `hidden`, explicitly preserve that behavior, for example `.error-box[hidden] { display: none !important; }`. Do not apply this rule to the distinct `hidden="until-found"` feature.
- Show/hide must use one consistent mechanism. When revealing an element that uses `hidden`, remove the attribute or set `element.hidden = false`; changing `style.display` alone is insufficient.

### Canvas layout must settle without a resize feedback loop

- CSS determines a bounded visualization container size; canvas bitmap dimensions must never determine that container's layout size. In a flex/grid row, do not put an in-flow `canvas { height: 100%; }` inside an auto-height parent and repeatedly grow its bitmap in `ResizeObserver`.
- A safe pattern is an explicitly sized relative container with an absolutely positioned canvas. Observe the container, read its CSS size, and update the bitmap only when its integer pixel dimensions actually change. Keep device-pixel-ratio scaling separate from CSS dimensions, and restore the context transform after a bitmap resize.
- Never derive the next bitmap size by multiplying its previous `canvas.width` or `canvas.height`. Do not conceal a resize loop by suppressing observer errors or hiding the canvas.

```css
.visual-area {
  position: relative;
  height: clamp(320px, 60vh, 640px);
  min-width: 0;
  align-self: start;
}
.visual-area canvas {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
}
.error-box[hidden] { display: none !important; }
```

### Reset restores the visible initial state

- Use one complete reset path for the reset button, keyboard reset, presets, and programmatic reset. Cancel the old animation callback/timers before restoring state; repeated Start/Reset must not accumulate animation loops.
- Reset internal state AND visible readouts: elapsed time, temperature, score, intensity, status badges, control values, button labels, feedback, and canvas contents, as applicable. Resetting a JavaScript object alone is insufficient.
- Initial render, semantic updates, and reset must share one `renderCurrentState()` projection that updates controls/readouts, draws the current state, and calls the existing `publishCurrentState()` with a valid observation. Do not add a late wrapper or a second reset click listener as a substitute for fixing the original reset path.
- Check the healthy initial state, Start → Pause → Reset, repeated Start → Reset, and mobile/desktop resize. Confirm the error layer is absent, the canvas CSS size settles across multiple frames, and all readouts return to their initial values. Prompt instructions reduce generation risk; they are not a browser runtime guarantee and do not repair previously saved HTML.
