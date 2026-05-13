import { decryptField } from '../crypto.js';

// Apply decryptField to a whitelist of fields on a row (or array of rows).
// decryptField is a no-op on values that aren't encrypted (it checks for the
// enc:v1: sentinel), so calling this defensively is cheap.
export const decryptUserFields = (rowOrRows, fields) => {
  if (rowOrRows == null) return rowOrRows;
  if (!Array.isArray(fields) || fields.length === 0) return rowOrRows;

  const apply = (row) => {
    if (row == null) return row;
    const out = { ...row };
    for (const field of fields) {
      if (field in out) {
        out[field] = decryptField(out[field]);
      }
    }
    return out;
  };

  return Array.isArray(rowOrRows) ? rowOrRows.map(apply) : apply(rowOrRows);
};
