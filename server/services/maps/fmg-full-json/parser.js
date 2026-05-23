import { promises as fs, createReadStream } from 'node:fs';

const STREAMING_THRESHOLD_BYTES = 150 * 1024 * 1024;  // 150 MB

export async function parseFmgFile(filePath, { forceStreaming = false } = {}) {
  const stat = await fs.stat(filePath);
  if (!forceStreaming && stat.size < STREAMING_THRESHOLD_BYTES) {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  }
  return await parseStreaming(filePath);
}

async function parseStreaming(filePath) {
  // Dynamically import stream-json to keep it optional and avoid resolution
  // issues in test environments where stream-json lives in server/node_modules.
  const streamJsonMod = await import('stream-json');
  const { default: Assembler } = await import('stream-json/assembler.js');

  // In stream-json v3, the default export is parserStream (parser.asStream bound),
  // so calling it directly creates a Node.js Transform stream.
  const parserStream = streamJsonMod.default || streamJsonMod.parserStream;

  return new Promise((resolve, reject) => {
    const pipeline = createReadStream(filePath).pipe(parserStream());
    Assembler.connectTo(pipeline, { onDone: (a) => resolve(a.current) });
    pipeline.on('error', reject);
  });
}
