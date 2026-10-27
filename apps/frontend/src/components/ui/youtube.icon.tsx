import { FC } from 'react';
import clsx from 'clsx';

// No 'use client': this file has no hooks and is also used by server
// components (the public post preview page).

// The YouTube icon (official full-color artwork, from YouTube brand resources).
// YouTube Branding Guidelines, required by YouTube API Services policy III.F.2:
// keep its shape and colors, never smaller than 20dp in height, always fully
// visible - never altered (no filters, opacity, rounding or recoloring, also
// not through a parent element) or covered.
// https://developers.google.com/youtube/terms/branding-guidelines
const MIN_HEIGHT = 20;
const ASPECT_RATIO = 234.67 / 165.33;

export const isYoutube = (identifier?: string | null) =>
  identifier === 'youtube';

export const YoutubeIcon: FC<{
  height?: number;
  className?: string;
}> = ({ height = MIN_HEIGHT, className }) => {
  const h = Math.max(height, MIN_HEIGHT);
  const w = Math.round(h * ASPECT_RATIO * 100) / 100;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 234.67 165.33"
      width={w}
      height={h}
      // min sizes keep flex layouts from shrinking it under 20px
      style={{ width: w, height: h, minWidth: w, minHeight: h }}
      className={clsx('block shrink-0', className)}
      role="img"
      aria-label="YouTube"
    >
      <title>YouTube</title>
      <path
        d="M229.763 25.817c-2.699-10.162-10.65-18.165-20.748-20.881C190.716 0 117.333 0 117.333 0S43.951 0 25.651 4.936C15.553 7.652 7.6 15.655 4.903 25.817 0 44.236 0 82.667 0 82.667s0 38.429 4.903 56.85C7.6 149.68 15.553 157.681 25.65 160.4c18.3 4.934 91.682 4.934 91.682 4.934s73.383 0 91.682-4.934c10.098-2.718 18.049-10.72 20.748-20.882 4.904-18.421 4.904-56.85 4.904-56.85s0-38.431-4.904-56.85"
        fill="#FF0000"
      />
      <path d="M93.333 117.559l61.333-34.89-61.333-34.894z" fill="#FFFFFF" />
    </svg>
  );
};
