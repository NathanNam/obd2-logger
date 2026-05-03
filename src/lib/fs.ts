import {
  clearRootDirHandle,
  getRootDirHandle,
  setRootDirHandle,
} from "./db";

export type PermissionState = "granted" | "prompt" | "denied";

async function queryPermission(
  handle: FileSystemDirectoryHandle,
  mode: "read" | "readwrite" = "readwrite",
): Promise<PermissionState> {
  return (await handle.queryPermission({ mode })) as PermissionState;
}

async function requestPermission(
  handle: FileSystemDirectoryHandle,
  mode: "read" | "readwrite" = "readwrite",
): Promise<PermissionState> {
  return (await handle.requestPermission({ mode })) as PermissionState;
}

export async function pickRootDirectory(): Promise<FileSystemDirectoryHandle> {
  const handle = await window.showDirectoryPicker({
    id: "obd2-logger-root",
    mode: "readwrite",
    startIn: "documents",
  });
  await setRootDirHandle(handle);
  await scaffoldRootChildren(handle);
  return handle;
}

export async function loadStoredRoot(): Promise<
  { handle: FileSystemDirectoryHandle; permission: PermissionState } | null
> {
  const handle = await getRootDirHandle();
  if (!handle) return null;
  const permission = await queryPermission(handle);
  return { handle, permission };
}

export async function ensurePermission(
  handle: FileSystemDirectoryHandle,
): Promise<PermissionState> {
  const current = await queryPermission(handle);
  if (current === "granted") return current;
  return requestPermission(handle);
}

export async function forgetRoot(): Promise<void> {
  await clearRootDirHandle();
}

export async function scaffoldRootChildren(
  root: FileSystemDirectoryHandle,
): Promise<void> {
  await root.getDirectoryHandle("data", { create: true });
  await root.getDirectoryHandle("profiles", { create: true });
}

export async function ensureOwnerDir(
  root: FileSystemDirectoryHandle,
  owner: string,
): Promise<FileSystemDirectoryHandle> {
  const data = await root.getDirectoryHandle("data", { create: true });
  return data.getDirectoryHandle(owner, { create: true });
}

export async function renameOwnerDir(
  root: FileSystemDirectoryHandle,
  oldOwner: string,
  newOwner: string,
): Promise<void> {
  if (oldOwner === newOwner) return;
  const data = await root.getDirectoryHandle("data", { create: true });

  let oldDir: FileSystemDirectoryHandle | null = null;
  try {
    oldDir = await data.getDirectoryHandle(oldOwner, { create: false });
  } catch {
    oldDir = null;
  }
  if (!oldDir) {
    await data.getDirectoryHandle(newOwner, { create: true });
    return;
  }

  const newDir = await data.getDirectoryHandle(newOwner, { create: true });
  await copyDirectory(oldDir, newDir);
  await data.removeEntry(oldOwner, { recursive: true });
}

async function copyDirectory(
  src: FileSystemDirectoryHandle,
  dst: FileSystemDirectoryHandle,
): Promise<void> {
  for await (const entry of src.values()) {
    if (entry.kind === "file") {
      const file = await (entry as FileSystemFileHandle).getFile();
      const out = await dst.getFileHandle(entry.name, { create: true });
      const writer = await out.createWritable();
      await writer.write(await file.arrayBuffer());
      await writer.close();
    } else {
      const childSrc = entry as FileSystemDirectoryHandle;
      const childDst = await dst.getDirectoryHandle(entry.name, {
        create: true,
      });
      await copyDirectory(childSrc, childDst);
    }
  }
}
