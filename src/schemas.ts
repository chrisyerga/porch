import { z } from "zod";

export const providerSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("digitalocean"),
    tokenEnv: z.string().min(1).default("DIGITALOCEAN_TOKEN"),
    ttl: z.number().int().positive().default(180),
  }),
]);

export const hostConfigSchema = z.object({
  version: z.literal(1).default(1),
  acmeEmail: z.string().email(),
  network: z.string().min(1).default("porch"),
  defaultDomain: z.string().min(1).optional(),
  hostIp: z.string().min(1).optional(),
  provider: providerSchema.optional(),
  paths: z
    .object({
      configDir: z.string().min(1).optional(),
      runtimeDir: z.string().min(1).optional(),
      appsDir: z.string().min(1).default("/opt"),
    })
    .default({ appsDir: "/opt" }),
});

export const healthSchema = z.object({
  url: z.string().url().optional(),
  interval: z.string().default("60s"),
  timeout: z.string().default("10s"),
  expectStatus: z.array(z.number().int().positive()).default([200, 301, 302]),
  checkContainer: z.boolean().default(true),
});

export const serviceSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1).optional(),
  environment: z.enum(["production", "preview"]).default("production"),
  domains: z.array(z.string().min(1)).min(1),
  wwwRedirect: z.boolean().default(false),
  upstream: z.object({
    container: z.string().min(1),
    port: z.number().int().positive().max(65535),
  }),
  image: z.string().min(1).optional(),
  env: z.record(z.string(), z.string()).default({}),
  deploy: z
    .object({
      path: z.string().min(1).optional(),
      repository: z.string().min(1).optional(),
      migrationCommand: z.string().min(1).optional(),
    })
    .default({}),
  health: healthSchema.optional(),
  metadata: z.record(z.string(), z.string()).default({}),
});

export const registrySchema = z.object({
  version: z.literal(1).default(1),
  services: z.array(serviceSchema).default([]),
});

export type ProviderConfig = z.infer<typeof providerSchema>;
export type HostConfig = z.infer<typeof hostConfigSchema>;
export type ServiceConfig = z.infer<typeof serviceSchema>;
export type Registry = z.infer<typeof registrySchema>;
