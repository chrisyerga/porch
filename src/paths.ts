import path from "node:path";

export type PorchPaths = {
  configDir: string;
  runtimeDir: string;
  servicesDir: string;
  hostConfigPath: string;
  caddyfilePath: string;
  edgeComposePath: string;
};

export function resolvePorchPaths(options: {
  configDir?: string;
  runtimeDir?: string;
}): PorchPaths {
  const configDir = path.resolve(
    options.configDir ?? process.env.PORCH_CONFIG_DIR ?? "/etc/porch",
  );
  const runtimeDir = path.resolve(
    options.runtimeDir ?? process.env.PORCH_RUNTIME_DIR ?? "/opt/porch",
  );

  return {
    configDir,
    runtimeDir,
    servicesDir: path.join(configDir, "services"),
    hostConfigPath: path.join(configDir, "porch.config.json"),
    caddyfilePath: path.join(runtimeDir, "Caddyfile"),
    edgeComposePath: path.join(runtimeDir, "docker-compose.yml"),
  };
}
