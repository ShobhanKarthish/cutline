import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import type { Crop, ScanPage } from "../types";

type Corner = "nw" | "ne" | "sw" | "se";
type Point = { x: number; y: number };
type Drag = {
  pointerId: number;
  index: number;
  kind: "draw" | "move" | Corner;
  start: Point;
  original: Crop;
  changed: boolean;
};

export interface CropEditorProps {
  page: ScanPage;
  previewUrl: string;
  activeCrop: number;
  zoom: number;
  onActiveCrop: (index: number) => void;
  onChange: (crops: Crop[]) => void;
  disabled?: boolean;
}

const corners: Corner[] = ["nw", "ne", "sw", "se"];
const cornerLabels: Record<Corner, string> = {
  nw: "top left",
  ne: "top right",
  sw: "bottom left",
  se: "bottom right",
};
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
const label = (index: number) => String.fromCharCode(65 + index);

function anchoredCrop(
  anchor: Point,
  signX: number,
  signY: number,
  width: number,
  ratio: number,
  minWidth: number,
): Crop | null {
  const maxWidth = Math.min(
    signX > 0 ? 1 - anchor.x : anchor.x,
    (signY > 0 ? 1 - anchor.y : anchor.y) * ratio,
  );
  if (maxWidth <= 0) return null;
  const nextWidth = clamp(width, Math.min(minWidth, maxWidth), maxWidth);
  const nextHeight = nextWidth / ratio;
  return {
    x: signX > 0 ? anchor.x : anchor.x - nextWidth,
    y: signY > 0 ? anchor.y : anchor.y - nextHeight,
    width: nextWidth,
    height: nextHeight,
  };
}

function resizeCrop(
  crop: Crop,
  corner: Corner,
  point: Point,
  sourceWidth: number,
  sourceHeight: number,
): Crop {
  const signX = corner.endsWith("e") ? 1 : -1;
  const signY = corner.startsWith("s") ? 1 : -1;
  const anchor = {
    x: crop.x + (signX < 0 ? crop.width : 0),
    y: crop.y + (signY < 0 ? crop.height : 0),
  };
  const ratio = crop.width / crop.height;
  // Project onto the fixed-aspect diagonal in source pixels, rather than favoring one axis.
  const horizontal = (point.x - anchor.x) * signX;
  const vertical = (point.y - anchor.y) * signY;
  const heightWeight = (sourceHeight / sourceWidth) ** 2;
  const width =
    (horizontal + (vertical * heightWeight) / ratio) /
    (1 + heightWeight / ratio ** 2);
  return (
    anchoredCrop(
      anchor,
      signX,
      signY,
      width,
      ratio,
      Math.max(2 / sourceWidth, (2 * ratio) / sourceHeight),
    ) ?? crop
  );
}

export default function CropEditor(props: CropEditorProps) {
  const {
    page,
    previewUrl,
    activeCrop,
    zoom,
    onActiveCrop,
    disabled = false,
  } = props;
  const latest = useRef(props);
  latest.current = props;
  const viewport = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const cropElements = useRef<(HTMLDivElement | null)[]>([]);
  const [available, setAvailable] = useState({ width: 0, height: 0 });
  const [drawing, setDrawing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [imageError, setImageError] = useState(false);
  const helpId = useId();
  const selected = clamp(activeCrop, 0, Math.max(0, page.crops.length - 1));

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setAvailable((previous) =>
        previous.width === width && previous.height === height
          ? previous
          : { width, height },
      );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setImageError(false);
    setDrawing(false);
    drag.current = null;
    setDragging(false);
  }, [page.id, previewUrl]);

  useEffect(() => {
    if (disabled) {
      drag.current = null;
      setDragging(false);
      setDrawing(false);
    }
  }, [disabled]);

  function update(index: number, crop: Crop) {
    const current = latest.current;
    if (current.disabled || !current.page.crops[index]) return;
    current.onChange(
      current.page.crops.map((existing, i) => (i === index ? crop : existing)),
    );
  }

  function pointAt(event: PointerEvent<HTMLDivElement>): Point | null {
    const bounds = surface.current?.getBoundingClientRect();
    if (!bounds?.width || !bounds.height) return null;
    return {
      x: clamp((event.clientX - bounds.left) / bounds.width, 0, 1),
      y: clamp((event.clientY - bounds.top) / bounds.height, 0, 1),
    };
  }

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (
      disabled ||
      imageError ||
      event.button !== 0 ||
      !event.isPrimary ||
      drag.current
    )
      return;
    const point = pointAt(event);
    if (!point) return;
    const target = event.target as HTMLElement;
    const overlay = target.closest<HTMLElement>("[data-crop-index]");
    const index =
      drawing || !overlay ? selected : Number(overlay.dataset.cropIndex);
    const crop = page.crops[index];
    if (!crop) return;
    const handle = target.closest<HTMLElement>("[data-corner]");
    const kind =
      drawing || !overlay
        ? "draw"
        : handle
          ? (handle.dataset.corner as Corner)
          : "move";
    event.preventDefault();
    onActiveCrop(index);
    cropElements.current[index]?.focus({ preventScroll: true });
    drag.current = {
      pointerId: event.pointerId,
      index,
      kind,
      start: point,
      original: { ...crop },
      changed: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (
      !current ||
      current.pointerId !== event.pointerId ||
      latest.current.disabled
    )
      return;
    const point = pointAt(event);
    if (!point) return;
    const dx = point.x - current.start.x;
    const dy = point.y - current.start.y;
    const bounds = surface.current!.getBoundingClientRect();
    if (
      !current.changed &&
      Math.hypot(dx * bounds.width, dy * bounds.height) < 3
    )
      return;
    let next: Crop | null;
    if (current.kind === "move") {
      next = {
        ...current.original,
        x: clamp(current.original.x + dx, 0, 1 - current.original.width),
        y: clamp(current.original.y + dy, 0, 1 - current.original.height),
      };
    } else if (current.kind === "draw") {
      const ratio = current.original.width / current.original.height;
      const signX = dx === 0 ? (current.start.x > 0.5 ? -1 : 1) : Math.sign(dx);
      const signY = dy === 0 ? (current.start.y > 0.5 ? -1 : 1) : Math.sign(dy);
      next = anchoredCrop(
        current.start,
        signX,
        signY,
        Math.max(Math.abs(dx), Math.abs(dy) * ratio),
        ratio,
        Math.max(2 / page.width, (2 * ratio) / page.height),
      );
    } else {
      next = resizeCrop(
        current.original,
        current.kind,
        point,
        page.width,
        page.height,
      );
    }
    if (next) {
      current.changed = true;
      update(current.index, next);
    }
  }

  function finishDrag(event: PointerEvent<HTMLDivElement>, cancel = false) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (!cancel) moveDrag(event);
    drag.current = null;
    if (cancel && current.changed) update(current.index, current.original);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(false);
    if (!cancel && current.changed && current.kind === "draw")
      setDrawing(false);
  }

  function keyDown(
    event: KeyboardEvent<HTMLElement>,
    index: number,
    corner?: Corner,
  ) {
    if (disabled) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      const current = drag.current;
      drag.current = null;
      if (current) {
        if (current.changed) update(current.index, current.original);
        if (surface.current?.hasPointerCapture(current.pointerId))
          surface.current.releasePointerCapture(current.pointerId);
      }
      setDragging(false);
      setDrawing(false);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      if (!corner) {
        event.preventDefault();
        onActiveCrop(index);
        setDrawing(false);
      }
      return;
    }
    if (
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
        event.key,
      ) ||
      drag.current
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    const crop = page.crops[index];
    if (!crop) return;
    const step = event.shiftKey ? 10 : 1;
    const dx =
      (event.key === "ArrowLeft"
        ? -step
        : event.key === "ArrowRight"
          ? step
          : 0) / page.width;
    const dy =
      (event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0) /
      page.height;
    onActiveCrop(index);
    if (corner) {
      update(
        index,
        resizeCrop(
          crop,
          corner,
          {
            x: crop.x + (corner.endsWith("e") ? crop.width : 0) + dx,
            y: crop.y + (corner.startsWith("s") ? crop.height : 0) + dy,
          },
          page.width,
          page.height,
        ),
      );
    } else {
      update(index, {
        ...crop,
        x: clamp(crop.x + dx, 0, 1 - crop.width),
        y: clamp(crop.y + dy, 0, 1 - crop.height),
      });
    }
  }

  const fitScale = Math.min(
    Math.max(1, available.width - 48) / page.width,
    Math.max(1, available.height - 48) / page.height,
  );
  const scale = fitScale * (Number.isFinite(zoom) && zoom > 0 ? zoom : 1);
  const imageWidth = page.width * scale;
  const imageHeight = page.height * scale;

  return (
    <div
      className={`crop-editor${drawing ? " is-drawing" : ""}${dragging ? " is-dragging" : ""}`}
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        height: "100%",
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") keyDown(event, selected);
      }}
    >
      <div className="crop-editor-toolbar">
        <div className="crop-selector" role="group" aria-label="Select crop">
          {page.crops.map((_, index) => (
            <button
              key={index}
              type="button"
              className={selected === index ? "is-active" : ""}
              aria-pressed={selected === index}
              disabled={disabled}
              onClick={() => {
                onActiveCrop(index);
                setDrawing(false);
                cropElements.current[index]?.focus({ preventScroll: true });
              }}
            >
              Crop {label(index)}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`crop-draw-button${drawing ? " is-active" : ""}`}
          aria-pressed={drawing}
          disabled={disabled || imageError}
          onClick={() => setDrawing((value) => !value)}
        >
          {drawing ? "Cancel drawing" : `Draw crop ${label(selected)}`}
        </button>
      </div>
      <div
        ref={viewport}
        className="crop-editor-viewport"
        style={{
          flex: "1 1 0",
          minHeight: 0,
          overflow: "auto",
          position: "relative",
        }}
      >
        <div
          className="crop-editor-stage"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: "100%",
            minHeight: "100%",
            width: imageWidth + 48,
            height: imageHeight + 48,
          }}
        >
          <div
            ref={surface}
            className="crop-editor-surface"
            style={{
              position: "relative",
              flexShrink: 0,
              width: imageWidth,
              height: imageHeight,
              touchAction: disabled ? "auto" : "none",
              userSelect: "none",
              visibility:
                available.width > 0 && available.height > 0
                  ? "visible"
                  : "hidden",
              cursor: disabled ? "default" : drawing ? "crosshair" : undefined,
            }}
            onPointerDown={startDrag}
            onPointerMove={moveDrag}
            onPointerUp={(event) => finishDrag(event)}
            onPointerCancel={(event) => finishDrag(event, true)}
            onLostPointerCapture={(event) => finishDrag(event, true)}
          >
            <img
              className="crop-editor-image"
              src={previewUrl}
              alt={`${page.name}${page.pageNumber ? `, page ${page.pageNumber}` : ""}. Crop regions are shown over the source.`}
              draggable={false}
              onError={() => setImageError(true)}
              style={{
                display: "block",
                width: "100%",
                height: "100%",
                pointerEvents: "none",
              }}
            />
            {!imageError &&
              page.crops.map((crop, index) => (
                <div
                  key={index}
                  ref={(element) => {
                    cropElements.current[index] = element;
                  }}
                  data-crop-index={index}
                  className={`crop-overlay ${selected === index ? "is-active" : "is-inactive"}`}
                  role="group"
                  tabIndex={disabled ? -1 : 0}
                  aria-label={`Crop ${label(index)}${selected === index ? ", selected" : ""}. Move with arrow keys.`}
                  aria-disabled={disabled}
                  aria-describedby={helpId}
                  onFocus={() => {
                    if (!disabled) onActiveCrop(index);
                  }}
                  onKeyDown={(event) => keyDown(event, index)}
                  style={{
                    position: "absolute",
                    boxSizing: "border-box",
                    left: `${crop.x * 100}%`,
                    top: `${crop.y * 100}%`,
                    width: `${crop.width * 100}%`,
                    height: `${crop.height * 100}%`,
                    zIndex: selected === index ? 2 : 1,
                    cursor: disabled
                      ? "default"
                      : drawing
                        ? "crosshair"
                        : dragging
                          ? "grabbing"
                          : "grab",
                  }}
                >
                  <span className="crop-label" aria-hidden="true">
                    {label(index)}
                  </span>
                  {selected === index && (
                    <>
                      <div
                        className="crop-grid"
                        aria-hidden="true"
                        style={{
                          position: "absolute",
                          inset: 0,
                          pointerEvents: "none",
                        }}
                      >
                        {[1, 2].map((third) => (
                          <span
                            key={`v${third}`}
                            className="crop-grid-line is-vertical"
                            style={{
                              position: "absolute",
                              top: 0,
                              bottom: 0,
                              left: `${(third * 100) / 3}%`,
                            }}
                          />
                        ))}
                        {[1, 2].map((third) => (
                          <span
                            key={`h${third}`}
                            className="crop-grid-line is-horizontal"
                            style={{
                              position: "absolute",
                              left: 0,
                              right: 0,
                              top: `${(third * 100) / 3}%`,
                            }}
                          />
                        ))}
                      </div>
                      {corners.map((corner) => (
                        <button
                          key={corner}
                          type="button"
                          data-corner={corner}
                          className={`crop-handle crop-handle-${corner}`}
                          aria-label={`Resize crop ${label(index)} from ${cornerLabels[corner]}; use arrow keys`}
                          disabled={disabled}
                          onKeyDown={(event) => {
                            event.stopPropagation();
                            keyDown(event, index, corner);
                          }}
                          style={{
                            position: "absolute",
                            left: corner.endsWith("w") ? 0 : "100%",
                            top: corner.startsWith("n") ? 0 : "100%",
                            transform: "translate(-50%, -50%)",
                            cursor: drawing
                              ? "crosshair"
                              : corner === "nw" || corner === "se"
                                ? "nwse-resize"
                                : "nesw-resize",
                          }}
                        />
                      ))}
                    </>
                  )}
                </div>
              ))}
          </div>
        </div>
        {imageError && (
          <p className="crop-editor-error" role="alert">
            This preview could not be displayed. Select another page, then
            return to retry.
          </p>
        )}
      </div>
      <p className="crop-editor-help" id={helpId}>
        {drawing
          ? `Drag anywhere on the page to draw crop ${label(selected)}. Escape cancels.`
          : "Drag a crop to move it. Drag corners to resize. Focus a crop and use arrow keys to move; hold Shift for larger steps."}
      </p>
    </div>
  );
}
