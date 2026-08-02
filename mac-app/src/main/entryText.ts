/**
 * Render an entry's stored rich-text HTML down to text.
 *
 * Entry bodies are HTML (ARCHITECTURE §12) — fine for the editor, wrong for a
 * file you mean to read or hand to a language model. The renderer has a DOM and
 * uses it (`renderer/lib/utils.ts`); the main process does not, so this walks
 * the tag stream directly. That is enough here: the HTML it reads is the
 * editor's own output, not arbitrary web content.
 *
 * Blocks come out separated by a blank line. Each `<div>`/`<p>` the editor
 * writes is one line the user typed, and a blank line between them is both what
 * Markdown needs to see a new paragraph and how the entry reads as plain text.
 * A `<br>` (shift+enter) stays a single newline inside its block.
 *
 * Pure and dependency-free, so it can be unit tested and reused as-is by any
 * other platform's main process.
 */

/** Tags whose start and end put a line boundary in the text. */
const BLOCK_TAGS = new Set([
  'address', 'article', 'blockquote', 'div', 'dd', 'dl', 'dt', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6', 'header', 'hr', 'li', 'ol', 'p', 'pre', 'section', 'table',
  'tr', 'ul',
]);

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’',
  ldquo: '“', rdquo: '”', bull: '•', middot: '·', copy: '©', deg: '°',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#[Xx]?[0-9A-Fa-f]+|[A-Za-z][A-Za-z0-9]*);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** Matches one tag, tolerating `>` inside a quoted attribute value. */
const TAG_RE = /<\/?([A-Za-z][A-Za-z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;

function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(attrs);
  if (!m) return null;
  return decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
}

export type FigureKind = 'image' | 'video';

export interface RenderOptions {
  /** Emit `**bold**` / `*italic*` markers. */
  markdown: boolean;
  /** What to write in place of a `<figure>` holding a photo or video. */
  figure: (id: string | null, kind: FigureKind) => string;
}

export function renderEntryHtml(html: string, options: RenderOptions): string {
  // Neither is ever produced by the editor; dropping them means a pasted-in
  // fragment can't smuggle script text into an exported file.
  const source = (html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '');

  let out = '';
  let cursor = 0;
  // Depth inside a <figure>: its contents are an empty <img>/<video>, and the
  // placeholder has already been written, so everything in there is skipped.
  let figureDepth = 0;

  const pushText = (raw: string): void => {
    if (figureDepth > 0) return;
    // HTML collapses runs of whitespace; U+00A0 (from &nbsp;) is not one of them.
    const text = decodeEntities(raw).replace(/[ \t\r\n\f]+/g, ' ');
    if (text) out += text;
  };

  const lineBreak = (): void => {
    if (figureDepth > 0) return;
    out = out.replace(/[ \t]+$/, '');
    out += '\n';
  };

  /** Markdown emphasis, keeping whitespace outside the marker. */
  const emphasis = (marker: string, closing: boolean): void => {
    if (!closing) {
      out += marker;
      return;
    }
    // `**bold **` is not emphasis to a Markdown parser — the space has to move
    // out past the closing marker.
    const trailing = /[ \t]+$/.exec(out);
    if (trailing) {
      out = out.slice(0, -trailing[0].length) + marker + trailing[0];
    } else {
      out += marker;
    }
  };

  TAG_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TAG_RE.exec(source)) !== null) {
    if (match.index > cursor) pushText(source.slice(cursor, match.index));
    cursor = TAG_RE.lastIndex;

    const closing = match[0][1] === '/';
    const tag = match[1].toLowerCase();
    const attrs = match[2] ?? '';

    if (tag === 'figure') {
      if (closing) {
        figureDepth = Math.max(0, figureDepth - 1);
      } else {
        if (figureDepth === 0) {
          const id = attr(attrs, 'data-image-id');
          // `data-media-kind` is what an earlier build wrote; read both.
          const kind = (attr(attrs, 'data-kind') ?? attr(attrs, 'data-media-kind') ?? '').toLowerCase();
          lineBreak();
          out += options.figure(id, kind === 'video' ? 'video' : 'image');
          out += '\n';
        }
        // A self-closing <figure/> never gets a matching end tag.
        if (!/\/\s*$/.test(attrs)) figureDepth += 1;
      }
      continue;
    }

    if (figureDepth > 0) continue;

    if (tag === 'br' || BLOCK_TAGS.has(tag)) {
      lineBreak();
    } else if (options.markdown && (tag === 'b' || tag === 'strong')) {
      emphasis('**', closing);
    } else if (options.markdown && (tag === 'i' || tag === 'em')) {
      emphasis('*', closing);
    }
    // Everything else (span, u, font, colour styling) carries no meaning once
    // the entry is a text file, so it is dropped.
  }
  if (cursor < source.length) pushText(source.slice(cursor));

  return out
    .replace(/ /g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
