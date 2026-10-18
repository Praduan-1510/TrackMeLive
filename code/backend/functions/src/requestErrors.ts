/**
 * The shared validate()'s issues as callable error details: one
 * {field, message} per bad field, the shape createSession's
 * invalid-argument errors use (details.errors[]).
 */
import type { FieldError } from "./contracts.js";
import type { ValidationIssue } from "./shared/schema.js";

/** "$.settings.precision" -> "settings.precision"; "$" -> "(root)". */
function fieldOf(path: string): string {
  return path.replace(/^\$\.?/, "") || "(root)";
}

/** One error per field: the first issue validate() found there. */
export function fieldErrors(issues: readonly ValidationIssue[]): FieldError[] {
  const byField = new Map<string, string>();
  for (const issue of issues) {
    const field = fieldOf(issue.path);
    if (!byField.has(field)) byField.set(field, issue.message);
  }
  return [...byField].map(([field, message]) => ({ field, message }));
}
