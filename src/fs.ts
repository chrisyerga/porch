import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export async function readJsonFile<T>(filePath: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
}

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await writeTextAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function writeTextAtomic(filePath: string, value: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, value, "utf8");
  await rename(tempPath, filePath);
}

export async function withFileLock<T>(lockPath: string, fn: () => Promise<T>): Promise<T> {
  await mkdir(path.dirname(lockPath), { recursive: true });
  await mkdir(lockPath, { recursive: false });
  try {
    return await fn();
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
