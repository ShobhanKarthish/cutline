import type { Crop } from "../types";

function normalizedAspect(
  width: number,
  height: number,
  aspect: number,
): number {
  if (
    ![width, height, aspect].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  ) {
    throw new RangeError(
      "Source dimensions and output aspect must be positive finite numbers.",
    );
  }
  const ratio = aspect * (height / width);
  if (!Number.isFinite(ratio) || ratio <= 0)
    throw new RangeError("The output aspect is out of range.");
  return ratio;
}

function boundedRegion(region: Crop): Crop {
  if (
    ![region.x, region.y, region.width, region.height].every(Number.isFinite)
  ) {
    throw new RangeError("Crop coordinates must be finite numbers.");
  }
  const x = Math.max(0, region.x);
  const y = Math.max(0, region.y);
  const right = Math.min(1, region.x + region.width);
  const bottom = Math.min(1, region.y + region.height);
  if (right <= x || bottom <= y)
    throw new RangeError("A crop must overlap the source with positive area.");
  return { x, y, width: right - x, height: bottom - y };
}

/** Largest centered crop at the requested pixel aspect, contained by region. */
export function fitCrop(
  width: number,
  height: number,
  aspect: number,
  region: Crop = { x: 0, y: 0, width: 1, height: 1 },
): Crop {
  const ratio = normalizedAspect(width, height, aspect);
  const bounds = boundedRegion(region);
  const cropWidth = Math.min(bounds.width, bounds.height * ratio);
  const cropHeight = cropWidth / ratio;
  return {
    x: bounds.x + (bounds.width - cropWidth) / 2,
    y: bounds.y + (bounds.height - cropHeight) / 2,
    width: cropWidth,
    height: cropHeight,
  };
}

/** Split mode initializes A on the left and B on the right. */
export function initialCrops(
  width: number,
  height: number,
  aspect: number,
  split: boolean,
): Crop[] {
  return split
    ? [0, 0.5].map((x) =>
        fitCrop(width, height, aspect, { x, y: 0, width: 0.5, height: 1 }),
      )
    : [fitCrop(width, height, aspect)];
}

/** Keep each center and area where possible; shrink only to stay inside the source. */
export function conformCrops(
  crops: Crop[],
  width: number,
  height: number,
  aspect: number,
): Crop[] {
  const ratio = normalizedAspect(width, height, aspect);
  return crops.map((crop) => {
    const bounds = boundedRegion(crop);
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    const desiredWidth = Math.sqrt(bounds.width * bounds.height * ratio);
    const desiredHeight = desiredWidth / ratio;
    const scale = Math.min(
      1,
      (2 * Math.min(centerX, 1 - centerX)) / desiredWidth,
      (2 * Math.min(centerY, 1 - centerY)) / desiredHeight,
    );
    const nextWidth = desiredWidth * scale;
    const nextHeight = desiredHeight * scale;
    return {
      x: centerX - nextWidth / 2,
      y: centerY - nextHeight / 2,
      width: nextWidth,
      height: nextHeight,
    };
  });
}
