/**
 * Secret values are referenced by opaque strings (for example
 * `env://HITMAN_SECRET_EXAMPLE_API_TOKEN`). The provider resolves them only at
 * the point of use. Callers must never return resolved values from REST/MCP
 * responses or write them to logs.
 */
export interface SecretProvider {
  readonly kind: string;
  resolve(reference: string): Promise<string>;
  describe(reference: string): { provider: string; name: string };
  healthCheck(): Promise<boolean>;
}

export class SecretResolutionError extends Error {
  constructor(
    message: string,
    readonly reference: string,
    options?: { cause?: unknown },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "SecretResolutionError";
  }
}

const ENV_PREFIX = "env://";
const SAFE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export class EnvironmentSecretProvider implements SecretProvider {
  readonly kind = "env";

  constructor(private readonly source: NodeJS.ProcessEnv = process.env) {}

  describe(reference: string) {
    if (!reference.startsWith(ENV_PREFIX)) {
      throw new SecretResolutionError("Unsupported secret reference scheme", reference);
    }
    const name = reference.slice(ENV_PREFIX.length);
    if (!SAFE_NAME.test(name)) {
      throw new SecretResolutionError("Invalid secret reference name", reference);
    }
    return { provider: this.kind, name };
  }

  async resolve(reference: string): Promise<string> {
    const { name } = this.describe(reference);
    const value = this.source[name];
    if (value === undefined || value.length === 0) {
      throw new SecretResolutionError("Secret is not configured", reference);
    }
    return value;
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}

export function createSecretProvider(kind: "env"): SecretProvider {
  switch (kind) {
    case "env":
      return new EnvironmentSecretProvider();
  }
}
