import { query } from '../../db/pool.js';
import { createWorldMap } from '../maps/service.js';

export const createWorldMapFromUpload = async ({
  name,
  description,
  bounds,
  layers,
  uploadedBy,
  geojsonUrl,
  fileSizeBytes,
}) => createWorldMap({
  name,
  description,
  bounds,
  layers,
  uploadedBy,
  geojsonUrl,
  fileSizeBytes,
});

export const appendCampaignAsset = async (campaignId, asset) => {
  const payload = JSON.stringify([asset]);
  const { rows } = await query(
    `UPDATE public.campaigns
        SET assets = COALESCE(assets, '[]'::jsonb) || $1::jsonb
      WHERE id = $2
      RETURNING assets`,
    [payload, campaignId],
    { label: 'uploads.campaign_asset.create' },
  );

  if (rows.length === 0) {
    const error = new Error('Campaign not found');
    error.status = 404;
    error.code = 'campaign_not_found';
    throw error;
  }

  return rows[0].assets ?? [];
};

export const listCampaignAssets = async (campaignId) => {
  const { rows } = await query(
    'SELECT assets FROM public.campaigns WHERE id = $1',
    [campaignId],
    { label: 'uploads.campaign_asset.list' },
  );

  if (rows.length === 0) {
    const error = new Error('Campaign not found');
    error.status = 404;
    error.code = 'campaign_not_found';
    throw error;
  }

  return rows[0].assets || [];
};
