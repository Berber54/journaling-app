import React from 'react';
import type { FigureState, ImageAlign, ImageLayout, MediaKind } from '../lib/docImages';
import { allowedAligns, isFloating } from '../lib/docImages';

export interface OverlayRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface ImageOverlayProps {
  rect: OverlayRect;
  state: FigureState;
  kind?: MediaKind;
  onDragStart: (e: React.PointerEvent) => void;
  onResizeStart: (corner: Corner, e: React.PointerEvent) => void;
  onLayoutChange: (layout: ImageLayout) => void;
  onAlignChange: (align: ImageAlign) => void;
  onDelete: () => void;
}

export type Corner = 'nw' | 'ne' | 'sw' | 'se';

const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se'];

const LAYOUT_OPTIONS: { layout: ImageLayout; label: string; icon: React.ReactNode }[] = [
  { layout: 'inline', label: 'In line with text', icon: <IconInline /> },
  { layout: 'wrap', label: 'Wrap text', icon: <IconWrap /> },
  { layout: 'break', label: 'Break text', icon: <IconBreak /> },
  { layout: 'behind', label: 'Behind text', icon: <IconBehind /> },
  { layout: 'front', label: 'In front of text', icon: <IconFront /> },
];

const ALIGN_LABEL: Record<ImageAlign, string> = {
  left: 'Align left',
  center: 'Align centre',
  right: 'Align right',
};

export default function ImageOverlay({
  rect,
  state,
  kind = 'image',
  onDragStart,
  onResizeStart,
  onLayoutChange,
  onAlignChange,
  onDelete,
}: ImageOverlayProps) {
  const aligns = allowedAligns(state.layout);
  // Keep the bubble on screen: below the image when it's near the top.
  const toolbarBelow = rect.top < 52;
  const noun = kind === 'video' ? 'video' : 'image';

  return (
    <div
      className="doc-image-overlay"
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
    >
      {/* For a video the grab surface is a slim top strip, leaving the native
          playback controls at the bottom clickable. Images grab the whole box. */}
      <div
        className={kind === 'video' ? 'doc-image-grab doc-image-grab-video' : 'doc-image-grab'}
        onPointerDown={onDragStart}
        title={
          isFloating(state.layout)
            ? `Drag to move the ${noun} anywhere`
            : `Drag to move the ${noun} through the text`
        }
      />

      {CORNERS.map((corner) => (
        <div
          key={corner}
          className={`doc-image-handle doc-image-handle-${corner}`}
          onPointerDown={(e) => onResizeStart(corner, e)}
          role="slider"
          aria-label={`Resize image (${corner})`}
          aria-valuenow={Math.round(state.width)}
        />
      ))}

      <div
        className={`doc-image-bubble ${toolbarBelow ? 'below' : ''}`}
        role="toolbar"
        aria-label={`${noun === 'video' ? 'Video' : 'Image'} options`}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {LAYOUT_OPTIONS.map((opt) => (
          <button
            key={opt.layout}
            type="button"
            className={`doc-image-btn ${state.layout === opt.layout ? 'active' : ''}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onLayoutChange(opt.layout)}
            aria-label={opt.label}
            aria-pressed={state.layout === opt.layout}
            title={opt.label}
          >
            {opt.icon}
          </button>
        ))}

        {aligns.length > 0 && (
          <>
            <span className="doc-image-bubble-divider" />
            {aligns.map((align) => (
              <button
                key={align}
                type="button"
                className={`doc-image-btn ${state.align === align ? 'active' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onAlignChange(align)}
                aria-label={ALIGN_LABEL[align]}
                aria-pressed={state.align === align}
                title={ALIGN_LABEL[align]}
              >
                <IconAlign align={align} />
              </button>
            ))}
          </>
        )}

        <span className="doc-image-bubble-divider" />
        <span className="doc-image-size">{Math.round(state.width)}%</span>

        <span className="doc-image-bubble-divider" />
        <button
          type="button"
          className="doc-image-btn doc-image-btn-danger"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onDelete}
          aria-label={`Remove ${noun}`}
          title={`Remove ${noun}`}
        >
          <IconTrash />
        </button>
      </div>
    </div>
  );
}

// ─── Icons ─────────────────────────────────────────────────────
// 16×16, currentColor. Grey bars = text, filled block = the image.

function IconInline() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <rect x="1" y="2" width="14" height="1.4" fill="currentColor" opacity=".45" />
      <rect x="1" y="6" width="4" height="4" fill="currentColor" />
      <rect x="6" y="7.3" width="9" height="1.4" fill="currentColor" opacity=".45" />
      <rect x="1" y="12.6" width="14" height="1.4" fill="currentColor" opacity=".45" />
    </svg>
  );
}

function IconWrap() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <rect x="1" y="2" width="7" height="7" fill="currentColor" />
      <rect x="9.5" y="2" width="5.5" height="1.3" fill="currentColor" opacity=".45" />
      <rect x="9.5" y="4.9" width="5.5" height="1.3" fill="currentColor" opacity=".45" />
      <rect x="9.5" y="7.8" width="5.5" height="1.3" fill="currentColor" opacity=".45" />
      <rect x="1" y="10.7" width="14" height="1.3" fill="currentColor" opacity=".45" />
      <rect x="1" y="13.3" width="14" height="1.3" fill="currentColor" opacity=".45" />
    </svg>
  );
}

function IconBreak() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <rect x="1" y="1.5" width="14" height="1.3" fill="currentColor" opacity=".45" />
      <rect x="3" y="4.6" width="10" height="6.8" fill="currentColor" />
      <rect x="1" y="13.2" width="14" height="1.3" fill="currentColor" opacity=".45" />
    </svg>
  );
}

function IconBehind() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <rect x="3" y="3" width="10" height="10" fill="currentColor" opacity=".35" />
      <rect x="1" y="5.5" width="14" height="1.5" fill="currentColor" />
      <rect x="1" y="9" width="14" height="1.5" fill="currentColor" />
    </svg>
  );
}

function IconFront() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <rect x="1" y="5.5" width="14" height="1.5" fill="currentColor" opacity=".45" />
      <rect x="1" y="9" width="14" height="1.5" fill="currentColor" opacity=".45" />
      <rect x="3" y="3" width="10" height="10" fill="currentColor" />
    </svg>
  );
}

function IconAlign({ align }: { align: ImageAlign }) {
  const x = align === 'left' ? 1 : align === 'center' ? 4 : 7;
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <rect x="1" y="2" width="14" height="1.3" fill="currentColor" opacity=".45" />
      <rect x={x} y="5.5" width="8" height="5" fill="currentColor" />
      <rect x="1" y="12.7" width="14" height="1.3" fill="currentColor" opacity=".45" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
