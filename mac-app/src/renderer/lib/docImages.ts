/**
 * Document media — Google-Docs-style placement of photos and video in the
 * editor.
 *
 * The bytes live in the media store on disk (see main/mediaStore.ts). The entry
 * HTML only carries a placeholder recording **which** file, **where** it sits,
 * and **how** the text behaves around it:
 *
 *   <figure class="doc-image" data-image-id="…" data-kind="video"
 *           data-layout="break" data-align="center" data-width="60"
 *           contenteditable="false">
 *     <video></video>
 *   </figure>
 *
 * The `src` and the positioning styles are added when an entry is loaded
 * (`hydrateMedia`) and stripped again before saving (`serializeContent`), so
 * stored entries stay small and their HTML stays canonical.
 *
 * `data-image-id` keeps its v1 name: every entry already written uses it, and
 * renaming the attribute would orphan the media in all of them. A figure with no
 * `data-kind` is an image, which is exactly what those older entries hold.
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

/** Media kind a figure holds. Absent `data-kind` means image (v1 entries). */
export type FigureKind = 'image' | 'video';

export function figureKind(fig: HTMLElement): FigureKind {
  // `data-media-kind` is what the earlier base64 video build wrote. Read it as
  // well, so an entry created by that build still renders as a video rather
  // than a broken image; `hydrateMedia` then rewrites it to `data-kind`.
  return fig.dataset.kind === 'video' || fig.dataset.mediaKind === 'video' ? 'video' : 'image';
}

export function createFigure(
  imageId: string,
  kind: FigureKind = 'image',
  state?: Partial<FigureState>
): HTMLElement {
  const fig = document.createElement('figure');
  fig.className = 'doc-image';
  fig.dataset.imageId = imageId;
  if (kind === 'video') fig.dataset.kind = 'video';
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

function createMediaElement(kind: FigureKind): HTMLElement {
  if (kind === 'video') {
    const video = document.createElement('video');
    video.controls = true;
    // Enough to render a first frame and know the duration without pulling the
    // whole file; the rest streams over journal-media:// when the user hits play.
    video.preload = 'metadata';
    video.draggable = false;
    return video;
  }
  const img = document.createElement('img');
  img.alt = '';
  img.draggable = false;
  return img;
}

/** One entry's media, keyed by id — what `hydrateMedia` draws from. */
export interface MediaSource {
  /** `journal-media://<id>`, or absent while the bytes are still arriving. */
  url: string;
  kind: FigureKind;
  available: boolean;
}

/**
 * Point every placeholder at its file and apply its geometry.
 *
 * A figure whose bytes haven't reached this device yet (still downloading, or
 * added on another device that hasn't finished uploading) is flagged rather than
 * left as a broken image — the file is coming, and the next sync will fill it in.
 */
export function hydrateMedia(root: HTMLElement, byId: Map<string, MediaSource>): void {
  for (const fig of allFigures(root)) {
    const id = fig.dataset.imageId;
    if (!id) continue;

    const source = byId.get(id);
    const kind = source?.kind ?? figureKind(fig);

    // An entry written on another device may say "video" in its HTML while this
    // element was built as an image (or vice versa) — rebuild it to match.
    let element = fig.querySelector('img, video') as HTMLElement | null;
    const wanted = kind === 'video' ? 'VIDEO' : 'IMG';
    if (!element || element.tagName !== wanted) {
      element?.remove();
      element = createMediaElement(kind);
      fig.insertBefore(element, fig.firstChild);
    }
    if (kind === 'video') fig.dataset.kind = 'video';
    else delete fig.dataset.kind;
    // Converge on the canonical attribute, so entries written by the earlier
    // video build stop carrying both.
    delete fig.dataset.mediaKind;

    if (source?.available) {
      element.setAttribute('src', source.url);
      fig.classList.remove('doc-image-missing', 'doc-image-pending');
    } else {
      element.removeAttribute('src');
      // Known to exist but not here yet vs referenced and simply gone.
      fig.classList.toggle('doc-image-pending', source !== undefined);
      fig.classList.toggle('doc-image-missing', source === undefined);
    }

    fig.dataset.kindLabel = kind;
    (element as HTMLImageElement).draggable = false;
    fig.setAttribute('contenteditable', 'false');
    applyFigureStyle(fig);
  }
}

/** Read the editor surface back out as storable HTML (no srcs, no styles). */
export function serializeContent(root: HTMLElement): string {
  const clone = root.cloneNode(true) as HTMLElement;
  for (const fig of allFigures(clone)) {
    fig.className = 'doc-image';
    fig.removeAttribute('style');
    delete fig.dataset.kindLabel;
    const element = fig.querySelector('img, video');
    if (element) {
      element.removeAttribute('src');
      element.removeAttribute('style');
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
