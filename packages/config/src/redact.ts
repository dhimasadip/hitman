const SENSITIVE_KEY_PATTERN =
  /(authorization|cookie|password|passwd|secret|token|api[-_]?key|private[-_]?key|credential|session)/i;

const REDACTED = "[REDACTED]";
const MAX_LOG_STRING = 2_000;

export const pinoRedactPaths = [
  "req.headers.authorization",
  "req.headers.cookie",
  "request.headers.authorization",
  "request.headers.cookie",
  "headers.authorization",
  "headers.cookie",
  "authorization",
  "cookie",
  "password",
  "*.password",
  "token",
  "*.token",
  "secret",
  "*.secret",
  "apiKey",
  "*.apiKey",
  "privateKey",
  "*.privateKey",
  "DATABASE_URL",
  "*.DATABASE_URL",
  "config.DATABASE_URL",
  "err.config.headers.authorization",
];

function redactConnectionString(value: string): string {
  // Redact credentials embedded in URLs without parsing the whole value.
  return value.replace(/([a-z][a-z0-9+.-]*:\/\/)([^/@\s]+)@/gi, `$1${REDACTED}@`);
}

function sanitizeString(value: string): string {
  const redacted = redactConnectionString(value);
  return redacted.length > MAX_LOG_STRING
    ? `${redacted.slice(0, MAX_LOG_STRING)}…[truncated]`
    : redacted;
}

export interface SanitizeOptions {
  maxDepth?: number;
}

/**
 * Recursively redact values whose keys look sensitive. This is a defensive
 * helper for structured metadata; callers must still avoid logging bodies,
 * credentials, or header maps wholesale.
 */
export function sanitizeForLog(value: unknown, options: SanitizeOptions = {}): unknown {
  const maxDepth = options.maxDepth ?? 6;

  function walk(current: unknown, depth: number, seen: WeakSet<object>): unknown {
    if (current === null || current === undefined) return current;
    if (typeof current === "string") return sanitizeString(current);
    if (typeof current === "number" || typeof current === "boolean") return current;
    if (typeof current === "bigint") return current.toString();
    if (typeof current === "function") return "[Function]";
    if (current instanceof Error) return sanitizeError(current, depth);
    if (depth >= maxDepth) return "[MaxDepth]";
    if (typeof current !== "object") return String(current);
    if (seen.has(current)) return "[Circular]";
    seen.add(current);

    if (Array.isArray(current)) {
      return current.map((item) => walk(item, depth + 1, seen));
    }

    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(current as Record<string, unknown>)) {
      output[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : walk(child, depth + 1, seen);
    }
    return output;
  }

  return walk(value, 0, new WeakSet());
}

export interface SafeError {
  name: string;
  message: string;
  stack?: string;
  code?: string;
  cause?: SafeError;
}

export function sanitizeError(error: unknown, depth = 0): SafeError {
  if (!(error instanceof Error)) {
    return { name: "Error", message: sanitizeString(String(error)) };
  }

  const safe: SafeError = {
    name: error.name,
    message: sanitizeString(error.message),
  };

  const code = (error as Error & { code?: unknown }).code;
  if (typeof code === "string") safe.code = code;
  if (error.stack) safe.stack = sanitizeString(error.stack);
  if (error.cause && depth < 3) safe.cause = sanitizeError(error.cause, depth + 1);

  return safe;
}
