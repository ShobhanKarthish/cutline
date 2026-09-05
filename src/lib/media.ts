import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type {
  Crop,
  ImportedPage,
  ImportProgress,
  OutputSettings,
} from "../types";
import {
  abortIfNeeded,
  checkSourceSize,
  cropPlan,
  errorMessage,
  prepareContext,
} from "./image-processing";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
const FULL_CROP: Crop = { x: 0, y: 0, width: 1, height: 1 };
let pdfCache: { file: File; document: PDFDocumentProxy } | undefined;
let pdfQueue: Promise<void> = Promise.resolve();

async function withPdf<T>(
  file: File,
  signal: AbortSignal,
  operation: (document: PDFDocumentProxy) => Promise<T>,
): Promise<T> {
  const previous = pdfQueue;
  let unlock!: () => void;
  pdfQueue = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  await previous;
  try {
    abortIfNeeded(signal);
    if (pdfCache?.file !== file) {
      const old = pdfCache;
      pdfCache = undefined;
      await old?.document.destroy();
      if (file.size > 256 * 1024 * 1024)
        throw new Error(
          "This PDF exceeds the 256 MiB source limit. Split it into smaller PDFs and try again.",
        );
      const data = await file.arrayBuffer();
      abortIfNeeded(signal);
      const assetBase = new URL(
        `${import.meta.env.BASE_URL}pdfjs/`,
        document.baseURI,
      ).href;
      const loading = getDocument({
        data,
        cMapUrl: `${assetBase}cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `${assetBase}standard_fonts/`,
        wasmUrl: `${assetBase}wasm/`,
        canvasMaxAreaInBytes: 128_000_000,
      });
      let passwordProtected = false;
      // Do not leave a password prompt unresolved in the PDF worker.
      loading.onPassword = () => {
        passwordProtected = true;
        void loading.destroy().catch(() => undefined);
      };
      const cancel = () => {
        void loading.destroy().catch(() => undefined);
      };
      signal.addEventListener("abort", cancel, { once: true });
      try {
        pdfCache = { file, document: await loading.promise };
      } catch (error) {
        await loading.destroy().catch(() => undefined);
        abortIfNeeded(signal);
        if (passwordProtected)
          throw new Error(
            "This PDF is password protected. Save an unlocked copy and import it again.",
          );
        throw error;
      } finally {
        signal.removeEventListener("abort", cancel);
      }
    }
    abortIfNeeded(signal);
    const result = await operation(pdfCache.document);
    await pdfCache.document.cleanup();
    abortIfNeeded(signal);
    return result;
  } catch (error) {
    const old = pdfCache;
    pdfCache = undefined;
    await old?.document.destroy().catch(() => undefined);
    abortIfNeeded(signal);
    throw error;
  } finally {
    unlock();
  }
}

function encodeCanvas(
  canvas: HTMLCanvasElement,
  settings: Pick<OutputSettings, "format" | "quality">,
  signal: AbortSignal,
): Promise<Blob> {
  abortIfNeeded(signal);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (signal.aborted)
          reject(new DOMException("Operation cancelled", "AbortError"));
        else if (!blob?.size || blob.type !== settings.format)
          reject(
            new Error(
              "The browser could not encode this image. Try smaller output dimensions.",
            ),
          );
        else resolve(blob);
      },
      settings.format,
      settings.quality,
    );
  });
}

async function decodeImage(
  file: File,
  signal: AbortSignal,
): Promise<{
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}> {
  abortIfNeeded(signal);
  if (file.size > 128 * 1024 * 1024)
    throw new Error(
      "This image exceeds the 128 MiB source limit. Reduce its resolution and import it again.",
    );
  if (typeof createImageBitmap === "function") {
    let bitmap: ImageBitmap | undefined;
    try {
      bitmap = await createImageBitmap(file, {
        imageOrientation: "from-image",
      });
      abortIfNeeded(signal);
      checkSourceSize(bitmap.width, bitmap.height);
      const result = bitmap;
      return {
        source: result,
        width: result.width,
        height: result.height,
        close: () => result.close(),
      };
    } catch (error) {
      bitmap?.close();
      abortIfNeeded(signal);
      if (bitmap) throw error;
      // Older browsers can expose createImageBitmap but not decode all accepted formats.
    }
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  let released = false;
  const close = () => {
    if (released) return;
    released = true;
    image.src = "";
    URL.revokeObjectURL(url);
  };
  try {
    await new Promise<void>((resolve, reject) => {
      const cancel = () => {
        close();
        reject(new DOMException("Operation cancelled", "AbortError"));
      };
      image.onload = () => {
        signal.removeEventListener("abort", cancel);
        resolve();
      };
      image.onerror = () => {
        signal.removeEventListener("abort", cancel);
        reject(
          new Error(
            "This image is damaged or cannot be decoded by this browser.",
          ),
        );
      };
      signal.addEventListener("abort", cancel, { once: true });
      image.src = url;
    });
    abortIfNeeded(signal);
    checkSourceSize(image.naturalWidth, image.naturalHeight);
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close,
    };
  } catch (error) {
    close();
    throw error;
  }
}

async function imagePreview(
  file: File,
  maxEdge: number,
  signal: AbortSignal,
): Promise<{ blob: Blob; width: number; height: number }> {
  const decoded = await decodeImage(file, signal);
  const canvas = document.createElement("canvas");
  try {
    const scale = Math.min(
      1,
      maxEdge / Math.max(decoded.width, decoded.height),
    );
    canvas.width = Math.max(1, Math.round(decoded.width * scale));
    canvas.height = Math.max(1, Math.round(decoded.height * scale));
    const context = canvas.getContext("2d");
    if (!context)
      throw new Error("The browser could not allocate a preview canvas.");
    prepareContext(context, canvas.width, canvas.height, "image/jpeg");
    context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);
    const blob = await encodeCanvas(
      canvas,
      { format: "image/jpeg", quality: 0.88 },
      signal,
    );
    return { blob, width: decoded.width, height: decoded.height };
  } finally {
    decoded.close();
    canvas.width = canvas.height = 0;
  }
}

async function pdfRaster(
  page: PDFPageProxy,
  crop: Crop,
  settings: OutputSettings,
  signal: AbortSignal,
  preview = false,
): Promise<Blob> {
  abortIfNeeded(signal);
  const natural = page.getViewport({ scale: 1 });
  checkSourceSize(natural.width, natural.height);
  const plan = preview
    ? {
        sx: 0,
        sy: 0,
        sw: natural.width,
        sh: natural.height,
        width: settings.width,
        height: settings.height,
      }
    : cropPlan(natural.width, natural.height, crop, settings);
  const scale = Math.min(plan.width / plan.sw, plan.height / plan.sh);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = plan.width;
  canvas.height = plan.height;
  let task: RenderTask | undefined;
  const cancel = () => task?.cancel();
  signal.addEventListener("abort", cancel, { once: true });
  try {
    task = page.render({
      canvas,
      viewport,
      transform: [1, 0, 0, 1, -plan.sx * scale, -plan.sy * scale],
      background: "#ffffff",
    });
    await task.promise;
    abortIfNeeded(signal);
    return await encodeCanvas(canvas, settings, signal);
  } finally {
    signal.removeEventListener("abort", cancel);
    canvas.width = canvas.height = 0;
    page.cleanup();
  }
}

async function pdfPreview(
  document: PDFDocumentProxy,
  number: number,
  maxEdge: number,
  signal: AbortSignal,
) {
  abortIfNeeded(signal);
  const page = await document.getPage(number);
  try {
    const viewport = page.getViewport({ scale: 1 });
    checkSourceSize(viewport.width, viewport.height);
    const scale = maxEdge / Math.max(viewport.width, viewport.height);
    const blob = await pdfRaster(
      page,
      FULL_CROP,
      {
        width: Math.max(1, Math.round(viewport.width * scale)),
        height: Math.max(1, Math.round(viewport.height * scale)),
        format: "image/jpeg",
        quality: 0.88,
        prefix: "",
      },
      signal,
      true,
    );
    return { blob, width: viewport.width, height: viewport.height };
  } finally {
    page.cleanup();
  }
}

export async function importScans(
  files: File[],
  onPage: (page: ImportedPage) => void,
  onProgress: (progress: ImportProgress) => void,
  signal: AbortSignal,
): Promise<string[]> {
  const errors: string[] = [];
  for (let index = 0; index < files.length; index++) {
    abortIfNeeded(signal);
    const file = files[index];
    const progress = {
      fileName: file.name,
      fileIndex: index + 1,
      totalFiles: files.length,
    };
    onProgress(progress);
    try {
      const header = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
      abortIfNeeded(signal);
      const isPdf = new TextDecoder("latin1").decode(header).includes("%PDF-");
      const isPng =
        header[0] === 137 &&
        header[1] === 80 &&
        header[2] === 78 &&
        header[3] === 71;
      const isJpeg =
        header[0] === 255 && header[1] === 216 && header[2] === 255;
      const isWebp =
        header[0] === 82 &&
        header[1] === 73 &&
        header[2] === 70 &&
        header[3] === 70 &&
        header[8] === 87 &&
        header[9] === 69 &&
        header[10] === 66 &&
        header[11] === 80;
      if (isPdf) {
        await withPdf(file, signal, async (document) => {
          for (let number = 1; number <= document.numPages; number++) {
            abortIfNeeded(signal);
            onProgress({
              ...progress,
              pageNumber: number,
              totalPages: document.numPages,
            });
            try {
              const preview = await pdfPreview(document, number, 180, signal);
              abortIfNeeded(signal);
              const thumbnail = URL.createObjectURL(preview.blob);
              try {
                onPage({
                  id: crypto.randomUUID(),
                  file,
                  name: file.name,
                  pageNumber: number,
                  width: preview.width,
                  height: preview.height,
                  thumbnail,
                });
              } catch (error) {
                URL.revokeObjectURL(thumbnail);
                throw error;
              }
              await document.cleanup();
            } catch (error) {
              abortIfNeeded(signal);
              errors.push(
                `${file.name}, page ${number}: ${errorMessage(error)}`,
              );
            }
          }
        });
      } else if (isPng || isJpeg || isWebp) {
        const preview = await imagePreview(file, 180, signal);
        abortIfNeeded(signal);
        const thumbnail = URL.createObjectURL(preview.blob);
        try {
          onPage({
            id: crypto.randomUUID(),
            file,
            name: file.name,
            width: preview.width,
            height: preview.height,
            thumbnail,
          });
        } catch (error) {
          URL.revokeObjectURL(thumbnail);
          throw error;
        }
      } else {
        throw new Error(
          "Unsupported or damaged file. Import a PDF, PNG, JPEG, or WebP image.",
        );
      }
    } catch (error) {
      abortIfNeeded(signal);
      errors.push(`${file.name}: ${errorMessage(error)}`);
    }
  }
  abortIfNeeded(signal);
  return errors;
}

export async function renderPreview(
  page: ImportedPage,
  signal: AbortSignal,
): Promise<string> {
  const result =
    page.pageNumber !== undefined
      ? await withPdf(page.file, signal, (document) =>
          pdfPreview(document, page.pageNumber!, 1800, signal),
        )
      : await imagePreview(page.file, 1800, signal);
  abortIfNeeded(signal);
  return URL.createObjectURL(result.blob);
}

async function workerCrop(
  page: ImportedPage,
  crop: Crop,
  settings: OutputSettings,
  signal: AbortSignal,
): Promise<Blob | undefined> {
  if (
    typeof Worker === "undefined" ||
    typeof OffscreenCanvas === "undefined" ||
    typeof createImageBitmap === "undefined"
  )
    return undefined;
  abortIfNeeded(signal);
  let worker: Worker;
  try {
    worker = new Worker(new URL("./export.worker.ts", import.meta.url), {
      type: "module",
    });
  } catch {
    return undefined;
  }
  try {
    return await new Promise<Blob | undefined>((resolve, reject) => {
      const cancel = () => {
        reject(new DOMException("Operation cancelled", "AbortError"));
      };
      const finish = (result: Blob | undefined, error?: Error) => {
        signal.removeEventListener("abort", cancel);
        if (error) reject(error);
        else resolve(result);
      };
      signal.addEventListener("abort", cancel, { once: true });
      worker.onmessage = (
        event: MessageEvent<{
          blob?: Blob;
          unsupported?: boolean;
          error?: string;
        }>,
      ) => {
        if (event.data.error) finish(undefined, new Error(event.data.error));
        else finish(event.data.blob);
      };
      worker.onerror = (event) => {
        event.preventDefault();
        finish(undefined);
      };
      worker.onmessageerror = () =>
        finish(
          undefined,
          new Error("The image worker could not return the exported image."),
        );
      try {
        worker.postMessage({ file: page.file, crop, settings });
      } catch {
        finish(undefined);
      }
    });
  } finally {
    worker.terminate();
  }
}

export async function renderCrop(
  page: ImportedPage,
  crop: Crop,
  settings: OutputSettings,
  signal: AbortSignal,
): Promise<Blob> {
  abortIfNeeded(signal);
  checkSourceSize(page.width, page.height);
  cropPlan(page.width, page.height, crop, settings);
  if (page.pageNumber !== undefined) {
    return withPdf(page.file, signal, async (document) => {
      const source = await document.getPage(page.pageNumber!);
      try {
        return await pdfRaster(source, crop, settings, signal);
      } finally {
        source.cleanup();
      }
    });
  }
  const workerResult = await workerCrop(page, crop, settings, signal);
  abortIfNeeded(signal);
  if (workerResult) return workerResult;
  const decoded = await decodeImage(page.file, signal);
  const canvas = document.createElement("canvas");
  try {
    const plan = cropPlan(decoded.width, decoded.height, crop, settings);
    canvas.width = plan.width;
    canvas.height = plan.height;
    const context = canvas.getContext("2d");
    if (!context)
      throw new Error(
        "The browser could not allocate the export canvas. Try smaller dimensions.",
      );
    prepareContext(context, plan.width, plan.height, settings.format);
    context.drawImage(
      decoded.source,
      plan.sx,
      plan.sy,
      plan.sw,
      plan.sh,
      0,
      0,
      plan.width,
      plan.height,
    );
    return await encodeCanvas(canvas, settings, signal);
  } finally {
    decoded.close();
    canvas.width = canvas.height = 0;
  }
}
