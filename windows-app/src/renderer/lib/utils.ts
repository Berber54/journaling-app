/**
 * Generate a UUIDv4 using the Web Crypto API.
 */
export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Format an ISO 8601 date for display.
 */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Format an ISO 8601 date with time for display.
 */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Get the current time as an ISO 8601 string.
 */
export function nowISO(): string {
  return new Date().toISOString();
}

/**
 * Convert stored entry HTML (rich text) into plain text — used when feeding
 * entries to the LLM and for previews.
 */
export function htmlToText(html: string): string {
  const tmp = document.createElement('div');
  tmp.innerHTML = html || '';
  // Turn block boundaries into newlines so paragraphs don't run together.
  tmp.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  tmp.querySelectorAll('div, p').forEach((el) => el.append('\n'));
  return (tmp.textContent || '').replace(/ /g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Debounce a function call.
 */
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  ms: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
