import { Zip, ZipPassThrough } from "fflate";
import type {
  ExportProgress,
  ExportResult,
  OutputDirectory,
  OutputFileWriter,
  OutputSettings,
  ScanPage,
} from "../types";
import { renderCrop } from "./media";
import { abortIfNeeded, checkSettings, errorMessage } from "./image-processing";

const MAX_ZIP_BYTES = 256 * 1024 * 1024;
const ZIP_LIMIT_MESSAGE =
  "This ZIP would exceed the 256 MiB memory limit. Export to a folder instead, or export fewer pages / smaller images. No ZIP was created.";

function safeName(value: string, fallback: string): string {
  const cleaned = value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/^[.\s-]+|[.\s-]+$/g, "")
    .slice(0, 70);
  return cleaned || fallback;
}

export async function exportBatch(
  pages: ScanPage[],
  settings: OutputSettings,
  options: {
    signal: AbortSignal;
    onProgress: (progress: ExportProgress) => void;
    directory?: OutputDirectory;
  },
): Promise<ExportResult> {
  const { signal, onProgress, directory } = options;
  const errors: string[] = [];
  let exported = 0;
  let completed = 0;
  const total = pages.reduce((sum, page) => sum + page.crops.length, 0);
  const digits = Math.max(4, String(total).length);
  const prefix = settings.prefix.trim()
    ? `${safeName(settings.prefix, "cutline")}-`
    : "";
  const extension = settings.format === "image/png" ? "png" : "jpg";
  let zipBytes = 0;
  let centralDirectoryBytes = 22;
  let zipError: Error | undefined;
  const chunks: BlobPart[] = [];
  let zip: Zip | undefined;
  try {
    abortIfNeeded(signal);
    checkSettings(settings);
    if (!directory) {
      zip = new Zip((error, data) => {
        if (error) {
          zipError = error;
          return;
        }
        zipBytes += data.byteLength;
        if (zipBytes > MAX_ZIP_BYTES) {
          zipError = new Error(ZIP_LIMIT_MESSAGE);
          return;
        }
        // fflate emits immutable chunks; keep their buffers without recompressing images.
        chunks.push(data as Uint8Array<ArrayBuffer>);
      });
    }
    for (const page of pages) {
      abortIfNeeded(signal);
      if (!page.crops.length) {
        errors.push(`${page.name}: no crops were selected.`);
        continue;
      }
      const crops = [...page.crops].sort(
        (left, right) => left.x - right.x || left.y - right.y,
      );
      for (let cropIndex = 0; cropIndex < crops.length; cropIndex++) {
        abortIfNeeded(signal);
        const source = safeName(page.name.replace(/\.[^.]+$/, ""), "scan");
        const pagePart =
          page.pageNumber === undefined
            ? ""
            : `-p${String(page.pageNumber).padStart(3, "0")}`;
        const cropPart =
          crops.length === 2
            ? cropIndex === 0
              ? "-left"
              : "-right"
            : crops.length > 1
              ? `-crop${cropIndex + 1}`
              : "";
        const fileName = `${String(completed + 1).padStart(digits, "0")}-${prefix}${source}${pagePart}${cropPart}.${extension}`;
        onProgress({ completed, total, fileName });
        try {
          if (!page.ready)
            throw new Error(
              "This page is not marked ready. Review its crops before exporting.",
            );
          const blob = await renderCrop(
            page,
            crops[cropIndex],
            settings,
            signal,
          );
          abortIfNeeded(signal);
          if (directory) {
            try {
              await directory.getFileHandle(fileName, { create: false });
              throw new Error(
                "A file with this name already exists. It was not overwritten. Choose an empty folder or a different filename prefix.",
              );
            } catch (error) {
              if (
                !(error instanceof DOMException) ||
                error.name !== "NotFoundError"
              )
                throw error;
            }
            const handle = await directory.getFileHandle(fileName, {
              create: true,
            });
            let writable: OutputFileWriter | undefined;
            let closed = false;
            try {
              abortIfNeeded(signal);
              writable = await handle.createWritable();
              await writable.write(blob);
              abortIfNeeded(signal);
              await writable.close();
              closed = true;
              exported++;
            } finally {
              if (!closed) {
                await writable?.abort().catch(() => undefined);
                await directory.removeEntry(fileName).catch((error) => {
                  errors.push(
                    `${fileName}: Could not remove the incomplete file: ${errorMessage(error)}`,
                  );
                });
              }
            }
          } else {
            const nameBytes = new TextEncoder().encode(fileName).length;
            // Account for local header, data descriptor, and final directory before retaining data.
            if (
              zipBytes +
                blob.size +
                30 +
                nameBytes +
                16 +
                centralDirectoryBytes +
                46 +
                nameBytes >
              MAX_ZIP_BYTES
            ) {
              throw new RangeError(ZIP_LIMIT_MESSAGE);
            }
            const entry = new ZipPassThrough(fileName);
            zip!.add(entry);
            centralDirectoryBytes += 46 + nameBytes;
            const reader = blob.stream().getReader();
            try {
              while (true) {
                abortIfNeeded(signal);
                const { value, done } = await reader.read();
                abortIfNeeded(signal);
                if (done) {
                  entry.push(new Uint8Array(0), true);
                  break;
                }
                entry.push(value);
                if (zipError) throw zipError;
              }
            } catch (error) {
              zipError = new Error(
                `Could not assemble the ZIP: ${errorMessage(error)}. Try folder export instead.`,
              );
              throw zipError;
            } finally {
              await reader.cancel().catch(() => undefined);
              reader.releaseLock();
            }
            if (zipError) throw zipError;
            exported++;
          }
        } catch (error) {
          abortIfNeeded(signal);
          if (zipError || error instanceof RangeError) throw zipError ?? error;
          errors.push(`${fileName}: ${errorMessage(error)}`);
        }
        completed++;
        onProgress({ completed, total, fileName });
      }
    }
    abortIfNeeded(signal);
    if (zip && exported > 0) {
      zip.end();
      if (zipError) throw zipError;
      const blob = new Blob(chunks, { type: "application/zip" });
      return { blob, exported, errors, cancelled: false };
    }
    return { exported, errors, cancelled: false };
  } catch (error) {
    if (
      signal.aborted ||
      (error instanceof DOMException && error.name === "AbortError")
    ) {
      return { exported: directory ? exported : 0, errors, cancelled: true };
    }
    errors.push(errorMessage(error));
    return { exported: directory ? exported : 0, errors, cancelled: false };
  } finally {
    zip?.terminate();
    chunks.length = 0;
  }
}
