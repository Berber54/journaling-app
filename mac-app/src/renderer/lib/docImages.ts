/**
 * Document media — Google-Docs-style image *and video* placement inside the
 * editor.
 *
 * The media *bytes* stay in the `journal_images` table (a data: URL whose MIME
 * type identifies the kind — `data:image/png…` or `data:video/mp4…`). The entry
 * HTML only carries a placeholder recording **where** the media sits and **how**
 * the text behaves around it:
 *
 *   <figure class="doc-image" data-image-id="…" data-layout="break"
 *           data-align="center" data-width="60" contenteditable="false">
 *     <img alt="">                       <!-- an image -->
 *   </figure>
 *   <figure class="doc-image" data-image-id="…" data-media-kind="video" …>
 *     <video controls></video>           <!-- a video -->
 *   </figure>
 *
 * The `src` and the positioning styles are added when an entry is loaded
 * (`hydrateImages`) and stripped again before saving (`serializeContent`), so
 * stored entries stay small and their HTML stays canonical. Because the bytes
 * are just data: URLs, images and videos share the same local store and the
 * same sync path (see ARCHITECTURE §8) — only the rendered element differs.
 */

/** What kind of media a figure holds. Images have no `data-media-kind`. */
export type MediaKind = 'image' | 'video';

/** Infer the media kind from a data: URL's MIME type. */
export function mediaKindFromDataUrl(dataUrl: string): MediaKind {
  return /^data:video\//i.test(dataUrl) ? 'video' : 'image';
}

/** The kind a placed figure holds (`data-media-kind` or a `<video>` child). */
export function figureKind(fig: HTMLElement): MediaKind {
  return fig.dataset.mediaKind === 'video' || fig.querySelector('video') ? 'video' : 'image';
}

/** Create the inner media element for a figure of the given kind. */
function createMediaElement(kind: MediaKind): HTMLImageElement | HTMLVideoElement {
  if (kind === 'video') {
    const video = document.createElement('video');
    video.controls = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.draggable = false;
    return video;
  }
  const img = document.createElement('img');
  img.alt = '';
  img.draggable = false;
  return img;
}

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

export function createFigure(
  imageId: string,
  state?: Partial<FigureState>,
  kind: MediaKind = 'image',
): HTMLElement {
  const fig = document.createElement('figure');
  fig.className = 'doc-image';
  fig.dataset.imageId = imageId;
  if (kind === 'video') fig.dataset.mediaKind = 'video';
  fig.setAttribute('contenteditable', 'false');

  fig.appendChild(createMediaElement(kind));

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
 * Fill in the `src` of every placeholder (image or video) from the local media
 * store and apply its geometry. Media bytes sync separately from the entry HTML
 * (ARCHITECTURE §8), so a placeholder whose bytes haven't arrived on this device
 * yet is flagged rather than left as a broken element — it fills in on the next
 * sync. The `src` is only touched when it actually changes, so a background sync
 * re-hydrating an open entry never interrupts a video that's already playing.
 */
export function hydrateImages(root: HTMLElement, srcById: Map<string, string>): void {
  for (const fig of allFigures(root)) {
    const id = fig.dataset.imageId;
    const media = fig.querySelector<HTMLImageElement | HTMLVideoElement>('img, video');
    if (!id || !media) continue;
    const src = srcById.get(id);
    if (src) {
      if (media.getAttribute('src') !== src) media.setAttribute('src', src);
      fig.classList.remove('doc-image-missing');
    } else {
      media.removeAttribute('src');
      fig.classList.add('doc-image-missing');
    }
    if (media instanceof HTMLImageElement) media.setAttribute('alt', '');
    media.draggable = false;
    fig.setAttribute('contenteditable', 'false');
    applyFigureStyle(fig);
  }
}

/** Read the editor surface back out as storable HTML (no base64, no styles). */
export function serializeContent(root: HTMLElement): string {
  const clone = root.cloneNode(true) as HTMLElement;
  for (const fig of allFigures(clone)) {
    // Reset the class (drops transient state like doc-image-missing) but keep
    // the data-* attributes, including data-media-kind, that describe the figure.
    fig.className = 'doc-image';
    fig.removeAttribute('style');
    const media = fig.querySelector('img, video');
    if (media) {
      media.removeAttribute('src');
      media.removeAttribute('style');
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
