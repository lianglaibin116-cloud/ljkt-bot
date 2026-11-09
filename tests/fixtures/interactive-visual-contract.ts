/** Public, dependency-free minimizations; no saved classroom or private content. */
export function interactiveVisualFixture({
  hiddenFix = true,
  canvasFix = true,
  resetFix = true,
  hiddenUntilFound = false,
  driver = '',
}: {
  hiddenFix?: boolean;
  canvasFix?: boolean;
  resetFix?: boolean;
  hiddenUntilFound?: boolean;
  driver?: string;
} = {}): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<style>
  body { margin: 0; }
  .row { display: flex; align-items: stretch; }
  .controls { width: 160px; flex: 0 0 160px; height: 300px; }
  .surface { position: relative; min-width: 0; min-height: 300px; flex: 1; padding: 1px; box-sizing: border-box;
    ${canvasFix ? 'height: 300px; align-self: start;' : ''} }
  canvas { display: block; width: 100%; height: 100%;
    ${canvasFix ? 'position: absolute; inset: 0;' : ''} }
  .error-box { position: absolute; inset: 0; display: grid; place-items: center;
    z-index: 10; background: #fff1f2; }
  ${hiddenFix ? '.error-box[hidden]:not([hidden="until-found"]) { display: none !important; }' : ''}
</style>${driver}</head><body>
<main class="row">
  <section class="controls"><button id="start-btn">Start</button>
    <button id="reset-btn">Reset</button>
    <output id="time">0.0</output><output id="temperature">25</output></section>
  <section class="surface"><canvas id="simulation-canvas"></canvas>
    <div id="error-box" class="error-box" hidden${hiddenUntilFound ? '="until-found"' : ''}>Canvas unavailable</div>
  </section>
</main><script>
  const canvas = document.getElementById('simulation-canvas');
  const context = canvas.getContext('2d');
  let state = { running: false, time: 0, temperature: 25 };
  let frame = 0;
  let previousTime = 0;
  const observer = new ResizeObserver(resize);
  function draw() {
    context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    context.fillStyle = '#2563eb';
    context.fillRect(20 + state.time * 10, 80, 50, 50);
  }
  function renderCurrentState() {
    document.getElementById('time').textContent = state.time.toFixed(1);
    document.getElementById('temperature').textContent = String(state.temperature);
    document.getElementById('start-btn').textContent = state.running ? 'Pause' : 'Start';
    draw();
  }
  function resize() {
    // Bound the broken reproduction so tests cannot allocate an unbounded bitmap.
    if (canvas.clientHeight > 8192) { observer.disconnect(); return; }
    const width = Math.round(canvas.clientWidth * 2);
    const height = Math.round(${canvasFix ? 'canvas.clientHeight' : 'canvas.parentElement.clientHeight'} * 2);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    context.setTransform(2, 0, 0, 2, 0, 0);
    draw();
  }
  function animate(now) {
    if (!state.running) return;
    state.time += Math.min((now - previousTime) / 1000, 0.05);
    previousTime = now;
    state.temperature = 25 + Math.floor(state.time * 10);
    renderCurrentState();
    frame = requestAnimationFrame(animate);
  }
  document.getElementById('start-btn').onclick = function () {
    state.running = !state.running;
    cancelAnimationFrame(frame);
    previousTime = performance.now();
    renderCurrentState();
    if (state.running) frame = requestAnimationFrame(animate);
  };
  function reset() {
    cancelAnimationFrame(frame);
    frame = 0;
    state = { running: false, time: 0, temperature: 25 };
    ${resetFix ? 'renderCurrentState();' : 'draw();'}
  }
  document.getElementById('reset-btn').onclick = reset;
  document.addEventListener('keydown', function (event) { if (event.key === 'r') reset(); });
  observer.observe(canvas.parentElement);
  resize();
  renderCurrentState();
</script></body></html>`;
}
