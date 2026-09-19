import React from 'react';

/**
 * Markdown renderer that produces React elements directly.
 *
 * Nothing is ever assigned through `dangerouslySetInnerHTML`, so embedded HTML
 * in a Vault document cannot execute. Link targets are restricted to an
 * explicit protocol allowlist.
 */

const SAFE_PROTOCOLS = ['http:', 'https:', 'mailto:'];

export function isSafeHref(href) {
  const value = String(href ?? '').trim();
  if (value === '') return false;
  // Relative links stay inside the app and never carry a protocol.
  if (value.startsWith('/') || value.startsWith('#') || value.startsWith('./') || value.startsWith('../')) return true;
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return true;
  try {
    return SAFE_PROTOCOLS.includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

const INLINE_PATTERN = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;

/** Renders bold, italic, inline code, and links inside a block of text. */
export function renderInline(text, keyPrefix = 'i') {
  const parts = String(text ?? '').split(INLINE_PATTERN).filter((part) => part !== '' && part !== undefined);

  return parts.map((part, index) => {
    const key = `${keyPrefix}-${index}`;

    if (/^\*\*[^*]+\*\*$/.test(part) || /^__[^_]+__$/.test(part)) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    if (/^\*[^*]+\*$/.test(part) || /^_[^_]+_$/.test(part)) {
      return <em key={key}>{part.slice(1, -1)}</em>;
    }
    if (/^`[^`]+`$/.test(part)) {
      return <code key={key}>{part.slice(1, -1)}</code>;
    }

    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      const [, label, href] = link;
      if (!isSafeHref(href)) return <span key={key}>{label}</span>;
      const external = /^https?:/i.test(href);
      return (
        <a key={key} href={href} {...(external ? { target: '_blank', rel: 'noreferrer noopener' } : {})}>
          {label}
        </a>
      );
    }

    return <React.Fragment key={key}>{part}</React.Fragment>;
  });
}

function parseBlocks(markdown) {
  const lines = String(markdown ?? '').split(/\r?\n/);
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (line.trim() === '') {
      index += 1;
      continue;
    }

    const fence = line.match(/^\s*```(\w*)\s*$/);
    if (fence) {
      const code = [];
      index += 1;
      while (index < lines.length && !/^\s*```/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push({ type: 'code', language: fence[1], content: code.join('\n') });
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, content: heading[2] });
      index += 1;
      continue;
    }

    if (/^\s*(?:[-*_]\s*){3,}$/.test(line)) {
      blocks.push({ type: 'rule' });
      index += 1;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quote = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^\s*>\s?/, ''));
        index += 1;
      }
      blocks.push({ type: 'quote', content: quote.join('\n') });
      continue;
    }

    if (/^\s*\|/.test(line)) {
      const rows = [];
      while (index < lines.length && /^\s*\|/.test(lines[index])) {
        rows.push(lines[index]);
        index += 1;
      }
      blocks.push({ type: 'table', rows });
      continue;
    }

    const listMatch = line.match(/^\s*(?:([-*+])|(\d+)\.)\s+/);
    if (listMatch) {
      const ordered = Boolean(listMatch[2]);
      const items = [];
      while (index < lines.length && /^\s*(?:[-*+]|\d+\.)\s+/.test(lines[index])) {
        const raw = lines[index].replace(/^\s*(?:[-*+]|\d+\.)\s+/, '');
        const checkbox = raw.match(/^\[([ xX])\]\s*(.*)$/);
        items.push(
          checkbox
            ? { checked: checkbox[1].toLowerCase() === 'x', content: checkbox[2] }
            : { checked: null, content: raw }
        );
        index += 1;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    const paragraph = [];
    while (
      index < lines.length
      && lines[index].trim() !== ''
      && !/^\s*(?:#{1,6}\s|```|>|\||[-*+]\s|\d+\.\s)/.test(lines[index])
    ) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push({ type: 'paragraph', content: paragraph.join('\n') });
  }

  return blocks;
}

const splitRow = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());

function TableBlock({ rows, blockKey }) {
  const parsed = rows.map(splitRow).filter((cells) => !cells.every((cell) => /^:?-{2,}:?$/.test(cell)));
  if (parsed.length === 0) return null;
  const [header, ...body] = parsed;

  return (
    <div className="table-scroll" key={blockKey}>
      <table>
        <thead>
          <tr>
            {header.map((cell, index) => (
              <th key={`h-${index}`} scope="col">{renderInline(cell, `${blockKey}-h-${index}`)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((cells, rowIndex) => (
            <tr key={`r-${rowIndex}`}>
              {cells.map((cell, cellIndex) => (
                <td key={`c-${cellIndex}`}>{renderInline(cell, `${blockKey}-${rowIndex}-${cellIndex}`)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Markdown({ content, className = 'markdown' }) {
  const blocks = parseBlocks(content);

  if (blocks.length === 0) {
    return <p className="muted">This document is empty.</p>;
  }

  return (
    <div className={className}>
      {blocks.map((block, index) => {
        const key = `b-${index}`;

        if (block.type === 'heading') {
          const Tag = `h${Math.min(block.level + 1, 6)}`;
          return <Tag key={key}>{renderInline(block.content, key)}</Tag>;
        }
        if (block.type === 'code') {
          return (
            <pre key={key} className="code-block">
              <code>{block.content}</code>
            </pre>
          );
        }
        if (block.type === 'rule') return <hr key={key} />;
        if (block.type === 'quote') {
          return <blockquote key={key}>{renderInline(block.content, key)}</blockquote>;
        }
        if (block.type === 'table') return <TableBlock key={key} rows={block.rows} blockKey={key} />;
        if (block.type === 'list') {
          const ListTag = block.ordered ? 'ol' : 'ul';
          return (
            <ListTag key={key} className={block.items.some((item) => item.checked !== null) ? 'checklist' : undefined}>
              {block.items.map((item, itemIndex) => (
                <li key={`${key}-${itemIndex}`}>
                  {item.checked !== null && (
                    <span className="checkbox" aria-label={item.checked ? 'Completed' : 'Not completed'}>
                      {item.checked ? '☑' : '☐'}
                    </span>
                  )}
                  {renderInline(item.content, `${key}-${itemIndex}`)}
                </li>
              ))}
            </ListTag>
          );
        }
        return <p key={key}>{renderInline(block.content, key)}</p>;
      })}
    </div>
  );
}

export { parseBlocks };
