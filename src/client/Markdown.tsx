import type { ReactNode } from "react";

/**
 * The Markdown subset the assistant writes: headings, bullet and numbered lists, paragraphs, bold, italic, inline
 * code and links. Everything renders as React elements from parsed text, so no HTML in a message is ever injected.
 */
type Block =
  | { readonly kind: "heading"; readonly level: 1 | 2 | 3; readonly text: string }
  | { readonly kind: "list"; readonly ordered: boolean; readonly items: readonly string[] }
  | { readonly kind: "paragraph"; readonly lines: readonly string[] };

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d{1,3}[.)]\s+(.*)$/;

export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | undefined;

  const flush = (): void => {
    if (paragraph.length > 0) blocks.push({ kind: "paragraph", lines: paragraph });
    if (list !== undefined) blocks.push({ kind: "list", ...list });
    paragraph = [];
    list = undefined;
  };

  for (const line of text.split("\n")) {
    if (line.trim() === "") {
      flush();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading !== null) {
      flush();
      const level = Math.min(heading[1].length, 3) as 1 | 2 | 3;
      blocks.push({ kind: "heading", level, text: heading[2] });
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet === null ? NUMBERED.exec(line) : null;
    const item = bullet ?? numbered;
    if (item !== null) {
      const ordered = numbered !== null;
      if (list === undefined || list.ordered !== ordered) {
        flush();
        list = { ordered, items: [] };
      }
      list.items.push(item[1]);
      continue;
    }
    if (list !== undefined) {
      // An indented line continues the last list item; anything else ends the list.
      if (/^\s+/.test(line)) {
        list.items[list.items.length - 1] += ` ${line.trim()}`;
        continue;
      }
      flush();
    }
    paragraph.push(line);
  }
  flush();
  return blocks;
}

const INLINE =
  /\*\*(?!\s)(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|(?<![\w*])\*(?!\s)([^*\n]+?)\*(?![\w*])/g;

/** Only web and mail links become anchors; any other scheme stays plain text. */
const safeHref = (href: string): string | undefined =>
  /^(https?:|mailto:)/i.test(href) ? href : undefined;

export function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index;
    if (index > last) nodes.push(text.slice(last, index));
    const key = `${index}`;
    if (match[1] !== undefined) nodes.push(<strong key={key}>{renderInline(match[1])}</strong>);
    else if (match[2] !== undefined) nodes.push(<code key={key}>{match[2]}</code>);
    else if (match[3] !== undefined) {
      const href = safeHref(match[4]);
      nodes.push(
        href === undefined ? (
          match[3]
        ) : (
          <a key={key} href={href} target="_blank" rel="noreferrer noopener">
            {match[3]}
          </a>
        ),
      );
    } else if (match[5] !== undefined) nodes.push(<em key={key}>{renderInline(match[5])}</em>);
    last = index + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

const HEADING_TAG = { 1: "h3", 2: "h4", 3: "h5" } as const;

export function Markdown({ text }: { readonly text: string }) {
  return (
    <div className="markdown">
      {parseBlocks(text).map((block, index) => {
        switch (block.kind) {
          case "heading": {
            const Tag = HEADING_TAG[block.level];
            return <Tag key={index}>{renderInline(block.text)}</Tag>;
          }
          case "list": {
            const Tag = block.ordered ? "ol" : "ul";
            return (
              <Tag key={index}>
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{renderInline(item)}</li>
                ))}
              </Tag>
            );
          }
          case "paragraph":
            return (
              <p key={index}>
                {block.lines.flatMap((line, lineIndex) =>
                  lineIndex === 0
                    ? renderInline(line)
                    : [<br key={`br-${lineIndex}`} />, ...renderInline(line)],
                )}
              </p>
            );
        }
      })}
    </div>
  );
}
