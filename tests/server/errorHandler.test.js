import express from 'express';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { requestId } from '../../server/middleware/requestId.js';
import { errorHandler } from '../../server/middleware/errorHandler.js';

function createErrorApp(error) {
  const app = express();
  app.use(requestId);
  app.get('/boom', (req, res, next) => next(error));
  app.use(errorHandler);
  return app;
}

describe('errorHandler', () => {
  it('redacts unexpected internal error messages', async () => {
    const response = await request(createErrorApp(new Error('database password leaked'))).get('/boom');

    expect(response.status).toBe(500);
    expect(response.body.error).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Internal server error'
    });
    expect(JSON.stringify(response.body)).not.toContain('database password');
    expect(response.body.requestId).toBe(response.headers['x-request-id']);
  });

  it('preserves explicitly safe operational messages', async () => {
    const error = new Error('Safe operational message');
    error.status = 503;
    error.code = 'SAFE_OPERATIONAL_ERROR';
    error.expose = true;

    const response = await request(createErrorApp(error)).get('/boom');

    expect(response.status).toBe(503);
    expect(response.body.error).toEqual({
      code: 'SAFE_OPERATIONAL_ERROR',
      message: 'Safe operational message'
    });
  });
});
