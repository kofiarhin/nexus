import { appError } from '../utils/errors.js';

/**
 * Small declarative validator.
 *
 * Every external payload and every model-generated proposal passes through
 * here, so the rules stay dependency-free, synchronous, and easy to assert on.
 */

const TYPE_CHECKS = {
  string: (value) => typeof value === 'string',
  number: (value) => typeof value === 'number' && Number.isFinite(value),
  boolean: (value) => typeof value === 'boolean',
  array: (value) => Array.isArray(value),
  object: (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
};

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function checkField(name, rule, value, errors) {
  if (value === undefined || value === null || (rule.type === 'string' && value === '' && !rule.allowEmpty)) {
    if (rule.required) errors.push({ field: name, message: 'is required' });
    return rule.default !== undefined ? structuredClone(rule.default) : undefined;
  }

  let candidate = value;

  if (rule.type === 'string' && rule.coerce && typeof candidate !== 'string') {
    candidate = String(candidate);
  }
  if (rule.type === 'number' && typeof candidate === 'string' && candidate.trim() !== '') {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed)) candidate = parsed;
  }
  if (rule.type === 'boolean' && typeof candidate === 'string') {
    if (candidate === 'true') candidate = true;
    else if (candidate === 'false') candidate = false;
  }

  const check = TYPE_CHECKS[rule.type];
  if (check && !check(candidate)) {
    errors.push({ field: name, message: `must be a ${rule.type}` });
    return undefined;
  }

  if (rule.type === 'string') {
    if (rule.trim !== false) candidate = candidate.trim();
    if (rule.lowercase) candidate = candidate.toLowerCase();
    if (rule.maxLength && candidate.length > rule.maxLength) {
      errors.push({ field: name, message: `must be at most ${rule.maxLength} characters` });
      return undefined;
    }
    if (rule.minLength && candidate.length < rule.minLength) {
      errors.push({ field: name, message: `must be at least ${rule.minLength} characters` });
      return undefined;
    }
    if (rule.pattern && !rule.pattern.test(candidate)) {
      errors.push({ field: name, message: rule.patternMessage ?? 'has an unsupported format' });
      return undefined;
    }
    if (rule.date && !ISO_DATE_PATTERN.test(candidate)) {
      errors.push({ field: name, message: 'must be an ISO date (YYYY-MM-DD)' });
      return undefined;
    }
  }

  if (rule.enum && !rule.enum.includes(candidate)) {
    errors.push({ field: name, message: `must be one of: ${rule.enum.join(', ')}` });
    return undefined;
  }

  if (rule.type === 'array') {
    if (rule.maxItems && candidate.length > rule.maxItems) {
      errors.push({ field: name, message: `must contain at most ${rule.maxItems} items` });
      return undefined;
    }
    if (rule.items) {
      const mapped = [];
      candidate.forEach((item, index) => {
        const itemErrors = [];
        const result = checkField(`${name}[${index}]`, rule.items, item, itemErrors);
        if (itemErrors.length) errors.push(...itemErrors);
        else if (result !== undefined) mapped.push(result);
      });
      candidate = mapped;
    }
  }

  if (rule.type === 'object' && rule.schema) {
    const nested = validate(candidate, rule.schema, { prefix: `${name}.`, collect: errors });
    candidate = nested;
  }

  return candidate;
}

/**
 * Validates `payload` against `schema` and returns a new object containing only
 * declared fields. Throws VALIDATION_ERROR listing every failing field.
 */
export function validate(payload, schema, { prefix = '', collect = null } = {}) {
  const errors = collect ?? [];
  const source = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const output = {};

  for (const [name, rule] of Object.entries(schema)) {
    const result = checkField(`${prefix}${name}`, rule, source[name], errors);
    if (result !== undefined) output[name] = result;
  }

  if (!collect && errors.length > 0) {
    throw appError('VALIDATION_ERROR', 'Request validation failed', { fields: errors });
  }

  return output;
}

/** Non-throwing variant used when validating untrusted model output. */
export function tryValidate(payload, schema) {
  const errors = [];
  const value = validate(payload, schema, { collect: errors });
  return { valid: errors.length === 0, value, errors };
}
