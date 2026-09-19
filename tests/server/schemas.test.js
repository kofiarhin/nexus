import { describe, expect, it } from 'vitest';
import { tryValidate, validate } from '../../server/schemas/validate.js';
import { modelOperationSchema, taskCreateSchema } from '../../server/schemas/index.js';

describe('validate', () => {
  it('applies defaults and drops undeclared fields', () => {
    const result = validate({ name: 'Write the plan', injected: 'ignored' }, taskCreateSchema);
    expect(result).toMatchObject({ name: 'Write the plan', status: 'todo', priority: 'medium' });
    expect(result.injected).toBeUndefined();
  });

  it('reports every failing field at once', () => {
    let error;
    try {
      validate({ status: 'invalid', priority: 'urgent', dueDate: 'tomorrow' }, taskCreateSchema);
    } catch (thrown) {
      error = thrown;
    }

    expect(error.code).toBe('VALIDATION_ERROR');
    const fields = error.details.fields.map((field) => field.field);
    expect(fields).toContain('name');
    expect(fields).toContain('status');
    expect(fields).toContain('priority');
    expect(fields).toContain('dueDate');
  });

  it('enforces string length limits', () => {
    expect(() => validate({ name: 'x'.repeat(301) }, taskCreateSchema)).toThrow(/validation/i);
  });

  it('coerces numeric and boolean query strings', () => {
    const schema = { limit: { type: 'number' }, narrative: { type: 'boolean' } };
    expect(validate({ limit: '25', narrative: 'true' }, schema)).toEqual({ limit: 25, narrative: true });
  });

  it('validates array items and rejects an over-long list', () => {
    expect(() => validate(
      { name: 'a', dependencies: Array.from({ length: 30 }, () => 'x') },
      taskCreateSchema
    )).toThrow(/validation/i);
  });
});

describe('tryValidate for untrusted model output', () => {
  it('accepts a well-formed operation proposal', () => {
    const { valid, value } = tryValidate(
      { action: 'append', path: 'tasks/TASKS.md', content: '- [ ] new', reason: 'Requested' },
      modelOperationSchema
    );
    expect(valid).toBe(true);
    expect(value.action).toBe('append');
  });

  it('rejects an unknown action without throwing', () => {
    const { valid, errors } = tryValidate({ action: 'exfiltrate', path: 'tasks/TASKS.md' }, modelOperationSchema);
    expect(valid).toBe(false);
    expect(errors.some((error) => error.field === 'action')).toBe(true);
  });

  it('rejects a traversal path before it reaches the Vault', () => {
    const { valid } = tryValidate({ action: 'replace', path: '../../etc/passwd' }, modelOperationSchema);
    expect(valid).toBe(false);
  });

  it('rejects a missing path', () => {
    const { valid, errors } = tryValidate({ action: 'create' }, modelOperationSchema);
    expect(valid).toBe(false);
    expect(errors.some((error) => error.field === 'path')).toBe(true);
  });
});
