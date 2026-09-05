import type { Crop, OutputSettings } from "../types";

export const MAX_SOURCE_PIXELS = 80_000_000;
export const MAX_OUTPUT_PIXELS = 32_000_000;
export const MAX_OUTPUT_EDGE = 12_000;

export function abortIfNeeded(signal: AbortSignal): void {
  if (signal.aborted)
    throw new DOMException("Operation cancelled", "AbortError");
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function checkSourceSize(width: number, height: number): void {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    width > 32_768 ||
    height > 32_768 ||
    width * height > MAX_SOURCE_PIXELS
  ) {
    throw new Error(
      "This page is too large to process safely (maximum 80 megapixels and 32,768 pixels per side). Reduce its resolution and import it again.",
    );
  }
}

export function checkSettings(settings: OutputSettings): void {
  const { width, height, quality, format } = settings;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 64 ||
    height < 64 ||
    width > MAX_OUTPUT_EDGE ||
    height > MAX_OUTPUT_EDGE ||
    width * height > MAX_OUTPUT_PIXELS
  ) {
    throw new Error(
      "Use whole dimensions from 64 to 12,000 pixels, up to 32 megapixels total.",
    );
  }
  if (format !== "image/jpeg" && format !== "image/png")
    throw new Error("Choose JPEG or PNG output.");
  if (!Number.isFinite(quality) || quality < 0 || quality > 1)
    throw new Error("JPEG quality must be between 0 and 1.");
}

export function cropPlan(
  width: number,
  height: number,
  crop: Crop,
  settings: OutputSettings,
) {
  checkSettings(settings);
  const { x, y, width: w, height: h } = crop;
  if (
    ![x, y, w, h].every(Number.isFinite) ||
    x < 0 ||
    y < 0 ||
    x >= 1 ||
    y >= 1 ||
    w <= 0 ||
    h <= 0 ||
    x + w > 1.000001 ||
    y + h > 1.000001
  ) {
    throw new Error(
      "The crop must be a nonempty rectangle inside the source page.",
    );
  }
  let sx = x * width;
  let sy = y * height;
  let sw = Math.min(w, 1 - x) * width;
  let sh = Math.min(h, 1 - y) * height;
  const ratio = settings.width / settings.height;
  const mismatch = Math.abs(sw / sh / ratio - 1);
  if (mismatch > Math.max(0.002, Math.min(0.02, 2 / Math.min(sw, sh)))) {
    throw new Error(
      "This crop does not match the output aspect ratio. Adjust the crop to the selected dimensions before exporting.",
    );
  }
  // Absorb subpixel rounding by trimming centrally, never stretching the image.
  if (sw / sh > ratio) {
    const adjusted = sh * ratio;
    sx += (sw - adjusted) / 2;
    sw = adjusted;
  } else {
    const adjusted = sw / ratio;
    sy += (sh - adjusted) / 2;
    sh = adjusted;
  }
  return { sx, sy, sw, sh, width: settings.width, height: settings.height };
}

export function prepareContext(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  format: OutputSettings["format"],
): void {
  if (format === "image/jpeg") {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
}
