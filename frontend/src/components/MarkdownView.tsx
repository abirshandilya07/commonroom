import { ReactNode } from 'react';

export default function MarkdownView({ content }: { content: string }) {
  const lines = content.split('\n');
  const elements: ReactNode[] = [];
  let inCodeBlock = false;
  let codeBuffer: string[] = [];
  let tableBuffer: string[] = [];

  const flushTable = (key: number) => {
    if (tableBuffer.length < 2) {
      tableBuffer.forEach((line, i) => elements.push(<p key={`tbl-${key}-${i}`} className="my-1">{renderInline(line)}</p>));
      tableBuffer = [];
      return;
    }
    const rows = tableBuffer.map(row => 
      row.split('|').map(cell => cell.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1)
    );
    const header = rows[0];
    const dataRows = rows.slice(2); // Skip separator row (e.g. |---|---|)

    elements.push(
      <div key={`tbl-${key}`} className="my-2 max-w-full overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-left text-xs">
          <thead className="bg-soft/75 text-ink font-semibold border-b border-line">
            <tr>
              {header.map((col, idx) => (
                <th key={idx} className="px-3 py-2">{renderInline(col)}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60 bg-panel/50">
            {dataRows.map((r, rowIdx) => (
              <tr key={rowIdx} className="hover:bg-soft/40">
                {r.map((c, colIdx) => (
                  <td key={colIdx} className="px-3 py-1.5">{renderInline(c)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
    tableBuffer = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Handle Code Blocks
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        elements.push(
          <pre key={`code-${i}`} className="my-2 overflow-x-auto rounded-lg bg-[#18181b] p-3 text-xs text-zinc-200">
            <code>{codeBuffer.join('\n')}</code>
          </pre>
        );
        codeBuffer = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
      continue;
    }

    // Handle Tables
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      tableBuffer.push(line.trim());
      continue;
    } else if (tableBuffer.length) {
      flushTable(i);
    }

    // Headings
    if (line.startsWith('### ')) {
      elements.push(<h4 key={i} className="mt-3 mb-1 text-sm font-bold text-ink">{renderInline(line.slice(4))}</h4>);
    } else if (line.startsWith('## ')) {
      elements.push(<h3 key={i} className="mt-3.5 mb-1 text-base font-bold text-ink">{renderInline(line.slice(3))}</h3>);
    } else if (line.startsWith('# ')) {
      elements.push(<h2 key={i} className="mt-4 mb-1.5 text-lg font-bold text-ink">{renderInline(line.slice(2))}</h2>);
    } 
    // Horizontal Rule
    else if (line.trim() === '---' || line.trim() === '***') {
      elements.push(<hr key={i} className="my-2.5 border-line" />);
    } 
    // Unordered List
    else if (line.match(/^[-*]\s+/)) {
      elements.push(
        <li key={i} className="ml-4 list-disc text-[13px] leading-relaxed">
          {renderInline(line.replace(/^[-*]\s+/, ''))}
        </li>
      );
    } 
    // Ordered List
    else if (line.match(/^\d+\.\s+/)) {
      elements.push(
        <li key={i} className="ml-4 list-decimal text-[13px] leading-relaxed">
          {renderInline(line.replace(/^\d+\.\s+/, ''))}
        </li>
      );
    } 
    // Empty Line
    else if (!line.trim()) {
      elements.push(<div key={i} className="h-1.5" />);
    } 
    // Regular paragraph
    else {
      elements.push(<p key={i} className="text-[13px] leading-relaxed">{renderInline(line)}</p>);
    }
  }

  if (tableBuffer.length) flushTable(lines.length);

  return <div className="space-y-0.5">{elements}</div>;
}

function renderInline(text: string): ReactNode {
  // Regex parsing for bold (**), italic (* or _), inline code (`), and bold-italic (***)
  const tokens: ReactNode[] = [];
  let remaining = text;
  let idx = 0;

  while (remaining) {
    // Inline code `code`
    const codeMatch = remaining.match(/^(.*?)`([^`]+)`(.*)$/);
    // Bold **text**
    const boldMatch = remaining.match(/^(.*?)\*\*([^*]+)\*\*(.*)$/);
    // Italic *text*
    const italicMatch = remaining.match(/^(.*?)\*([^*]+)\*(.*)$/);

    let matchType = null;
    let earliestPos = Infinity;

    if (codeMatch && codeMatch[1].length < earliestPos) {
      earliestPos = codeMatch[1].length;
      matchType = 'code';
    }
    if (boldMatch && boldMatch[1].length < earliestPos) {
      earliestPos = boldMatch[1].length;
      matchType = 'bold';
    }
    if (italicMatch && italicMatch[1].length < earliestPos) {
      earliestPos = italicMatch[1].length;
      matchType = 'italic';
    }

    if (matchType === 'code' && codeMatch) {
      if (codeMatch[1]) tokens.push(<span key={idx++}>{codeMatch[1]}</span>);
      tokens.push(<code key={idx++} className="rounded bg-soft px-1.5 py-0.5 text-[11px] font-mono text-accent">{codeMatch[2]}</code>);
      remaining = codeMatch[3];
    } else if (matchType === 'bold' && boldMatch) {
      if (boldMatch[1]) tokens.push(<span key={idx++}>{boldMatch[1]}</span>);
      tokens.push(<strong key={idx++} className="font-semibold text-ink">{boldMatch[2]}</strong>);
      remaining = boldMatch[3];
    } else if (matchType === 'italic' && italicMatch) {
      if (italicMatch[1]) tokens.push(<span key={idx++}>{italicMatch[1]}</span>);
      tokens.push(<em key={idx++} className="italic">{italicMatch[2]}</em>);
      remaining = italicMatch[3];
    } else {
      tokens.push(<span key={idx++}>{remaining}</span>);
      break;
    }
  }

  return <>{tokens}</>;
}