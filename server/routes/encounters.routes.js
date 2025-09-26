import { Router } from 'express';
import { getClient } from '../db/pool.js';
import { logError, logInfo } from '../utils/logger.js';

const router = Router();

router.post('/campaigns/:campaignId/encounters', async (req, res) => {
  const { campaignId } = req.params;
  const { name, description, type, difficulty, session_id: sessionId, location_id: locationId } = req.body ?? {};

  if (!name || !type) {
    return res.status(400).json({ error: 'Encounter name and type are required' });
  }

  let client;
  try {
    client = await getClient({ label: 'encounters.create' });
    const { rows } = await client.query(
      `INSERT INTO encounters (
          campaign_id,
          session_id,
          location_id,
          name,
          description,
          type,
          difficulty,
          status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'planned')
       RETURNING *`,
      [
        campaignId,
        sessionId ?? null,
        locationId ?? null,
        name,
        description ?? null,
        type,
        difficulty || 'medium',
      ],
    );

    const encounter = rows[0];
    logInfo('Encounter created', {
      telemetryEvent: 'encounter.created',
      encounterId: encounter?.id,
      campaignId,
    });

    return res.status(201).json(encounter);
  } catch (error) {
    logError('Encounter creation failed', error, { campaignId });
    return res.status(500).json({ error: error.message });
  } finally {
    client?.release();
  }
});

router.get('/encounters/:encounterId', async (req, res) => {
  const { encounterId } = req.params;

  let client;
  try {
    client = await getClient({ label: 'encounters.fetch' });
    const { rows } = await client.query('SELECT * FROM encounters WHERE id = $1', [encounterId]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Encounter not found' });
    }

    return res.json(rows[0]);
  } catch (error) {
    logError('Encounter fetch failed', error, { encounterId });
    return res.status(500).json({ error: error.message });
  } finally {
    client?.release();
  }
});

router.get('/campaigns/:campaignId/encounters', async (req, res) => {
  const { campaignId } = req.params;

  let client;
  try {
    client = await getClient({ label: 'encounters.list' });
    const { rows } = await client.query(
      `SELECT e.*,
              COUNT(ep.id) AS participant_count,
              l.name AS location_name,
              s.title AS session_title
         FROM encounters e
         LEFT JOIN encounter_participants ep ON e.id = ep.encounter_id
         LEFT JOIN locations l ON e.location_id = l.id
         LEFT JOIN sessions s ON e.session_id = s.id
        WHERE e.campaign_id = $1
        GROUP BY e.id, l.name, s.title
        ORDER BY e.created_at DESC`,
      [campaignId],
    );

    return res.json(rows);
  } catch (error) {
    logError('Encounter listing failed', error, { campaignId });
    return res.status(500).json({ error: error.message });
  } finally {
    client?.release();
  }
});

router.post('/encounters/:encounterId/participants', async (req, res) => {
  const { encounterId } = req.params;
  const {
    participant_id: participantId,
    participant_type: participantType,
    name,
    hit_points: hitPoints,
    armor_class: armorClass,
    initiative,
  } = req.body ?? {};

  if (!name || !hitPoints || !armorClass) {
    return res.status(400).json({ error: 'Name, hit points, and armor class are required' });
  }

  let client;
  try {
    client = await getClient({ label: 'encounters.participants.add' });
    const { rows } = await client.query(
      `INSERT INTO encounter_participants (
          encounter_id,
          participant_id,
          participant_type,
          name,
          hit_points,
          armor_class,
          initiative
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        encounterId,
        participantId ?? null,
        participantType || 'npc',
        name,
        JSON.stringify(hitPoints),
        armorClass,
        initiative || 0,
      ],
    );

    return res.status(201).json(rows[0]);
  } catch (error) {
    logError('Encounter participant creation failed', error, { encounterId });
    return res.status(500).json({ error: error.message });
  } finally {
    client?.release();
  }
});

router.post('/encounters/:encounterId/initiative', async (req, res) => {
  const { encounterId } = req.params;
  const { overrides } = req.body ?? {};

  let client;
  try {
    client = await getClient({ label: 'encounters.initiative.roll' });
    await client.query('BEGIN');

    const encounterResult = await client.query('SELECT * FROM encounters WHERE id = $1 FOR UPDATE', [encounterId]);
    if (encounterResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Encounter not found' });
    }

    const participantsResult = await client.query(
      'SELECT id, participant_id FROM encounter_participants WHERE encounter_id = $1',
      [encounterId],
    );

    if (participantsResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Encounter has no participants to roll initiative for' });
    }

    const overrideMap = new Map();
    if (Array.isArray(overrides)) {
      overrides.forEach((entry) => {
        const participantKey = entry?.participantId || entry?.participant_id || entry?.id;
        const initiativeValue = Number(entry?.initiative);
        if (participantKey && Number.isFinite(initiativeValue)) {
          overrideMap.set(participantKey, Math.trunc(initiativeValue));
        }
      });
    }

    const rollResult = await client.query(
      `SELECT id,
              participant_id,
              GREATEST(1, LEAST(40, FLOOR(random() * 20)::int + 1)) AS base_roll
         FROM encounter_participants
        WHERE encounter_id = $1`,
      [encounterId],
    );

    const initiativeAssignments = rollResult.rows.map((row) => {
      const overrideValue = overrideMap.get(row.id) ?? overrideMap.get(row.participant_id);
      const initiativeValue = Number.isFinite(overrideValue) ? overrideValue : row.base_roll;
      return {
        participantId: row.id,
        initiative: initiativeValue,
      };
    });

    for (const assignment of initiativeAssignments) {
      await client.query(
        `UPDATE encounter_participants
            SET initiative = $1,
                has_acted = false
          WHERE id = $2`,
        [assignment.initiative, assignment.participantId],
      );
    }

    const initiativeOrder = initiativeAssignments
      .sort((a, b) => b.initiative - a.initiative)
      .map((assignment) => ({
        participantId: assignment.participantId,
        initiative: assignment.initiative,
        hasActed: false,
      }));

    const updatedEncounterResult = await client.query(
      `UPDATE encounters
          SET status = 'active',
              current_round = CASE
                WHEN current_round IS NULL OR current_round < 1 THEN 1
                ELSE current_round
              END,
              initiative_order = $1,
              updated_at = NOW()
        WHERE id = $2
        RETURNING *`,
      [JSON.stringify(initiativeOrder), encounterId],
    );

    const updatedParticipantsResult = await client.query(
      `SELECT *
         FROM encounter_participants
        WHERE encounter_id = $1
        ORDER BY initiative DESC NULLS LAST, name`,
      [encounterId],
    );

    await client.query('COMMIT');

    return res.json({
      encounter: updatedEncounterResult.rows[0],
      participants: updatedParticipantsResult.rows,
    });
  } catch (error) {
    await client?.query('ROLLBACK').catch(() => {});
    logError('Encounter initiative roll failed', error, { encounterId });
    return res.status(500).json({ error: error.message });
  } finally {
    client?.release();
  }
});

router.get('/encounters/:encounterId/participants', async (req, res) => {
  const { encounterId } = req.params;

  let client;
  try {
    client = await getClient({ label: 'encounters.participants.list' });
    const { rows } = await client.query(
      `SELECT ep.*,
              CASE
                WHEN ep.participant_type = 'character' THEN c.name
                ELSE ep.name
              END AS display_name
         FROM encounter_participants ep
         LEFT JOIN characters c ON ep.participant_id = c.id AND ep.participant_type = 'character'
        WHERE ep.encounter_id = $1
        ORDER BY ep.initiative DESC, ep.name`,
      [encounterId],
    );

    return res.json(rows);
  } catch (error) {
    logError('Encounter participant listing failed', error, { encounterId });
    return res.status(500).json({ error: error.message });
  } finally {
    client?.release();
  }
});

router.put('/encounters/:encounterId', async (req, res) => {
  const { encounterId } = req.params;
  const { status, current_round: currentRound, initiative_order: initiativeOrder, current_turn: currentTurn } = req.body ?? {};

  let client;
  try {
    client = await getClient({ label: 'encounters.update' });
    const { rows } = await client.query(
      `UPDATE encounters
          SET status = COALESCE($1, status),
              current_round = COALESCE($2, current_round),
              initiative_order = COALESCE($3, initiative_order),
              current_turn = COALESCE($4, current_turn),
              updated_at = NOW()
        WHERE id = $5
        RETURNING *`,
      [status ?? null, currentRound ?? null, initiativeOrder ? JSON.stringify(initiativeOrder) : null, currentTurn ?? null, encounterId],
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Encounter not found' });
    }

    return res.json(rows[0]);
  } catch (error) {
    logError('Encounter update failed', error, { encounterId });
    return res.status(500).json({ error: error.message });
  } finally {
    client?.release();
  }
});

router.put('/encounter-participants/:participantId', async (req, res) => {
  const { participantId } = req.params;
  const updates = req.body ?? {};

  const fields = [];
  const values = [];
  let index = 1;

  Object.entries(updates).forEach(([key, value]) => {
    if (['hit_points', 'conditions', 'notes'].includes(key)) {
      fields.push(`${key} = $${index++}`);
      values.push(typeof value === 'object' ? JSON.stringify(value) : value);
    } else if (['has_acted', 'is_concentrating'].includes(key)) {
      fields.push(`${key} = $${index++}`);
      values.push(Boolean(value));
    } else if (['initiative'].includes(key)) {
      const numericValue = Number(value);
      if (!Number.isFinite(numericValue)) {
        return;
      }
      fields.push(`${key} = $${index++}`);
      values.push(Math.trunc(numericValue));
    }
  });

  if (fields.length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  fields.push('updated_at = NOW()');
  values.push(participantId);

  let client;
  try {
    client = await getClient({ label: 'encounters.participants.update' });
    const { rows } = await client.query(
      `UPDATE encounter_participants
          SET ${fields.join(', ')}
        WHERE id = $${index}
        RETURNING *`,
      values,
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Encounter participant not found' });
    }

    return res.json(rows[0]);
  } catch (error) {
    logError('Encounter participant update failed', error, { participantId });
    return res.status(500).json({ error: error.message });
  } finally {
    client?.release();
  }
});

router.delete('/encounter-participants/:participantId', async (req, res) => {
  const { participantId } = req.params;

  let client;
  try {
    client = await getClient({ label: 'encounters.participants.delete' });
    const result = await client.query(
      'DELETE FROM encounter_participants WHERE id = $1 RETURNING id',
      [participantId],
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Encounter participant not found' });
    }

    return res.json({ success: true });
  } catch (error) {
    logError('Encounter participant delete failed', error, { participantId });
    return res.status(500).json({ error: error.message });
  } finally {
    client?.release();
  }
});

export const registerEncounterRoutes = (app) => {
  app.use('/api', router);
};

