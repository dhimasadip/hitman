import { ApiError } from "@hitman/contracts";
import type { z } from "zod";

export interface ValidationIssue {
  path: string;
  message: string;
}

function issues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join(".") : "(root)",
    message: issue.message,
  }));
}

export function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw ApiError.validation("Request validation failed", issues(result.error));
  }
  return result.data;
}

export function parseParams<T extends z.ZodType>(schema: T, params: unknown): z.infer<T> {
  const result = schema.safeParse(params);
  if (!result.success) {
    throw ApiError.validation("Invalid route parameters", issues(result.error));
  }
  return result.data;
}

export function parseQuery<T extends z.ZodType>(schema: T, query: unknown): z.infer<T> {
  const result = schema.safeParse(query);
  if (!result.success) {
    throw ApiError.validation("Invalid query parameters", issues(result.error));
  }
  return result.data;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
