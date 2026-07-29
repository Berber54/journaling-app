/**
 * Document images — Google-Docs-style image placement inside the editor.
 *
 * The image *bytes* stay in the `journal_images` table (local to the device).
 * The entry HTML only carries a placeholder recording **where** the image sits
 * and **how** the text behaves around it:
 *
 *   <figure class="doc-image" data-image-id="…" data-layout="break"
 *           data-align="center" data-width="60" contenteditable="false">
 *     <img alt="">
 *   </figure>
 *
 * The `src` and the positioning styles are added when an entry is loaded
 * (`hydrateImages`) and stripped again before saving (`serializeContent`), so
 * stored entries stay small and their HTML stays canonical.
 */

/** How text behaves around an image — mirrors the Google Docs options. */
export type ImageLayout =
  | 'inline'  // sits in the text like a very large character
  | 'wrap'    // floats left/right, text flows around it
  | 'break'   // own line, text above and below
  | 'behind'  // free-floating, text paints on top
  | 'front';  // free-floating, paints on top of the text

export type ImageAlign = 'left' | 'center' | 'right';

export interface FigureState {
  layout: ImageLayout;
  align: ImageAlign;
  /** Width as a percentage of the writing column. */
  width: number;
  /** Free-position offsets — only meaningful for 'behind' / 'front'. */
  x: number; // % of the column width
  y: number; // px from the top of the column
}

export const FIGURE_SELECTOR = 'figure.doc-image';
export const DEFAULT_LAYOUT: ImageLayout = 'break';
export const DEFAULT_ALIGN: ImageAlign = 'center';
export const DEFAULT_WIDTH = 55;
export const MIN_WIDTH = 8;
export const MAX_WIDTH = 100;

const LAYOUTS: ImageLayout[] = ['inline', 'wrap', 'break', 'behind', 'front'];

/** 'behind' / 'front' are positioned freely rather than anchored in the text. */
export function isFloating(layout: ImageLayout): boolean {
  return layout === 'behind' || layout === 'front';
}

/** Which alignments make sense for a layout ('wrap' can only sit left or right). */
export function allowedAligns(layout: ImageLayout): ImageAlign[] {
  if (layout === 'wrap') return ['left', 'right'];
  if (layout === 'break') return ['left', 'center', 'right'];
  return [];
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

const num = (raw: string | null, fallback: number) => {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
};

export function readFigure(fig: HTMLElement): FigureState {
  const rawLayout = fig.dataset.layout as ImageLayout | undefined;
  const layout = rawLayout && LAYOUTS.includes(rawLayout) ? rawLayout : DEFAULT_LAYOUT;
  const rawAlign = fig.dataset.align as ImageAlign | undefined;
  return {
    layout,
    align: rawAlign === 'left' || rawAlign === 'right' || rawAlign === 'center' ? rawAlign : DEFAULT_ALIGN,
    width: clamp(num(fig.dataset.width ?? null, DEFAULT_WIDTH), MIN_WIDTH, MAX_WIDTH),
    x: clamp(num(fig.dataset.x ?? null, 0), -20, 100),
    y: Math.max(num(fig.dataset.y ?? null, 0), 0),
  };
}

/** Write state back onto the figure and refresh its inline geometry. */
export function writeFigure(fig: HTMLElement, patch: Partial<FigureState>): FigureState {
  const next: FigureState = { ...readFigure(fig), ...patch };

  // Keep alignment legal for the layout — 'wrap' has no centre position.
  const aligns = allowedAligns(next.layout);
  if (aligns.length && !aligns.includes(next.align)) {
    next.align = aligns.includes('right') && next.align === 'center' ? 'right' : aligns[0];
  }
  next.width = clamp(next.width, MIN_WIDTH, MAX_WIDTH);

  fig.dataset.layout = next.layout;
  fig.dataset.align = next.align;
  fig.dataset.width = String(Math.round(next.width * 10) / 10);
  if (isFloating(next.layout)) {
    fig.dataset.x = String(Math.round(next.x * 10) / 10);
    fig.dataset.y = String(Math.round(next.y));
  }
  applyFigureStyle(fig);
  return next;
}

/** Layout rules live in editor.css; only the geometry has to be inline. */
export function applyFigureStyle(fig: HTMLElement): void {
  const { layout, width, x, y } = readFigure(fig);
  fig.style.cssText = '';
  fig.style.width = `${width}%`;
  if (isFloating(layout)) {
    fig.style.left = `${x}%`;
    fig.style.top = `${y}px`;
  }
}

export function createFigure(imageId: string, state?: Partial<FigureState>): HTMLElement {
  const fig = document.createElement('figure');
  fig.className = 'doc-image';
  fig.dataset.imageId = imageId;
  fig.setAttribute('contenteditable', 'false');

  const img = document.createElement('img');
  img.alt = '';
  img.draggable = false;
  fig.appendChild(img);

  writeFigure(fig, {
    layout: DEFAULT_LAYOUT,
    align: DEFAULT_ALIGN,
    width: DEFAULT_WIDTH,
    x: 0,
    y: 0,
    ...state,
  });
  return fig;
}

export function findFigure(root: HTMLElement, imageId: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`${FIGURE_SELECTOR}[data-image-id="${CSS.escape(imageId)}"]`);
}

export function allFigures(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FIGURE_SELECTOR));
}

/**
 * Fill in the `src` of every placeholder from the local image store and apply
 * its geometry. Images added on another device don't sync (see ARCHITECTURE
 * §4.2), so a placeholder with no local bytes is flagged rather than left as a
 * broken image.
 */
export function hydrateImages(root: HTMLElement, srcById: Map<string, string>): void {
  for (const fig of allFigures(root)) {
    const id = fig.dataset.imageId;
    const img = fig.querySelector('img');
    if (!id || !img) continue;
    const src = srcById.get(id);
    if (src) {
      img.setAttribute('src', src);
      fig.classList.remove('doc-image-missing');
    } else {
      img.removeAttribute('src');
      fig.classList.add('doc-image-missing');
    }
    img.setAttribute('alt', '');
    (img as HTMLImageElement).draggable = false;
    fig.setAttribute('contenteditable', 'false');
    applyFigureStyle(fig);
  }
}

/** Read the editor surface back out as storable HTML (no base64, no styles). */
export function serializeContent(root: HTMLElement): string {
  const clone = root.cloneNode(true) as HTMLElement;
  for (const fig of allFigures(clone)) {
    fig.className = 'doc-image';
    fig.removeAttribute('style');
    const img = fig.querySelector('img');
    if (img) {
      img.removeAttribute('src');
      img.removeAttribute('style');
    }
  }
  return clone.innerHTML;
}

/** Image ids referenced by a document — from a live element or stored HTML. */
export function referencedImageIds(source: HTMLElement | string): Set<string> {
  let root: HTMLElement;
  if (typeof source === 'string') {
    root = document.createElement('div');
    root.innerHTML = source;
  } else {
    root = source;
  }
  const ids = new Set<string>();
  for (const fig of allFigures(root)) {
    if (fig.dataset.imageId) ids.add(fig.dataset.imageId);
  }
  return ids;
}
