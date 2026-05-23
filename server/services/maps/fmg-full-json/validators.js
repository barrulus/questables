const REQUIRED_TOP_LEVEL = ['info', 'settings', 'pack'];
const REQUIRED_PACK = ['cells', 'vertices', 'features', 'states', 'burgs'];
const SUPPORTED_VERSIONS = /^1\.([1-9][0-9]+)\./;  // 1.10.x and above (any minor >= 10)

export function validateParsedFmg(parsed) {
  if (!parsed || typeof parsed !== 'object') throw new Error('parsed JSON is not an object');

  for (const k of REQUIRED_TOP_LEVEL) {
    if (!(k in parsed)) throw new Error(`missing top-level key: ${k}`);
  }
  for (const k of REQUIRED_PACK) {
    if (!Array.isArray(parsed.pack[k])) throw new Error(`missing or non-array pack.${k}`);
  }

  const version = parsed.info?.version || '';
  if (!SUPPORTED_VERSIONS.test(version)) {
    throw new Error(`unsupported FMG version: ${version} (expected 1.10.x–1.99.x)`);
  }

  const cellCount = parsed.pack.cells.length;
  const vertexCount = parsed.pack.vertices.length;
  if (cellCount < 1000) throw new Error(`cell count too low: ${cellCount} (min 1000)`);
  if (vertexCount < cellCount * 2) {
    throw new Error(`vertex count too low: ${vertexCount} (expected >= ${cellCount * 2})`);
  }

  // FK sanity: burg.state must reference a known state.i
  const stateIds = new Set(parsed.pack.states.map((s) => s?.i).filter((i) => i !== undefined));
  for (const b of parsed.pack.burgs) {
    if (!b || b.i === 0) continue; // slot 0 is the FMG sentinel
    if (b.state !== undefined && !stateIds.has(b.state)) {
      throw new Error(`burg ${b.i} references unknown state ${b.state}`);
    }
  }
}
