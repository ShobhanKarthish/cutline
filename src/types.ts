export interface Crop {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface ImportedPage {
  id: string;
  file: File;
  name: string;
  pageNumber?: number;
  width: number;
  height: number;
  thumbnail: string;
}
export interface ScanPage extends ImportedPage {
  crops: Crop[];
  ready: boolean;
}
export interface OutputSettings {
  width: number;
  height: number;
  format: "image/jpeg" | "image/png";
  quality: number;
  prefix: string;
}
export interface ImportProgress {
  fileName: string;
  fileIndex: number;
  totalFiles: number;
  pageNumber?: number;
  totalPages?: number;
}
export interface ExportProgress {
  completed: number;
  total: number;
  fileName: string;
}
export interface ExportResult {
  blob?: Blob;
  exported: number;
  errors: string[];
  cancelled: boolean;
}
export interface OutputFileWriter {
  write(data: Blob | Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}
export interface OutputDirectory {
  getFileHandle(
    name: string,
    options: { create: boolean },
  ): Promise<{ createWritable(): Promise<OutputFileWriter> }>;
  removeEntry(name: string): Promise<void>;
}
