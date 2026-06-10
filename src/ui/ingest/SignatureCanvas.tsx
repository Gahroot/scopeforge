import { useCallback, useEffect, useRef, useState } from "react";
import { Eraser } from "lucide-react";
import { Button } from "../components/ui/button.js";
import { cn } from "../lib/utils.js";

export interface SignatureCanvasProps {
  readonly onSignature: (dataUrl: string) => void;
  readonly onClear: () => void;
  readonly disabled?: boolean;
  readonly width?: number;
  readonly height?: number;
  readonly className?: string;
}

const DEFAULT_WIDTH = 480;
const DEFAULT_HEIGHT = 160;
const STROKE_COLOR = "#1a1a2e";
const STROKE_WIDTH = 2.5;

interface Point {
  readonly x: number;
  readonly y: number;
}

function getCanvasPoint(
  canvas: HTMLCanvasElement,
  event: { readonly clientX: number; readonly clientY: number },
): Point {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  };
}

function hasDrawnContent(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext("2d");
  if (ctx === null) return false;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 3; i < imageData.data.length; i += 4) {
    if (imageData.data[i] !== 0) return true;
  }
  return false;
}

export function SignatureCanvas({
  onSignature,
  onClear,
  disabled = false,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
  className,
}: SignatureCanvasProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [hasContent, setHasContent] = useState(false);
  const lastPointRef = useRef<Point | null>(null);

  const clearCanvas = useCallback((): void => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasContent(false);
    onClear();
  }, [onClear]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = STROKE_COLOR;
    ctx.lineWidth = STROKE_WIDTH;
  }, []);

  const emitSignature = useCallback((): void => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    if (!hasDrawnContent(canvas)) return;
    setHasContent(true);
    onSignature(canvas.toDataURL("image/png"));
  }, [onSignature]);

  const handleMouseDown = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>): void => {
      if (disabled) return;
      event.preventDefault();
      const canvas = canvasRef.current;
      if (canvas === null) return;
      const ctx = canvas.getContext("2d");
      if (ctx === null) return;
      const point = getCanvasPoint(canvas, event.nativeEvent);
      setDrawing(true);
      lastPointRef.current = point;
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
    },
    [disabled],
  );

  const handleMouseMove = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>): void => {
      if (!drawing) return;
      const canvas = canvasRef.current;
      if (canvas === null) return;
      const ctx = canvas.getContext("2d");
      if (ctx === null) return;
      const point = getCanvasPoint(canvas, event.nativeEvent);
      const last = lastPointRef.current;
      if (last !== null) {
        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(point.x, point.y);
        ctx.stroke();
      }
      lastPointRef.current = point;
    },
    [drawing],
  );

  const handleMouseUp = useCallback((): void => {
    if (!drawing) return;
    setDrawing(false);
    lastPointRef.current = null;
    emitSignature();
  }, [drawing, emitSignature]);

  const handleTouchStart = useCallback(
    (event: React.TouchEvent<HTMLCanvasElement>): void => {
      if (disabled) return;
      event.preventDefault();
      const canvas = canvasRef.current;
      if (canvas === null) return;
      const ctx = canvas.getContext("2d");
      if (ctx === null) return;
      const touch = event.touches[0];
      if (touch === undefined) return;
      const point = getCanvasPoint(canvas, touch);
      setDrawing(true);
      lastPointRef.current = point;
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
    },
    [disabled],
  );

  const handleTouchMove = useCallback(
    (event: React.TouchEvent<HTMLCanvasElement>): void => {
      if (!drawing) return;
      event.preventDefault();
      const canvas = canvasRef.current;
      if (canvas === null) return;
      const ctx = canvas.getContext("2d");
      if (ctx === null) return;
      const touch = event.touches[0];
      if (touch === undefined) return;
      const point = getCanvasPoint(canvas, touch);
      const last = lastPointRef.current;
      if (last !== null) {
        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(point.x, point.y);
        ctx.stroke();
      }
      lastPointRef.current = point;
    },
    [drawing],
  );

  const handleTouchEnd = useCallback((): void => {
    if (!drawing) return;
    setDrawing(false);
    lastPointRef.current = null;
    emitSignature();
  }, [drawing, emitSignature]);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="relative rounded-lg border border-dashed border-muted-foreground/40 bg-white">
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          className="block w-full cursor-crosshair touch-none rounded-lg"
          style={{ aspectRatio: `${width} / ${height}` }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          aria-label="Signature drawing canvas"
        />
        {!drawing && !hasContent && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm italic text-muted-foreground/50">
            Sign here
          </span>
        )}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={clearCanvas}
        className="self-start text-xs"
      >
        <Eraser className="h-3.5 w-3.5" />
        Clear
      </Button>
    </div>
  );
}
