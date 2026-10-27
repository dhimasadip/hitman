import type { BuildInfo } from "@hitman/contracts";

export interface BuildMetadata {
  version: string;
  commit: string;
  builtAt: string | null;
}

export function readBuildMetadata(
  source: NodeJS.ProcessEnv = process.env,
  fallbackVersion = "0.1.0",
): BuildMetadata {
  const builtAt = source.BUILD_TIME;
  return {
    version: source.SERVICE_VERSION ?? fallbackVersion,
    commit: source.GIT_COMMIT ?? "unknown",
    builtAt: builtAt && builtAt !== "unknown" ? builtAt : null,
  };
}

export function buildInfo(service: string, metadata: BuildMetadata): BuildInfo {
  return {
    name: service,
    version: metadata.version,
    commit: metadata.commit,
    builtAt: metadata.builtAt,
    nodeVersion: process.version,
  };
}
