import type { ReactNode } from 'react';

/**
 * Lightweight markdown renderer for SRD text.
 * Handles paragraphs, **bold**, *italic*, and pipe tables.
 */
export function MarkdownText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const blocks = parseBlocks(text);

  return (
    <div className={className}>
      {blocks.map((block, i) => {
        if (block.type === 'table') {
          return <MarkdownTable key={i} rows={block.rows} />;
        }
        return (
          <p key={i} className={i > 0 ? 'mt-2' : undefined}>
            {renderInline(block.text)}
          </p>
        );
      })}
    </div>
  );
}

type Block =
  | { type: 'paragraph'; text: string }
  | { type: 'table'; rows: string[][] };

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Detect table: line starts with |
    if (line.trimStart().startsWith('|')) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trimStart().startsWith('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      const rows = tableLines
        .filter((l) => !isSeperatorRow(l))
        .map((l) => parseTableRow(l));
      if (rows.length > 0) {
        blocks.push({ type: 'table', rows });
      }
      continue;
    }

    // Blank line — skip (acts as paragraph break)
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Accumulate paragraph lines
    const paraLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && !lines[i].trimStart().startsWith('|')) {
      paraLines.push(lines[i].trim());
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({ type: 'paragraph', text: paraLines.join(' ') });
    }
  }

  return blocks;
}

function isSeperatorRow(line: string): boolean {
  return /^\|[\s\-:|]+\|$/.test(line.trim());
}

function parseTableRow(line: string): string[] {
  // Split on |, trim, drop empty first/last from leading/trailing pipes
  const cells = line.split('|').map((c) => c.trim());
  // Remove empty strings from leading/trailing |
  if (cells.length > 0 && cells[0] === '') cells.shift();
  if (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
  return cells;
}

function MarkdownTable({ rows }: { rows: string[][] }) {
  if (rows.length === 0) return null;

  const isKeyValue = rows.every((r) => r.length === 2);
  const hasHeader = !isKeyValue && rows.length > 1;
  const headerRow = hasHeader ? rows[0] : null;
  const bodyRows = hasHeader ? rows.slice(1) : rows;

  return (
    <div className="my-2 overflow-x-auto">
      <table className="text-sm w-full border-collapse">
        {headerRow && (
          <thead>
            <tr>
              {headerRow.map((cell, j) => (
                <th key={j} className="text-left font-semibold px-2 py-1 border-b border-border">
                  {renderInline(cell)}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {bodyRows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td
                  key={j}
                  className={`px-2 py-1 border-b border-border ${
                    isKeyValue && j === 0 ? 'font-medium' : 'text-muted-foreground'
                  }`}
                >
                  {renderInline(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderInline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  // Match **bold** or *italic* (but not ** inside bold)
  const regex = /\*\*(.+?)\*\*|\*(.+?)\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    if (match[1] !== undefined) {
      parts.push(<strong key={match.index}>{match[1]}</strong>);
    } else {
      parts.push(<em key={match.index}>{match[2]}</em>);
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}
