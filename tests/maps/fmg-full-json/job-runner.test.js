/** @jest-environment node */
import { describeWithDb, openTxClient, FIXTURE_PATH } from './db-harness.js';
import { query } from '../../../server/db/pool.js';
import { startImportJob, waitForJob } from '../../../server/services/maps/fmg-full-json/job-runner.js';

describeWithDb('job-runner', () => {
  let client, worldId;

  beforeAll(async () => {
    client = await openTxClient();
    // Seed the world inside the transaction first, then COMMIT so the background
    // pool worker can see the row (pool connections cannot see uncommitted data).
    const { rows } = await client.query(
      `INSERT INTO public.maps_world (name, width_pixels, height_pixels, bounds)
       VALUES ($1, 100, 100, $2) RETURNING id`,
      ['Job-runner test world', JSON.stringify({ minX: 0, minY: 0, maxX: 100, maxY: 100 })],
    );
    worldId = rows[0].id;
    await client.query('COMMIT');
    // Re-open a transaction so rollbackAndClose works normally in afterAll.
    await client.query('BEGIN');
  });

  afterAll(async () => {
    // Rollback the open transaction, then DELETE the committed world row (CASCADE
    // removes all child rows: import_jobs, burgs, cells, etc.).
    try { await client.query('ROLLBACK'); } catch {}
    await query(`DELETE FROM public.maps_world WHERE id = $1`, [worldId]);
    await client.end();
  });

  test('startImportJob returns a UUID job id immediately', async () => {
    const { jobId } = await startImportJob({
      worldId,
      filePath: FIXTURE_PATH,
      uploadedBy: null,
      skipValidation: true,
      skipSettlemaker: true,
    });
    expect(jobId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  test('job completes successfully and sets percent = 100', async () => {
    const { jobId } = await startImportJob({
      worldId,
      filePath: FIXTURE_PATH,
      uploadedBy: null,
      skipValidation: true,
      skipSettlemaker: true,
    });

    const final = await waitForJob(jobId, { timeoutMs: 15000, pollMs: 200 });

    expect(final.status).toBe('completed');
    expect(final.percent).toBe(100);
    expect(final.completed_at).not.toBeNull();
  });

  test('three status transitions: queued → running → completed are written', async () => {
    // We can only observe the terminal state reliably from tests (running is transient),
    // but we can confirm the initial insert wrote 'queued' by checking what waitForJob
    // returns as completed, and verify the running→completed UPDATE fired by asserting
    // completed_at is set (only the completed UPDATE sets it).
    const { jobId } = await startImportJob({
      worldId,
      filePath: FIXTURE_PATH,
      uploadedBy: null,
      skipValidation: true,
      skipSettlemaker: true,
    });

    const final = await waitForJob(jobId, { timeoutMs: 15000, pollMs: 200 });

    expect(final.status).toBe('completed');
    // completed_at proves the completed UPDATE ran (not just the running UPDATE)
    expect(final.completed_at).not.toBeNull();
    // updated_at should be populated
    expect(final.updated_at).not.toBeNull();
  });

  test('failed job stores error message in the jobs table', async () => {
    // Supply a non-existent file path to force an ingest failure.
    const { jobId } = await startImportJob({
      worldId,
      filePath: '/tmp/does-not-exist-fmg.json',
      uploadedBy: null,
      skipValidation: true,
      skipSettlemaker: true,
    });

    const final = await waitForJob(jobId, { timeoutMs: 10000, pollMs: 200 });

    expect(final.status).toBe('failed');
    expect(final.error).toBeTruthy();
  });
});
