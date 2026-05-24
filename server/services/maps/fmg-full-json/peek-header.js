import { createReadStream } from 'node:fs';

const HEADER_BYTES = 2 * 1024 * 1024;  // first 2 MB always contains info{} block

export async function peekFmgHeader(filePath) {
  return await new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    const stream = createReadStream(filePath, { start: 0, end: HEADER_BYTES });
    stream.on('data', (chunk) => {
      chunks.push(chunk); total += chunk.length;
      if (total >= HEADER_BYTES) stream.destroy();
    });
    stream.on('close', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      const infoMatch = /"info"\s*:\s*(\{[^}]+\})/.exec(text);
      if (!infoMatch) return reject(new Error('FMG header: info{} not found in first 2MB'));
      try { resolve(JSON.parse(infoMatch[1])); } catch (e) { reject(e); }
    });
    stream.on('error', reject);
  });
}
