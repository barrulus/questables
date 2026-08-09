import { promises as fs } from 'fs';
import { query } from '../../../db/pool.js';
import { ingestFullJson } from './index.js';

/**
 * Creates a queued import job row and schedules the ingest to run in the
 * next event-loop tick via setImmediate. Returns the job id immediately so
 * the HTTP layer can respond 202 before the work begins.
 *
 * @param {object} opts
 * @param {string}  opts.worldId        - UUID of the target maps_world row (must be committed)
 * @param {string}  opts.filePath       - Absolute path to the staged JSON file
 * @param {string|null} opts.uploadedBy - UUID of the uploading user (nullable)
 * @param {number|null} [opts.fileSizeBytes]
 * @param {boolean} [opts.skipValidation] - Skip pre-transaction validators (useful for tests
 *                                          with tiny synthetic fixtures below the 1000-cell threshold)
 * @param {boolean} [opts.skipSettlemaker] - Skip settlemaker auto-trigger (useful for tests
 *                                           to avoid pulling in settlemaker's ESM-only module)
 * @returns {Promise<{jobId: string}>}
 */
export async function startImportJob({ worldId, filePath, uploadedBy, fileSizeBytes, skipValidation = false, skipSettlemaker = false }) {
  const { rows } = await query(
    `INSERT INTO public.maps_import_jobs
      (world_id, status, stage, percent, message, file_path, file_size_bytes, uploaded_by)
     VALUES ($1, 'queued', 'pending', 0, 'Queued', $2, $3, $4)
     RETURNING id`,
    [worldId, filePath, fileSizeBytes ?? null, uploadedBy ?? null],
    { label: 'fmg.job.create' },
  );
  const jobId = rows[0].id;

  setImmediate(() => {
    runJob(jobId, worldId, filePath, skipValidation, skipSettlemaker).catch(() => {});
  });

  return { jobId };
}

async function runJob(jobId, worldId, filePath, skipValidation, skipSettlemaker) {
  await query(
    `UPDATE public.maps_import_jobs
        SET status = 'running', updated_at = now()
      WHERE id = $1`,
    [jobId],
    { label: 'fmg.job.start' },
  );

  try {
    await ingestFullJson(worldId, filePath, {
      skipValidation,
      skipSettlemaker,
      onProgress: async ({ stage, percent, message }) => {
        await query(
          `UPDATE public.maps_import_jobs
              SET stage = $2, percent = $3, message = $4, updated_at = now()
            WHERE id = $1`,
          [jobId, stage, percent, message || null],
          { label: 'fmg.job.progress' },
        );
      },
    });

    await query(
      `UPDATE public.maps_import_jobs
          SET status = 'completed', stage = 'done', percent = 100,
              message = 'Ingest complete', completed_at = now(), updated_at = now()
        WHERE id = $1`,
      [jobId],
      { label: 'fmg.job.complete' },
    );
    await fs.unlink(filePath).catch(() => {});
  } catch (err) {
    await query(
      `UPDATE public.maps_import_jobs
          SET status = 'failed', error = $2, updated_at = now()
        WHERE id = $1`,
      [jobId, String(err?.stack || err?.message || err)],
      { label: 'fmg.job.fail' },
    );
    await fs.unlink(filePath).catch(() => {});
  }
}

/**
 * Returns the current state of a job row (or null if not found).
 */
export async function getJobStatus(jobId) {
  const { rows } = await query(
    `SELECT id, world_id, status, stage, percent, message, error,
            created_at, updated_at, completed_at
       FROM public.maps_import_jobs WHERE id = $1`,
    [jobId],
    { label: 'fmg.job.status' },
  );
  return rows[0] || null;
}

/**
 * Polls the job row until it reaches a terminal state (completed / failed)
 * or the timeout elapses.
 *
 * Uses `query()` from the shared pool so it sees committed writes from the
 * background worker even when the caller is inside its own transaction.
 */
export async function waitForJob(jobId, { timeoutMs = 60000, pollMs = 200 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const s = await getJobStatus(jobId);
    if (!s) throw new Error(`job ${jobId} not found`);
    if (s.status === 'completed' || s.status === 'failed') return s;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(`job ${jobId} did not complete within ${timeoutMs}ms timeout`);
}
