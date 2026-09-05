interface Entry {
  isFile: boolean;
  isDirectory: boolean;
  file?: (
    resolve: (file: File) => void,
    reject: (error: DOMException) => void,
  ) => void;
  createReader?: () => {
    readEntries: (
      resolve: (entries: Entry[]) => void,
      reject: (error: DOMException) => void,
    ) => void;
  };
}
export async function droppedFiles(transfer: DataTransfer): Promise<File[]> {
  const fallback = Array.from(transfer.files);
  const entries = Array.from(transfer.items)
    .filter((i) => i.kind === "file")
    .map((i) => i.webkitGetAsEntry?.() as Entry | null);
  if (!entries.some(Boolean)) return fallback;
  const files: File[] = [];
  async function visit(entry: Entry) {
    if (files.length >= 1000)
      throw new Error("Please import at most 1,000 files at a time.");
    if (entry.isFile && entry.file)
      files.push(
        await new Promise<File>((resolve, reject) =>
          entry.file!(resolve, reject),
        ),
      );
    else if (entry.isDirectory && entry.createReader) {
      const reader = entry.createReader();
      while (true) {
        const batch = await new Promise<Entry[]>((resolve, reject) =>
          reader.readEntries(resolve, reject),
        );
        if (!batch.length) break;
        for (const child of batch) await visit(child);
      }
    }
  }
  for (const entry of entries) if (entry) await visit(entry);
  return files;
}
