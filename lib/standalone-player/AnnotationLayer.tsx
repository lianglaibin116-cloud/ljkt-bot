import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnnotationPoint, AnnotationStroke, AnnotationTool } from './annotations';

function paintStroke(
  context: CanvasRenderingContext2D,
  stroke: AnnotationStroke,
  width: number,
  height: number,
) {
  if (stroke.points.length === 0) return;

  context.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
  context.strokeStyle = stroke.color;
  context.fillStyle = stroke.color;
  context.lineWidth = stroke.width;
  context.lineCap = 'round';
  context.lineJoin = 'round';

  const first = stroke.points[0];
  if (stroke.points.length === 1) {
    context.beginPath();
    context.arc(first.x * width, first.y * height, stroke.width / 2, 0, Math.PI * 2);
    context.fill();
    return;
  }

  context.beginPath();
  context.moveTo(first.x * width, first.y * height);
  for (let index = 1; index < stroke.points.length; index += 1) {
    const point = stroke.points[index];
    context.lineTo(point.x * width, point.y * height);
  }
  context.stroke();
}

export function AnnotationLayer({
  strokes,
  active,
  tool,
  color,
  width,
  aspectRatio,
  onStrokeComplete,
}: {
  strokes: AnnotationStroke[];
  active: boolean;
  tool: AnnotationTool;
  color: string;
  width: number;
  /** Scene content ratio for slides and interactive frames; omitted for flowing content. */
  aspectRatio?: number;
  onStrokeComplete: (stroke: AnnotationStroke) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activePointerRef = useRef<number | null>(null);
  const [draft, setDraft] = useState<AnnotationStroke | null>(null);
  const draftRef = useRef<AnnotationStroke | null>(null);
  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;
  const [canvasBounds, setCanvasBounds] = useState({ left: 0, top: 0, width: 0, height: 0 });

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const updateBounds = () => {
      const rootBounds = root.getBoundingClientRect();
      if (!rootBounds.width || !rootBounds.height) return;
      if (!aspectRatio || !Number.isFinite(aspectRatio) || aspectRatio <= 0) {
        setCanvasBounds({ left: 0, top: 0, width: rootBounds.width, height: rootBounds.height });
        return;
      }

      // Slides and interactive frames use p-4 around a centered content viewport.
      const availableWidth = Math.max(0, rootBounds.width - 32);
      const availableHeight = Math.max(0, rootBounds.height - 32);
      if (!availableWidth || !availableHeight) return;
      let contentWidth: number;
      let contentHeight: number;
      if (availableHeight / availableWidth > aspectRatio) {
        contentWidth = availableWidth;
        contentHeight = contentWidth * aspectRatio;
      } else {
        contentHeight = availableHeight;
        contentWidth = contentHeight / aspectRatio;
      }
      setCanvasBounds({
        left: (rootBounds.width - contentWidth) / 2,
        top: (rootBounds.height - contentHeight) / 2,
        width: contentWidth,
        height: contentHeight,
      });
    };

    const observer = new ResizeObserver(updateBounds);
    observer.observe(root);
    window.addEventListener('resize', updateBounds);
    updateBounds();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateBounds);
    };
  }, [aspectRatio]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;

    const pixelRatio = Math.max(window.devicePixelRatio || 1, 1);
    const pixelWidth = Math.round(bounds.width * pixelRatio);
    const pixelHeight = Math.round(bounds.height * pixelRatio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }

    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, bounds.width, bounds.height);
    for (const stroke of strokesRef.current)
      paintStroke(context, stroke, bounds.width, bounds.height);
    if (draftRef.current) paintStroke(context, draftRef.current, bounds.width, bounds.height);
    context.globalCompositeOperation = 'source-over';
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(redraw);
    observer.observe(canvas);
    window.addEventListener('resize', redraw);
    redraw();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', redraw);
    };
  }, [redraw]);

  useEffect(() => {
    redraw();
  }, [draft, redraw, strokes]);

  const pointFromEvent = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>): AnnotationPoint => {
      const bounds = event.currentTarget.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
        y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
      };
    },
    [],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!active || (event.pointerType === 'mouse' && event.button !== 0)) return;
      event.preventDefault();
      event.stopPropagation();
      activePointerRef.current = event.pointerId;
      event.currentTarget.setPointerCapture(event.pointerId);
      const nextDraft = { tool, color, width, points: [pointFromEvent(event)] };
      draftRef.current = nextDraft;
      setDraft(nextDraft);
    },
    [active, color, pointFromEvent, tool, width],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (activePointerRef.current !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      const point = pointFromEvent(event);
      const current = draftRef.current;
      if (!current) return;
      const nextDraft = { ...current, points: [...current.points, point] };
      draftRef.current = nextDraft;
      setDraft(nextDraft);
    },
    [pointFromEvent],
  );

  const finishPointer = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (activePointerRef.current !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      activePointerRef.current = null;
      const point = pointFromEvent(event);
      const current = draftRef.current;
      draftRef.current = null;
      setDraft(null);
      if (current) {
        const last = current.points[current.points.length - 1];
        const points =
          last && last.x === point.x && last.y === point.y
            ? current.points
            : [...current.points, point];
        onStrokeComplete({ ...current, points });
      }
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [onStrokeComplete, pointFromEvent],
  );

  return (
    <div
      ref={rootRef}
      className={`absolute inset-0 z-20 ${active ? 'cursor-crosshair' : 'pointer-events-none'}`}
      aria-hidden="true"
    >
      <canvas
        ref={canvasRef}
        className="absolute"
        style={{
          left: canvasBounds.left,
          top: canvasBounds.top,
          width: canvasBounds.width,
          height: canvasBounds.height,
          pointerEvents: active ? 'auto' : 'none',
          touchAction: active ? 'none' : 'auto',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
      />
    </div>
  );
}
