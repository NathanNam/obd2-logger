import JSZip from "jszip";
import { triggerDownload } from "../profiles/disk";

export type ExportScope =
  | { kind: "owner"; owner: string }
  | { kind: "vehicle"; owner: string; slug: string };

export async function exportData(
  rootDir: FileSystemDirectoryHandle,
  scope: ExportScope,
): Promise<{ filename: string; bytes: number }> {
  const zip = new JSZip();
  const dataDir = await rootDir.getDirectoryHandle("data", { create: true });
  const ownerDir = await dataDir.getDirectoryHandle(scope.owner, { create: true });

  if (scope.kind === "owner") {
    await addDirToZip(zip, ownerDir, scope.owner);
  } else {
    const slugDir = await ownerDir.getDirectoryHandle(scope.slug, { create: false });
    await addDirToZip(zip, slugDir, `${scope.owner}/${scope.slug}`);
  }

  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  const today = new Date().toISOString().slice(0, 10);
  const baseName = scope.kind === "owner" ? scope.owner : `${scope.owner}__${scope.slug}`;
  const filename = `${baseName}__${today}.zip`;
  triggerDownload(blob, filename);
  return { filename, bytes: blob.size };
}

async function addDirToZip(
  zip: JSZip,
  dir: FileSystemDirectoryHandle,
  prefix: string,
): Promise<void> {
  for await (const entry of dir.values()) {
    const path = `${prefix}/${entry.name}`;
    if (entry.kind === "file") {
      const file = await (entry as FileSystemFileHandle).getFile();
      zip.file(path, await file.arrayBuffer());
    } else {
      await addDirToZip(zip, entry as FileSystemDirectoryHandle, path);
    }
  }
}
