import { z } from "zod";

/**
 * Public, stable error codes. Transport adapters (REST, MCP, runner API) map
 * internal failures onto this set so callers can branch without parsing text.
 */
export const apiErrorCodeSchema = z.enum([
  "BAD_REQUEST",
  "VALIDATION_ERROR",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "PAYLOAD_TOO_LARGE",
  "RATE_LIMITED",
  "DEPENDENCY_UNAVAILABLE",
  "INTERNAL_ERROR",
]);

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

export const apiErrorSchema = z.object({
  code: apiErrorCodeSchema,
  message: z.string(),
  requestId: z.string(),
  details: z.unknown().optional(),
});

export type ApiErrorBody = z.infer<typeof apiErrorSchema>;

export const apiErrorEnvelopeSchema = z.object({
  error: apiErrorSchema,
});

export type ApiErrorEnvelope = z.infer<typeof apiErrorEnvelopeSchema>;

/**
 * Application-level error carrying the public code and HTTP status. Internal
 * diagnostics stay in `cause`; only `message`/`details` are exposed.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(
    code: ApiErrorCode,
    message: string,
    statusCode: number,
    options?: { cause?: unknown; details?: unknown },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ApiError";
    this.code = code;
    this.statusCode = statusCode;
    if (options?.details !== undefined) {
      this.details = options.details;
    }
  }

  static badRequest(message = "Bad request", details?: unknown): ApiError {
    return new ApiError("BAD_REQUEST", message, 400, { details });
  }

  static validation(message = "Request validation failed", details?: unknown): ApiError {
    return new ApiError("VALIDATION_ERROR", message, 422, { details });
  }

  static unauthorized(message = "Authentication required"): ApiError {
    return new ApiError("UNAUTHORIZED", message, 401);
  }

  static forbidden(message = "Access denied"): ApiError {
    return new ApiError("FORBIDDEN", message, 403);
  }

  static notFound(message = "Resource not found"): ApiError {
    return new ApiError("NOT_FOUND", message, 404);
  }

  static conflict(message = "Conflict"): ApiError {
    return new ApiError("CONFLICT", message, 409);
  }

  static internal(message = "Internal server error", cause?: unknown): ApiError {
    return new ApiError("INTERNAL_ERROR", message, 500, { cause });
  }
}
