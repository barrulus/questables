/**
 * @jest-environment node
 *
 * Regression: the upload router used to call `router.use(requireAuth)` and
 * was then mounted at `/api`. Because Express `router.use` middleware runs
 * for every path the router is invoked on — including paths the router has
 * no handler for — that wired `requireAuth` into every later-registered
 * `/api/*` route. The live pentest caught this by observing that
 * `/api/websocket/status` (registered after the upload router) returned a
 * 401 instead of the public liveness payload.
 *
 * This test rebuilds the same registration topology in-memory: an upload
 * router (with the new per-route requireAuth) mounted at `/api`, followed
 * by a public route at `/api/public/sentinel`. If anyone re-introduces
 * `router.use(requireAuth)` here, the sentinel will start returning 401
 * and the test fails.
 */
import { describe, it, expect } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { Router } from 'express';

const fakeRequireAuth = (req, res, next) => {
  if (!req.headers.authorization) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
};

describe('upload router scope', () => {
  it('does not gate sibling /api/* routes registered after it', async () => {
    const app = express();

    // Mirror uploads.routes.js: a Router with per-route requireAuth, mounted at /api.
    const uploadRouter = Router();
    uploadRouter.post('/upload/avatar', fakeRequireAuth, (_req, res) => res.json({ ok: true }));
    uploadRouter.post('/upload/map', fakeRequireAuth, (_req, res) => res.json({ ok: true }));
    app.use('/api', uploadRouter);

    // A later-registered public sentinel under the same prefix.
    app.get('/api/public/sentinel', (_req, res) => res.json({ public: true }));

    // The upload routes still 401 anonymously.
    expect((await request(app).post('/api/upload/avatar')).status).toBe(401);

    // The sentinel must remain public.
    const sentinel = await request(app).get('/api/public/sentinel');
    expect(sentinel.status).toBe(200);
    expect(sentinel.body).toEqual({ public: true });
  });

  it('shows the failure mode if router.use(requireAuth) ever returns', async () => {
    // Sanity check: this is what the original bug looked like. Documenting it
    // here so the regression test above is meaningful — if you ever wonder
    // whether the assertion is testing anything, flip these lines around.
    const app = express();
    const broken = Router();
    broken.use(fakeRequireAuth); // ← the bug
    broken.post('/upload/avatar', (_req, res) => res.json({ ok: true }));
    app.use('/api', broken);
    app.get('/api/public/sentinel', (_req, res) => res.json({ public: true }));

    expect((await request(app).get('/api/public/sentinel')).status).toBe(401);
  });
});
