import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import {
  hostConfigSchema,
  registrySchema,
  serviceSchema,
  type HostConfig,
  type Registry,
  type ServiceConfig,
} from "./schemas.js";
import { readJsonFile, withFileLock, writeJsonAtomic } from "./fs.js";
import type { PorchPaths } from "./paths.js";

export async function loadHostConfig(paths: PorchPaths): Promise<HostConfig> {
  const raw = await readJsonFile<unknown>(paths.hostConfigPath);
  if (!raw) {
    throw new Error(`Host config not found at ${paths.hostConfigPath}. Run porch host init first.`);
  }
  return hostConfigSchema.parse(raw);
}

export async function writeHostConfig(paths: PorchPaths, config: HostConfig): Promise<void> {
  await writeJsonAtomic(paths.hostConfigPath, hostConfigSchema.parse(config));
}

export async function loadRegistry(paths: PorchPaths): Promise<Registry> {
  await mkdir(paths.servicesDir, { recursive: true });
  const entries = await readdir(paths.servicesDir, { withFileTypes: true });
  const services: ServiceConfig[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const raw = await readJsonFile<unknown>(path.join(paths.servicesDir, entry.name));
    if (raw) services.push(serviceSchema.parse(raw));
  }

  return registrySchema.parse({
    version: 1,
    services: services.sort((a, b) => a.id.localeCompare(b.id)),
  });
}

export async function upsertService(
  paths: PorchPaths,
  service: ServiceConfig,
): Promise<{ created: boolean; service: ServiceConfig }> {
  return withFileLock(path.join(paths.configDir, ".lock"), async () => {
    const parsed = serviceSchema.parse(service);
    const filePath = servicePath(paths, parsed.id);
    const existing = await readJsonFile<unknown>(filePath);
    await writeJsonAtomic(filePath, parsed);
    return { created: !existing, service: parsed };
  });
}

export async function removeService(paths: PorchPaths, id: string): Promise<boolean> {
  return withFileLock(path.join(paths.configDir, ".lock"), async () => {
    const filePath = servicePath(paths, id);
    const existing = await readJsonFile<unknown>(filePath);
    if (!existing) return false;
    await rm(filePath, { force: true });
    return true;
  });
}

export function servicePath(paths: PorchPaths, id: string): string {
  return path.join(paths.servicesDir, `${id}.json`);
}
