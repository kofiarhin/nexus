const SECRET_KEY_PATTERN = /(token|secret|password|authorization|api[-_]?key|cookie|session)/i;
const BEARER_PATTERN = /\b(Bearer\s+)[A-Za-z0-9._~+/-]{8,}=*/gi;
const GITHUB_TOKEN_PATTERN = /\b(gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,})\b/g;
const NVIDIA_TOKEN_PATTERN = /\bnvapi-[A-Za-z0-9._-]{10,}\b/g;
const REDACTED = '[redacted]';

/** Removes credential-shaped substrings from any string headed for a log. */
export function redactText(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(BEARER_PATTERN, `$1${REDACTED}`)
    .replace(GITHUB_TOKEN_PATTERN, REDACTED)
    .replace(NVIDIA_TOKEN_PATTERN, REDACTED);
}

/** Deep-redacts secret-shaped keys and values. Used for logs and audit details. */
export function redact(value, depth = 0) {
  if (depth > 6) return REDACTED;
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        SECRET_KEY_PATTERN.test(key) ? REDACTED : redact(item, depth + 1)
      ])
    );
  }
  return value;
}
