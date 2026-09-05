import type { Crop, OutputSettings } from "../types";
import {
  checkSourceSize,
  cropPlan,
  errorMessage,
  prepareContext,
} from "./image-processing";

self.addEventListener(
  "message",
  async (
    event: MessageEvent<{ file: File; crop: Crop; settings: OutputSettings }>,
  ) => {
    if (
      typeof OffscreenCanvas === "undefined" ||
      typeof createImageBitmap === "undefined"
    ) {
      self.postMessage({ unsupported: true });
      return;
    }
    let bitmap: ImageBitmap | undefined;
    let canvas: OffscreenCanvas | undefined;
    try {
      const { file, crop, settings } = event.data;
      try {
        bitmap = await createImageBitmap(file, {
          imageOrientation: "from-image",
        });
      } catch {
        self.postMessage({ unsupported: true });
        return;
      }
      checkSourceSize(bitmap.width, bitmap.height);
      const plan = cropPlan(bitmap.width, bitmap.height, crop, settings);
      canvas = new OffscreenCanvas(plan.width, plan.height);
      const context = canvas.getContext("2d");
      if (!context || typeof canvas.convertToBlob !== "function") {
        self.postMessage({ unsupported: true });
        return;
      }
      prepareContext(context, plan.width, plan.height, settings.format);
      context.drawImage(
        bitmap,
        plan.sx,
        plan.sy,
        plan.sw,
        plan.sh,
        0,
        0,
        plan.width,
        plan.height,
      );
      bitmap.close();
      bitmap = undefined;
      const blob = await canvas.convertToBlob({
        type: settings.format,
        quality: settings.quality,
      });
      if (blob.type !== settings.format || !blob.size)
        throw new Error(
          "The browser could not encode the selected image format.",
        );
      self.postMessage({ blob });
    } catch (error) {
      self.postMessage({ error: errorMessage(error) });
    } finally {
      bitmap?.close();
      if (canvas) canvas.width = canvas.height = 0;
    }
  },
);
