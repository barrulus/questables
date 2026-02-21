import { query } from '../../db/pool.js';

export const listProviders = async () => {
  const { rows } = await query(
    `SELECT id, name, adapter, host, model, timeout_ms, options, enabled, default_provider,
            created_at, updated_at
       FROM public.llm_providers
      ORDER BY default_provider DESC, created_at ASC`,
    [],
    { label: 'admin.llm_providers.list' },
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    adapter: row.adapter,
    host: row.host,
    model: row.model,
    timeoutMs: row.timeout_ms,
    options: row.options ?? {},
    enabled: row.enabled,
    defaultProvider: row.default_provider,
    createdAt: row.created_at?.toISOString?.() ?? null,
    updatedAt: row.updated_at?.toISOString?.() ?? null,
  }));
};

export const createProvider = async ({ name, adapter, host, model, apiKey, timeoutMs, options }) => {
  if (!name || !adapter) {
    const error = new Error('name and adapter are required');
    Object.assign(error, { statusCode: 400 });
    throw error;
  }

  const { rows } = await query(
    `INSERT INTO public.llm_providers (name, adapter, host, model, api_key, timeout_ms, options)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, name, adapter, host, model, timeout_ms, options, enabled, default_provider, created_at, updated_at`,
    [
      name,
      adapter,
      host ?? null,
      model ?? null,
      apiKey ?? null,
      timeoutMs ?? null,
      options ? JSON.stringify(options) : '{}',
    ],
    { label: 'admin.llm_providers.create' },
  );

  return rows[0];
};

export const updateProvider = async (name, updates) => {
  const allowedFields = {
    adapter: 'adapter',
    host: 'host',
    model: 'model',
    apiKey: 'api_key',
    timeoutMs: 'timeout_ms',
    options: 'options',
    enabled: 'enabled',
  };

  const sets = [];
  const values = [];
  let paramIndex = 1;

  for (const [jsKey, dbColumn] of Object.entries(allowedFields)) {
    if (updates[jsKey] === undefined) continue;
    let value = updates[jsKey];
    if (dbColumn === 'options' && typeof value === 'object') {
      value = JSON.stringify(value);
    }
    sets.push(`${dbColumn} = $${paramIndex}`);
    values.push(value);
    paramIndex++;
  }

  if (sets.length === 0) {
    const error = new Error('No valid fields to update');
    Object.assign(error, { statusCode: 400 });
    throw error;
  }

  values.push(name);

  const { rows } = await query(
    `UPDATE public.llm_providers
        SET ${sets.join(', ')}
      WHERE name = $${paramIndex}
      RETURNING id, name, adapter, host, model, timeout_ms, options, enabled, default_provider, created_at, updated_at`,
    values,
    { label: 'admin.llm_providers.update' },
  );

  if (rows.length === 0) {
    const error = new Error(`Provider "${name}" not found`);
    Object.assign(error, { statusCode: 404 });
    throw error;
  }

  return rows[0];
};

export const deleteProvider = async (name) => {
  // Prevent deleting the last enabled provider
  const { rows: enabledRows } = await query(
    `SELECT COUNT(*)::int AS cnt FROM public.llm_providers WHERE enabled = true`,
    [],
    { label: 'admin.llm_providers.count_enabled' },
  );

  const { rows: targetRows } = await query(
    `SELECT enabled FROM public.llm_providers WHERE name = $1`,
    [name],
    { label: 'admin.llm_providers.check_target' },
  );

  if (targetRows.length === 0) {
    const error = new Error(`Provider "${name}" not found`);
    Object.assign(error, { statusCode: 404 });
    throw error;
  }

  if (targetRows[0].enabled && (enabledRows[0]?.cnt ?? 0) <= 1) {
    const error = new Error('Cannot delete the last enabled provider');
    Object.assign(error, { statusCode: 409 });
    throw error;
  }

  const { rows } = await query(
    `DELETE FROM public.llm_providers WHERE name = $1 RETURNING name`,
    [name],
    { label: 'admin.llm_providers.delete' },
  );

  return rows[0] ?? null;
};

export const setDefaultProvider = async (name) => {
  // Verify provider exists
  const { rows: checkRows } = await query(
    `SELECT id FROM public.llm_providers WHERE name = $1`,
    [name],
    { label: 'admin.llm_providers.check_exists' },
  );

  if (checkRows.length === 0) {
    const error = new Error(`Provider "${name}" not found`);
    Object.assign(error, { statusCode: 404 });
    throw error;
  }

  // Unset all defaults, then set the target
  await query(
    `UPDATE public.llm_providers SET default_provider = false WHERE default_provider = true`,
    [],
    { label: 'admin.llm_providers.unset_defaults' },
  );

  const { rows } = await query(
    `UPDATE public.llm_providers SET default_provider = true WHERE name = $1
     RETURNING id, name, adapter, host, model, timeout_ms, options, enabled, default_provider`,
    [name],
    { label: 'admin.llm_providers.set_default' },
  );

  return rows[0];
};

export const listAvailableModels = async (providerName, registry) => {
  if (!registry) {
    const error = new Error('LLM registry is not available');
    Object.assign(error, { statusCode: 503 });
    throw error;
  }

  let provider;
  try {
    provider = registry.get(providerName);
  } catch {
    const error = new Error(`Provider "${providerName}" is not registered in the active registry`);
    Object.assign(error, { statusCode: 404 });
    throw error;
  }

  if (!provider || typeof provider.checkHealth !== 'function') {
    const error = new Error(`Provider "${providerName}" does not support model listing`);
    Object.assign(error, { statusCode: 501 });
    throw error;
  }

  const health = await provider.checkHealth();
  return health?.availableModels ?? [];
};
