import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Crop as CropIcon,
  FolderOpen,
  HelpCircle,
  Layers2,
  LoaderCircle,
  LockKeyhole,
  Maximize,
  Minus,
  Plus,
  RotateCcw,
  Scissors,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import CropEditor from "./components/CropEditor";
import { conformCrops, initialCrops } from "./lib/crop";
import { importScans, renderPreview } from "./lib/media";
import { exportBatch } from "./lib/export";
import { createDemoFiles } from "./lib/demo";
import { droppedFiles } from "./lib/files";
import { checkSettings } from "./lib/image-processing";
import type {
  Crop,
  ExportProgress,
  ExportResult,
  ImportProgress,
  OutputDirectory,
  OutputSettings,
  ScanPage,
} from "./types";

const DEFAULTS: OutputSettings = {
  width: 2970,
  height: 4200,
  format: "image/jpeg",
  quality: 0.92,
  prefix: "scan",
};
const PRESETS = [
  { name: "A4 · portrait", width: 2970, height: 4200 },
  { name: "A4 · landscape", width: 4200, height: 2970 },
  { name: "US Letter · portrait", width: 2550, height: 3300 },
  { name: "Square", width: 2400, height: 2400 },
];
const accept = ".pdf,.png,.jpg,.jpeg,.webp";
function plural(n: number, noun: string) {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function App() {
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [settings, setSettings] = useState(DEFAULTS);
  const [widthText, setWidthText] = useState(String(DEFAULTS.width));
  const [heightText, setHeightText] = useState(String(DEFAULTS.height));
  const [sizeError, setSizeError] = useState("");
  const [activeCrop, setActiveCrop] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [preview, setPreview] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const [samplePreview, setSamplePreview] = useState("");
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(
    null,
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [filter, setFilter] = useState<"all" | "pending" | "ready">("all");
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(
    null,
  );
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const [downloadUrl, setDownloadUrl] = useState("");
  const [destination, setDestination] = useState<"zip" | "folder">("zip");
  const [helpOpen, setHelpOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const helpDialog = useRef<HTMLDialogElement>(null);
  const importController = useRef<AbortController | null>(null);
  const exportController = useRef<AbortController | null>(null);
  const dragDepth = useRef(0);
  const thumbnailUrls = useRef(new Set<string>());
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const currentIndex = pages.findIndex((p) => p.id === selected);
  const current = pages[currentIndex];
  const ready = pages.filter((p) => p.ready);
  const outputCount = ready.reduce((n, p) => n + p.crops.length, 0);
  const busy = importing || exporting;
  const visiblePages = pages.filter(
    (p) => filter === "all" || (filter === "ready" ? p.ready : !p.ready),
  );
  const folderSupported = "showDirectoryPicker" in window;
  const sizeDirty =
    widthText !== String(settings.width) ||
    heightText !== String(settings.height);

  useEffect(() => {
    let disposed = false;
    let url = "";
    void createDemoFiles()
      .then((files) => {
        if (!disposed) {
          url = URL.createObjectURL(files[0]);
          setSamplePreview(url);
        }
      })
      .catch(() => {});
    return () => {
      disposed = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, []);
  useEffect(
    () => () => {
      importController.current?.abort();
      exportController.current?.abort();
      for (const url of thumbnailUrls.current) URL.revokeObjectURL(url);
    },
    [],
  );
  useEffect(() => {
    if (!downloadUrl) return;
    return () => URL.revokeObjectURL(downloadUrl);
  }, [downloadUrl]);
  useEffect(() => {
    if (!pages.length) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pages.length]);
  useEffect(() => {
    if (exportOpen) dialog.current?.showModal();
    else dialog.current?.close();
  }, [exportOpen]);
  useEffect(() => {
    if (helpOpen) helpDialog.current?.showModal();
    else helpDialog.current?.close();
  }, [helpOpen]);
  useEffect(() => {
    setPreview("");
    setPreviewError("");
    setActiveCrop(0);
    setZoom(1);
    if (!current) return;
    const controller = new AbortController();
    let url = "";
    void renderPreview(current, controller.signal)
      .then((value) => {
        if (controller.signal.aborted) URL.revokeObjectURL(value);
        else {
          url = value;
          setPreview(value);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) setPreviewError(errorMessage(error));
      });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [current?.id, previewAttempt]);
  useEffect(() => {
    if (current)
      document
        .getElementById(`page-${current.id}`)
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [current?.id]);

  const addFiles = useCallback(async (incoming: File[]) => {
    if (importController.current || exportController.current) return;
    if (!incoming.length) return;
    if (incoming.length > 1000) {
      setErrors(["Please import at most 1,000 files at a time."]);
      return;
    }
    const files = [...incoming]
      .sort((a, b) =>
        (a.webkitRelativePath || a.name).localeCompare(
          b.webkitRelativePath || b.name,
          undefined,
          { numeric: true },
        ),
      )
      .filter((file) => !file.name.startsWith("."));
    if (!files.length) {
      setErrors(["This folder contains no visible files."]);
      return;
    }
    const controller = new AbortController();
    importController.current = controller;
    setImporting(true);
    setErrors([]);
    setFilter("all");
    try {
      const issues = await importScans(
        files,
        (page) => {
          thumbnailUrls.current.add(page.thumbnail);
          const newPage = {
            ...page,
            crops: initialCrops(
              page.width,
              page.height,
              settingsRef.current.width / settingsRef.current.height,
              false,
            ),
            ready: false,
          };
          setPages((old) => [...old, newPage]);
          setSelected((id) => id ?? page.id);
        },
        setImportProgress,
        controller.signal,
      );
      setErrors(issues);
    } catch (error) {
      if (!controller.signal.aborted) setErrors([errorMessage(error)]);
    } finally {
      importController.current = null;
      setImporting(false);
      setImportProgress(null);
    }
  }, []);

  function movePage(delta: number) {
    const i = Math.max(0, Math.min(pages.length - 1, currentIndex + delta));
    if (pages[i]) setSelected(pages[i].id);
  }
  function updateCrops(crops: Crop[]) {
    if (!current || busy) return;
    setPages((old) =>
      old.map((p) => (p.id === current.id ? { ...p, crops, ready: false } : p)),
    );
  }
  function markReady() {
    if (!current || busy || !preview) return;
    setPages((old) =>
      old.map((p) => (p.id === current.id ? { ...p, ready: true } : p)),
    );
    const next = [
      ...pages.slice(currentIndex + 1),
      ...pages.slice(0, currentIndex),
    ].find((p) => !p.ready);
    if (next) {
      setSelected(next.id);
      if (filter === "ready") setFilter("all");
    }
  }
  function removePage() {
    if (!current || busy) return;
    URL.revokeObjectURL(current.thumbnail);
    thumbnailUrls.current.delete(current.thumbnail);
    const remaining = pages.filter((p) => p.id !== current.id);
    setPages(remaining);
    setSelected(
      remaining[Math.min(currentIndex, remaining.length - 1)]?.id ?? null,
    );
  }
  function clearQueue() {
    if (
      busy ||
      !window.confirm(
        "Clear this queue and its crop selections? Your original files will not be changed.",
      )
    )
      return;
    for (const url of thumbnailUrls.current) URL.revokeObjectURL(url);
    thumbnailUrls.current.clear();
    setPages([]);
    setSelected(null);
    setErrors([]);
    setFilter("all");
  }
  function applySize(width: number, height: number) {
    try {
      checkSettings({ ...settings, width, height });
    } catch (error) {
      setSizeError(errorMessage(error));
      return;
    }
    const ratioChanged =
      Math.abs(width / height - settings.width / settings.height) > 0.000001;
    setSettings((s) => ({ ...s, width, height }));
    setWidthText(String(width));
    setHeightText(String(height));
    setSizeError("");
    if (ratioChanged)
      setPages((old) =>
        old.map((p) => ({
          ...p,
          crops: conformCrops(p.crops, p.width, p.height, width / height),
          ready: false,
        })),
      );
  }
  function splitPage(split: boolean) {
    if (current) {
      updateCrops(
        initialCrops(
          current.width,
          current.height,
          settings.width / settings.height,
          split,
        ),
      );
      setActiveCrop(0);
    }
  }
  function reorder(direction: number) {
    if (!current || busy) return;
    const next = currentIndex + direction;
    if (next < 0 || next >= pages.length) return;
    setPages((old) => {
      const copy = [...old];
      [copy[currentIndex], copy[next]] = [copy[next], copy[currentIndex]];
      return copy;
    });
  }

  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      const el = event.target as HTMLElement;
      if (
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        exportOpen ||
        helpOpen ||
        busy ||
        el.closest('input,textarea,select,button,[contenteditable="true"]')
      )
        return;
      if (event.key === "j" || event.key === "]") {
        event.preventDefault();
        movePage(1);
      }
      if (event.key === "k" || event.key === "[") {
        event.preventDefault();
        movePage(-1);
      }
      if (event.key === "Enter") {
        event.preventDefault();
        markReady();
      }
      if (event.key === "?") {
        event.preventDefault();
        setHelpOpen(true);
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  });

  async function startExport() {
    if (exportController.current || !outputCount) return;
    let directory: OutputDirectory | undefined;
    if (destination === "folder") {
      // The native File System Access API is not yet included in all TypeScript DOM libraries.
      const pickerWindow = window as unknown as Window & {
        showDirectoryPicker: (options: {
          mode: string;
        }) => Promise<OutputDirectory>;
      };
      try {
        directory = await pickerWindow.showDirectoryPicker({
          mode: "readwrite",
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        setExportResult({
          exported: 0,
          errors: [errorMessage(error)],
          cancelled: false,
        });
        return;
      }
    }
    const controller = new AbortController();
    exportController.current = controller;
    setExporting(true);
    setExportResult(null);
    setDownloadUrl("");
    setExportProgress({ completed: 0, total: outputCount, fileName: "" });
    try {
      const result = await exportBatch(ready, settings, {
        signal: controller.signal,
        onProgress: setExportProgress,
        directory,
      });
      setExportResult(result);
      if (result.blob && !result.cancelled)
        setDownloadUrl(URL.createObjectURL(result.blob));
    } catch (error) {
      setExportResult({
        exported: 0,
        errors: [errorMessage(error)],
        cancelled: controller.signal.aborted,
      });
    } finally {
      exportController.current = null;
      setExporting(false);
    }
  }
  const closeExport = () => {
    if (!exporting) setExportOpen(false);
  };

  return (
    <div
      className={`app ${pages.length ? "has-pages" : "is-empty"}`}
      onDragEnter={(e) => {
        e.preventDefault();
        if (e.dataTransfer.types.includes("Files")) {
          dragDepth.current++;
          setDragging(true);
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = busy ? "none" : "copy";
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        if (!busy)
          void droppedFiles(e.dataTransfer)
            .then(addFiles)
            .catch((error) => setErrors([errorMessage(error)]));
      }}
    >
      <input
        ref={fileInput}
        className="visually-hidden"
        type="file"
        accept={accept}
        multiple
        tabIndex={-1}
        aria-label="Import scans"
        onChange={(e) => {
          void addFiles(Array.from(e.currentTarget.files ?? []));
          e.currentTarget.value = "";
        }}
      />
      <input
        ref={folderInput}
        className="visually-hidden"
        type="file"
        multiple
        {...{ webkitdirectory: "" }}
        tabIndex={-1}
        aria-label="Import a folder of scans"
        onChange={(e) => {
          void addFiles(Array.from(e.currentTarget.files ?? []));
          e.currentTarget.value = "";
        }}
      />
      <header className="app-header">
        <a
          className="brand"
          href="./"
          onClick={(e) => e.preventDefault()}
          aria-label="Cutline workspace"
        >
          <span className="brand-mark">
            <CropIcon size={22} strokeWidth={1.7} />
          </span>
          cutline<span className="brand-period">.</span>
        </a>
        <div className="header-description">The scan preparation workspace</div>
        <div className="header-actions">
          <span className="privacy-note">
            <LockKeyhole size={13} /> Local by design
          </span>
          <button
            className="icon-button"
            aria-label="Help and keyboard shortcuts"
            title="Help and shortcuts (?)"
            onClick={() => setHelpOpen(true)}
          >
            <HelpCircle size={18} />
          </button>
        </div>
      </header>
      <main className="workspace">
        <aside className="queue-panel" aria-label="Page queue">
          <div className="panel-heading">
            <h2>
              Your pages <span className="count">{pages.length}</span>
            </h2>
            <button
              className="icon-button"
              aria-label="Add files"
              title="Add files"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
            >
              <Plus size={18} />
            </button>
          </div>
          {pages.length > 0 && (
            <div className="queue-filters" aria-label="Filter pages">
              {(["all", "pending", "ready"] as const).map((f) => (
                <button
                  key={f}
                  aria-pressed={filter === f}
                  onClick={() => setFilter(f)}
                >
                  {f === "all"
                    ? "All"
                    : f === "pending"
                      ? "To review"
                      : "Ready"}
                  <span>
                    {f === "all"
                      ? pages.length
                      : f === "pending"
                        ? pages.length - ready.length
                        : ready.length}
                  </span>
                </button>
              ))}
            </div>
          )}
          <div className="page-list">
            {!pages.length ? (
              <div className="queue-empty">
                <Layers2 size={25} strokeWidth={1.2} />
                <p>A fresh stack.</p>
                <span>
                  Your imported pages
                  <br />
                  will appear here.
                </span>
              </div>
            ) : visiblePages.length === 0 ? (
              <p className="filter-empty">
                {filter === "ready"
                  ? "Mark a page ready to see it here."
                  : "Every page is ready."}
              </p>
            ) : (
              visiblePages.map((page) => {
                const index = pages.findIndex((p) => p.id === page.id);
                return (
                  <button
                    id={`page-${page.id}`}
                    key={page.id}
                    className={`page-item ${page.id === selected ? "is-selected" : ""}`}
                    aria-current={page.id === selected ? "true" : undefined}
                    aria-label={`Page ${index + 1}: ${page.name}${page.pageNumber ? `, PDF page ${page.pageNumber}` : ""}, ${page.ready ? "ready" : "to review"}`}
                    onClick={() => setSelected(page.id)}
                  >
                    <span className="page-thumbnail">
                      <img src={page.thumbnail} alt="" loading="lazy" />
                      {page.crops.length === 2 && (
                        <span className="spread-badge">
                          <Layers2 size={11} />
                        </span>
                      )}
                    </span>
                    <span className="page-item-info">
                      <span className="page-item-title">{page.name}</span>
                      <span className="page-item-meta">
                        {page.pageNumber
                          ? `PDF · p. ${page.pageNumber}`
                          : "Image"}{" "}
                        <span>·</span>{" "}
                        {page.crops.length === 2 ? "2 crops" : "1 crop"}
                      </span>
                      <span
                        className={`page-status ${page.ready ? "is-ready" : ""}`}
                      >
                        {page.ready ? (
                          <>
                            <Check size={11} />
                            Ready
                          </>
                        ) : (
                          "To review"
                        )}
                      </span>
                    </span>
                    <span className="page-number">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                  </button>
                );
              })
            )}
          </div>
          <div className="queue-footer">
            <button
              className="text-button"
              disabled={busy}
              onClick={() => folderInput.current?.click()}
            >
              <FolderOpen size={15} /> Add a folder
            </button>
            {pages.length > 0 && (
              <button
                className="icon-button"
                title="Clear queue"
                aria-label="Clear queue"
                disabled={busy}
                onClick={clearQueue}
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </aside>
        <section className="center-panel" aria-label="Crop workspace">
          {errors.length > 0 && (
            <div className="error-banner" role="alert">
              <div>
                <strong>Some files need attention</strong>
                <ul>
                  {errors.map((error, i) => (
                    <li key={i}>{error}</li>
                  ))}
                </ul>
              </div>
              <button
                className="icon-button"
                aria-label="Dismiss import errors"
                onClick={() => setErrors([])}
              >
                <X size={15} />
              </button>
            </div>
          )}
          {importing && (
            <div className="import-progress" role="status">
              <LoaderCircle size={15} className="spin" />
              <span>
                Importing {importProgress?.fileName ?? "scans"}
                {importProgress?.totalPages
                  ? ` · page ${importProgress.pageNumber} of ${importProgress.totalPages}`
                  : ""}
              </span>
              <button
                className="text-button"
                onClick={() => importController.current?.abort()}
              >
                Stop import
              </button>
            </div>
          )}
          {!current ? (
            <div className="empty-workspace">
              <div className="empty-intro">
                <h1>
                  A little order.
                  <br />
                  <span>For a lot of pages.</span>
                </h1>
                <p>
                  Crop, split, and prepare your scans.
                  <br />
                  One focused workspace. No repetitive dialogs.
                </p>
              </div>
              <div className="import-surface">
                <div className="sample-paper" aria-hidden="true">
                  {samplePreview && <img src={samplePreview} alt="" />}
                  <span className="paper-corner corner-tl" />
                  <span className="paper-corner corner-tr" />
                  <span className="paper-corner corner-bl" />
                  <span className="paper-corner corner-br" />
                </div>
                <div className="import-prompt">
                  <button
                    className="primary-button"
                    disabled={busy}
                    onClick={() => fileInput.current?.click()}
                  >
                    <Plus size={17} /> Add your scans
                  </button>
                  <p>or drop files or a folder anywhere</p>
                  <span className="file-formats">PDF, JPG, PNG & WEBP</span>
                </div>
              </div>
              <button
                className="demo-button"
                disabled={busy}
                onClick={() =>
                  void createDemoFiles()
                    .then(addFiles)
                    .catch((e) => setErrors([errorMessage(e)]))
                }
              >
                Try a sample batch <ArrowRight size={15} />
              </button>
              <div className="empty-footnote">
                <LockKeyhole size={13} />
                <span>
                  Your files stay on this device. Originals stay untouched.
                </span>
              </div>
            </div>
          ) : (
            <>
              <div className="canvas-heading">
                <div>
                  <span className="canvas-page-number">
                    PAGE {String(currentIndex + 1).padStart(2, "0")} /{" "}
                    {String(pages.length).padStart(2, "0")}
                  </span>
                  <h1 title={current.name}>{current.name}</h1>
                </div>
                <div className="canvas-page-nav">
                  <button
                    className="icon-button"
                    disabled={currentIndex <= 0}
                    aria-label="Previous page"
                    title="Previous page (K)"
                    onClick={() => movePage(-1)}
                  >
                    <ChevronLeft size={19} />
                  </button>
                  <button
                    className="icon-button"
                    disabled={currentIndex >= pages.length - 1}
                    aria-label="Next page"
                    title="Next page (J)"
                    onClick={() => movePage(1)}
                  >
                    <ChevronRight size={19} />
                  </button>
                </div>
              </div>
              <div className="canvas-toolbar">
                <div className="segmented-control" aria-label="Page layout">
                  <button
                    aria-pressed={current.crops.length === 1}
                    disabled={busy}
                    onClick={() => splitPage(false)}
                  >
                    <CropIcon size={14} />
                    Single page
                  </button>
                  <button
                    aria-pressed={current.crops.length === 2}
                    disabled={busy}
                    onClick={() => splitPage(true)}
                  >
                    <Layers2 size={14} />
                    Split spread
                  </button>
                </div>
                <div className="zoom-controls">
                  <button
                    className="icon-button"
                    disabled={zoom <= 0.5}
                    aria-label="Zoom out"
                    onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
                  >
                    <Minus size={14} />
                  </button>
                  <span>{Math.round(zoom * 100)}%</span>
                  <button
                    className="icon-button"
                    disabled={zoom >= 2.5}
                    aria-label="Zoom in"
                    onClick={() => setZoom((z) => Math.min(2.5, z + 0.25))}
                  >
                    <Plus size={14} />
                  </button>
                  <button
                    className="icon-button"
                    title="Fit page"
                    aria-label="Fit page"
                    onClick={() => setZoom(1)}
                  >
                    <Maximize size={14} />
                  </button>
                </div>
              </div>
              <div className="canvas-area">
                {previewError ? (
                  <div className="preview-message" role="alert">
                    <strong>Couldn't open this preview</strong>
                    <p>{previewError}</p>
                    <button
                      className="secondary-button"
                      onClick={() => setPreviewAttempt((n) => n + 1)}
                    >
                      Try again
                    </button>
                  </div>
                ) : !preview ? (
                  <div className="preview-message" role="status">
                    <LoaderCircle className="spin" size={22} />
                    <p>Preparing your page…</p>
                  </div>
                ) : (
                  <CropEditor
                    page={current}
                    previewUrl={preview}
                    activeCrop={activeCrop}
                    zoom={zoom}
                    onActiveCrop={setActiveCrop}
                    onChange={updateCrops}
                    disabled={busy}
                  />
                )}
              </div>
              <div className="review-bar">
                <div className="review-actions">
                  <button
                    className="icon-button"
                    title="Reset crops"
                    aria-label="Reset crops"
                    disabled={busy}
                    onClick={() => splitPage(current.crops.length === 2)}
                  >
                    <RotateCcw size={16} />
                  </button>
                  <button
                    className="icon-button"
                    title="Remove page"
                    aria-label="Remove page"
                    disabled={busy}
                    onClick={removePage}
                  >
                    <Trash2 size={16} />
                  </button>
                  <span className="review-divider" />
                  <button
                    className="icon-button"
                    aria-label="Move page earlier"
                    title="Move page earlier in export order"
                    disabled={busy || currentIndex <= 0}
                    onClick={() => reorder(-1)}
                  >
                    <ArrowLeft size={16} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Move page later"
                    title="Move page later in export order"
                    disabled={busy || currentIndex >= pages.length - 1}
                    onClick={() => reorder(1)}
                  >
                    <ArrowRight size={16} />
                  </button>
                </div>
                <button
                  className="primary-button ready-button"
                  disabled={busy || !preview || ready.length === pages.length}
                  onClick={markReady}
                >
                  <Check size={16} />
                  <span>
                    {ready.length === pages.length
                      ? "All pages ready"
                      : current.ready
                        ? "Next unreviewed page"
                        : "Mark ready & next"}
                  </span>
                  <kbd>↵</kbd>
                </button>
              </div>
            </>
          )}
        </section>
        <aside className="output-panel" aria-label="Output settings">
          <div className="panel-heading">
            <h2>Output settings</h2>
            <Scissors size={16} strokeWidth={1.5} />
          </div>
          <div className="output-content">
            <fieldset disabled={busy}>
              <legend className="visually-hidden">
                Output dimensions and format
              </legend>
              <div className="settings-section">
                <label className="field-label" htmlFor="preset">
                  Page size
                </label>
                <div className="select-wrap">
                  <select
                    id="preset"
                    value={PRESETS.findIndex(
                      (p) =>
                        p.width === settings.width &&
                        p.height === settings.height,
                    )}
                    onChange={(e) => {
                      const p = PRESETS[Number(e.target.value)];
                      if (p) applySize(p.width, p.height);
                    }}
                  >
                    <option value={-1}>Custom dimensions</option>
                    {PRESETS.map((p, i) => (
                      <option key={p.name} value={i}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={14} />
                </div>
                <div className="dimensions">
                  <label htmlFor="output-width">
                    Width
                    <div className="unit-input">
                      <input
                        id="output-width"
                        type="number"
                        min={64}
                        max={12000}
                        value={widthText}
                        onChange={(e) => setWidthText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter")
                            applySize(Number(widthText), Number(heightText));
                        }}
                      />
                      <span>px</span>
                    </div>
                  </label>
                  <span className="dimension-times">×</span>
                  <label htmlFor="output-height">
                    Height
                    <div className="unit-input">
                      <input
                        id="output-height"
                        type="number"
                        min={64}
                        max={12000}
                        value={heightText}
                        onChange={(e) => setHeightText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter")
                            applySize(Number(widthText), Number(heightText));
                        }}
                      />
                      <span>px</span>
                    </div>
                  </label>
                </div>
                {sizeDirty && (
                  <button
                    className="secondary-button apply-size"
                    onClick={() =>
                      applySize(Number(widthText), Number(heightText))
                    }
                  >
                    Apply dimensions
                  </button>
                )}
                {sizeError && (
                  <p className="field-error" role="alert">
                    {sizeError}
                  </p>
                )}
                <p className="field-hint">
                  <LockKeyhole size={11} /> Crop proportions stay locked.
                </p>
                {pages.length > 0 && (
                  <p className="settings-note">
                    Changing proportions adjusts crops and returns pages to
                    review.
                  </p>
                )}
              </div>
              <div className="settings-section">
                <span className="field-label" id="format-label">
                  File format
                </span>
                <div
                  className="segmented-control format-control"
                  role="group"
                  aria-labelledby="format-label"
                >
                  <button
                    aria-pressed={settings.format === "image/jpeg"}
                    onClick={() =>
                      setSettings((s) => ({ ...s, format: "image/jpeg" }))
                    }
                  >
                    JPG
                  </button>
                  <button
                    aria-pressed={settings.format === "image/png"}
                    onClick={() =>
                      setSettings((s) => ({ ...s, format: "image/png" }))
                    }
                  >
                    PNG
                  </button>
                </div>
                {settings.format === "image/jpeg" ? (
                  <>
                    <div className="quality-label">
                      <label htmlFor="quality">Quality</label>
                      <output htmlFor="quality">
                        {Math.round(settings.quality * 100)}%
                      </output>
                    </div>
                    <input
                      className="quality-slider"
                      id="quality"
                      type="range"
                      min={50}
                      max={100}
                      step={1}
                      value={Math.round(settings.quality * 100)}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          quality: Number(e.target.value) / 100,
                        }))
                      }
                    />
                    <p className="settings-note">
                      High quality, smaller files.
                    </p>
                  </>
                ) : (
                  <p className="settings-note">
                    Lossless images. Larger files.
                  </p>
                )}
              </div>
              <div className="settings-section">
                <label className="field-label" htmlFor="filename">
                  Filename prefix
                </label>
                <input
                  id="filename"
                  className="text-input"
                  maxLength={48}
                  value={settings.prefix}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, prefix: e.target.value }))
                  }
                  placeholder="scan"
                />
                <p className="filename-example">
                  Numbered in queue order.
                  <br />
                  Spreads export left crop, then right.
                </p>
              </div>
            </fieldset>
            <div className="process-note">
              <span className="small-crop-mark">
                <CropIcon size={16} />
              </span>
              <p>
                A crop, not a compromise.
                <span>Exports use your original source—not the preview.</span>
              </p>
            </div>
            {current && (
              <div className="source-details">
                <span>Source dimensions</span>
                <span>
                  {Math.round(current.width)} × {Math.round(current.height)}{" "}
                  {current.pageNumber ? "pt" : "px"}
                </span>
                {current.crops[activeCrop] &&
                  !current.pageNumber &&
                  current.width * current.crops[activeCrop].width <
                    settings.width && (
                    <p>
                      Your crop is smaller than the output. Export will upscale
                      it.
                    </p>
                  )}
              </div>
            )}
          </div>
          <div className="export-footer">
            <div className="batch-summary">
              <span>{plural(ready.length, "page")} ready</span>
              <span>{plural(outputCount, "image")}</span>
            </div>
            <button
              className="primary-button export-button"
              disabled={!outputCount || busy || sizeDirty}
              onClick={() => {
                setExportResult(null);
                setDownloadUrl("");
                setExportProgress(null);
                setExportOpen(true);
              }}
            >
              <ArrowDownToLine size={17} />
              Export batch
              <ArrowRight size={16} />
            </button>
            <p>
              {sizeDirty
                ? "Apply your dimensions before exporting."
                : pages.length
                  ? "Only reviewed pages are exported."
                  : "Add scans to start your first batch."}
            </p>
          </div>
        </aside>
      </main>
      <footer className="app-footer">
        <span>
          <span className="status-dot" />{" "}
          {importing
            ? "Reading files locally"
            : exporting
              ? "Preparing your export"
              : "All processing stays on your device"}
        </span>
        <span className="footer-shortcuts">
          {pages.length ? (
            <>
              <kbd>J</kbd>
              <kbd>K</kbd> Navigate <span>·</span> <kbd>↵</kbd> Ready & next
            </>
          ) : (
            "Less clicking. More keeping."
          )}
        </span>
        <button className="text-button" onClick={() => setHelpOpen(true)}>
          Shortcuts <kbd>?</kbd>
        </button>
      </footer>
      {dragging && (
        <div className="drop-overlay">
          <Upload size={34} strokeWidth={1.3} />
          <h2>
            {busy
              ? "Finish the current operation first"
              : "Drop your next stack."}
          </h2>
          <p>PDFs, images, or an entire folder</p>
        </div>
      )}
      <dialog
        ref={dialog}
        className="export-dialog"
        onCancel={(e) => {
          if (exporting) e.preventDefault();
          else setExportOpen(false);
        }}
        onClose={() => {
          if (!exporting) setExportOpen(false);
        }}
      >
        <div className="dialog-heading">
          <div>
            <h2>
              {exportResult
                ? exportResult.cancelled
                  ? "Export stopped"
                  : exportResult.errors.length
                    ? "Export needs attention"
                    : "Your pages, prepared."
                : "Export your batch"}
            </h2>
            <p>
              {plural(outputCount, "image")} · {settings.width} ×{" "}
              {settings.height} px ·{" "}
              {settings.format === "image/jpeg" ? "JPG" : "PNG"}
            </p>
          </div>
          <button
            className="icon-button"
            aria-label="Close export dialog"
            disabled={exporting}
            onClick={closeExport}
          >
            <X size={20} />
          </button>
        </div>
        {!exportResult && !exporting && (
          <>
            <div className="export-options">
              <label>
                <input
                  type="radio"
                  name="destination"
                  value="zip"
                  checked={destination === "zip"}
                  onChange={() => setDestination("zip")}
                />
                <span>
                  <strong>Download a ZIP</strong>
                  <small>A single archive. Up to 256 MB per batch.</small>
                </span>
              </label>
              {folderSupported && (
                <label>
                  <input
                    type="radio"
                    name="destination"
                    value="folder"
                    checked={destination === "folder"}
                    onChange={() => setDestination("folder")}
                  />
                  <span>
                    <strong>Save directly to a folder</strong>
                    <small>
                      Recommended for large batches. Choose an empty folder.
                    </small>
                  </span>
                </label>
              )}
            </div>
            {pages.length > ready.length && (
              <p className="dialog-note">
                {plural(pages.length - ready.length, "unreviewed page")} will
                stay in the queue.
              </p>
            )}
            <p className="dialog-note">
              Originals are never changed. Keep this tab open until export
              finishes.
            </p>
            <button
              className="primary-button dialog-primary"
              onClick={() => void startExport()}
            >
              <ArrowDownToLine size={16} />
              {destination === "folder"
                ? "Choose folder & export"
                : "Prepare ZIP"}
            </button>
          </>
        )}
        {exporting && (
          <div className="export-running" role="status">
            <LoaderCircle size={28} className="spin" />
            <p>
              Preparing image{" "}
              {Math.min((exportProgress?.completed ?? 0) + 1, outputCount)} of{" "}
              {outputCount}
            </p>
            <progress
              value={exportProgress?.completed ?? 0}
              max={outputCount}
            />
            <span>{exportProgress?.fileName}</span>
            <button
              className="secondary-button"
              onClick={() => exportController.current?.abort()}
            >
              Cancel export
            </button>
          </div>
        )}
        {exportResult && (
          <div className="export-result" role="status">
            <div className="result-symbol">
              {exportResult.cancelled || exportResult.errors.length ? (
                <HelpCircle size={27} strokeWidth={1.4} />
              ) : (
                <Check size={30} strokeWidth={1.5} />
              )}
            </div>
            <p>
              {exportResult.cancelled
                ? "Export was cancelled. Your queue and crops are still here."
                : `${plural(exportResult.exported, "image")} ${destination === "folder" ? "saved to your folder" : "prepared"}.`}
            </p>
            {exportResult.cancelled && destination === "folder" && (
              <p>
                {plural(exportResult.exported, "completed image")} remain in the
                selected folder.
              </p>
            )}
            {exportResult.errors.length > 0 && (
              <ul className="export-errors">
                {exportResult.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            )}
            {downloadUrl && (
              <a
                className="primary-button dialog-primary"
                href={downloadUrl}
                download="cutline-export.zip"
              >
                <ArrowDownToLine size={17} />
                Download ZIP
              </a>
            )}
            <button className="secondary-button" onClick={closeExport}>
              Back to workspace
            </button>
          </div>
        )}
      </dialog>
      <dialog
        ref={helpDialog}
        className="help-dialog"
        onCancel={() => setHelpOpen(false)}
        onClose={() => setHelpOpen(false)}
      >
        <div className="dialog-heading">
          <div>
            <h2>A quieter workflow.</h2>
            <p>Everything you need, a few keys away.</p>
          </div>
          <button
            className="icon-button"
            aria-label="Close help"
            onClick={() => setHelpOpen(false)}
          >
            <X size={19} />
          </button>
        </div>
        <dl className="shortcut-list">
          <div>
            <dt>Next / previous page</dt>
            <dd>
              <kbd>J</kbd> / <kbd>K</kbd>
            </dd>
          </div>
          <div>
            <dt>Mark ready & advance</dt>
            <dd>
              <kbd>Enter</kbd>
            </dd>
          </div>
          <div>
            <dt>Move a focused crop</dt>
            <dd>
              <kbd>Arrow keys</kbd>
            </dd>
          </div>
          <div>
            <dt>Move in larger steps</dt>
            <dd>
              <kbd>Shift</kbd> + <kbd>Arrows</kbd>
            </dd>
          </div>
          <div>
            <dt>Open this guide</dt>
            <dd>
              <kbd>?</kbd>
            </dd>
          </div>
        </dl>
        <div className="help-copy">
          <h3>From stack to finished pages</h3>
          <p>
            Import PDFs, JPGs, PNGs, or WebP images. Set your output size, then
            drag a crop or adjust its corners. For two-page scans, choose{" "}
            <strong>Split spread</strong> and review both crops.
          </p>
          <p>
            Mark each page ready. Exports follow the queue order; use the arrows
            beneath the canvas to reorder pages. A changed crop needs another
            review.
          </p>
          <h3>Private, and temporary</h3>
          <p>
            Files are processed locally and are not uploaded. This session lives
            in memory: refreshing or closing the tab clears the queue. Download
            your export before leaving.
          </p>
          <p>
            Large PDFs take longer to prepare. Encrypted or damaged files show
            an error without stopping the rest of your batch. For large exports,
            use folder saving when your browser offers it.
          </p>
          <h3>Practical limits</h3>
          <p>
            Import up to 1,000 files at a time. Images support up to 80
            megapixels and 128 MiB per file; PDFs support up to 256 MiB per
            file. Outputs support up to 32 megapixels and 12,000 pixels per
            side. ZIP exports are limited to 256 MiB; folder export avoids that
            batch limit and never replaces an existing file.
          </p>
          <p>
            Built with open-source software and locally bundled fonts.{" "}
            <a
              href={`${import.meta.env.BASE_URL}THIRD-PARTY-LICENSES.txt`}
              target="_blank"
              rel="noreferrer"
            >
              Read the licenses
            </a>
            .
          </p>
        </div>
        <button
          className="primary-button dialog-primary"
          onClick={() => setHelpOpen(false)}
        >
          Back to the workspace
        </button>
      </dialog>
    </div>
  );
}
export default App;
