import '../../config/load-env.js';

const REQUIRED_KEYS = [
  'MOVEMENT_GRID_TYPE',
  'MOVEMENT_GRID_SIZE',
  'MOVEMENT_SNAP_ORIGIN_X',
  'MOVEMENT_SNAP_ORIGIN_Y',
];

const movementConfig = (() => {
  const missing = REQUIRED_KEYS.filter((key) => !process.env[key] || process.env[key].trim() === '');
  if (missing.length > 0) {
    throw new Error(`Missing movement configuration env vars: ${missing.join(', ')}`);
  }

  const gridTypeRaw = process.env.MOVEMENT_GRID_TYPE.trim().toLowerCase();
  const ALLOWED_TYPES = new Set(['square', 'hex']);
  if (!ALLOWED_TYPES.has(gridTypeRaw)) {
    throw new Error(`MOVEMENT_GRID_TYPE must be one of ${Array.from(ALLOWED_TYPES).join(', ')}`);
  }

  const parseNumber = (key) => {
    const value = Number(process.env[key]);
    if (!Number.isFinite(value)) {
      throw new Error(`Movement config ${key} must be a finite number`);
    }
    return value;
  };

  const gridSize = parseNumber('MOVEMENT_GRID_SIZE');
  if (gridSize <= 0) {
    throw new Error('MOVEMENT_GRID_SIZE must be > 0');
  }

  const originX = parseNumber('MOVEMENT_SNAP_ORIGIN_X');
  const originY = parseNumber('MOVEMENT_SNAP_ORIGIN_Y');

  return {
    gridType: gridTypeRaw,
    gridSize,
    originX,
    originY,
  };
})();

export const getMovementConfig = () => movementConfig;

const roundToNearest = (value, size, origin) => origin + Math.round((value - origin) / size) * size;

const snapSquare = (x, y) => {
  const { gridSize, originX, originY } = movementConfig;
  return {
    x: roundToNearest(x, gridSize, originX),
    y: roundToNearest(y, gridSize, originY),
  };
};

const cartesianToAxial = (x, y) => {
  const { gridSize, originX, originY } = movementConfig;
  const dx = x - originX;
  const dy = y - originY;
  const q = ((Math.sqrt(3) / 3) * dx - (1 / 3) * dy) / gridSize;
  const r = ((2 / 3) * dy) / gridSize;
  return { q, r };
};

const axialToCartesian = (q, r) => {
  const { gridSize, originX, originY } = movementConfig;
  const x = originX + gridSize * (Math.sqrt(3) * q + (Math.sqrt(3) / 2) * r);
  const y = originY + gridSize * ((3 / 2) * r);
  return { x, y };
};

const cubeRound = (x, y, z) => {
  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);

  const xDiff = Math.abs(rx - x);
  const yDiff = Math.abs(ry - y);
  const zDiff = Math.abs(rz - z);

  if (xDiff > yDiff && xDiff > zDiff) {
    rx = -ry - rz;
  } else if (yDiff > zDiff) {
    ry = -rx - rz;
  } else {
    rz = -rx - ry;
  }

  return { x: rx, y: ry, z: rz };
};

const snapHex = (x, y) => {
  const { q, r } = cartesianToAxial(x, y);
  const cubeX = q;
  const cubeZ = r;
  const cubeY = -cubeX - cubeZ;
  const rounded = cubeRound(cubeX, cubeY, cubeZ);
  return axialToCartesian(rounded.x, rounded.z);
};

export const snapToGrid = (x, y) => {
  if (movementConfig.gridType === 'square') {
    return snapSquare(x, y);
  }
  return snapHex(x, y);
};

export const computeDistance = (a, b) => {
  if (!a || !b) return null;
  return Math.hypot(b.x - a.x, b.y - a.y);
};
