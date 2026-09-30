'use client';

import { useId } from 'react';
import styles from './orion-brand.module.css';

/** Shared orbital geometry; inherit the parent's color, including busy buttons. */
export function OrionMark({ animated = false, size = 40, className = '' }: {
  animated?: boolean;
  size?: number;
  className?: string;
}) {
  const cutoutId = `orion-cutout-${useId().replace(/:/g, '')}`;
  const behindId = `${cutoutId}-behind`;
  const frontId = `${cutoutId}-front`;
  const backId = `${cutoutId}-back`;
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"
      width={size} height={size} style={{ width: size, height: size }}
      className={`${styles.mark} ${animated ? styles.animated : ''} ${className}`}
      aria-hidden="true" focusable="false" data-orion-mark={animated ? 'animated' : 'static'}>
      <defs>
        <clipPath id={frontId}><path d="M-64 64H192V192H-64Z" transform="rotate(-28 64 64)" /></clipPath>
        <clipPath id={backId}><path d="M-64-64H192V64H-64Z" transform="rotate(-28 64 64)" /></clipPath>
        <mask id={behindId} maskUnits="userSpaceOnUse" x="-8" y="-8" width="144" height="144">
          <rect x="-8" y="-8" width="144" height="144" fill="white" />
          <circle cx="64" cy="64" r="43" fill="black" />
        </mask>
        <mask id={cutoutId} maskUnits="userSpaceOnUse" x="0" y="0" width="128" height="128">
          <rect width="128" height="128" fill="white" />
          <path d="M116.9768555715 35.8317062328A60 13 -28 0 1 11.0231444285 92.1682937672" fill="none" stroke="black" strokeWidth="7" />
          <g clipPath={`url(#${frontId})`}><g className={styles.satellite}><circle r="8.5" fill="black" /></g></g>
        </mask>
      </defs>
      <g mask={`url(#${behindId})`} data-orbit-layer="back">
        <path d="M11.0231444285 92.1682937672A60 13 -28 0 1 116.9768555715 35.8317062328" fill="none" stroke="currentColor" strokeWidth="3.5" opacity=".65" />
        <g clipPath={`url(#${backId})`}><g className={styles.satellite}><circle r="6.2" fill="currentColor" /></g></g>
      </g>
      <circle cx="64" cy="64" r="35" fill="none" stroke="currentColor" strokeWidth="14" mask={`url(#${cutoutId})`} />
      <g data-orbit-layer="front">
        <path d="M116.9768555715 35.8317062328A60 13 -28 0 1 11.0231444285 92.1682937672" fill="none" stroke="currentColor" strokeWidth="3.5" />
        <g clipPath={`url(#${frontId})`}><g className={styles.satellite}><circle r="6.2" fill="currentColor" /></g></g>
      </g>
    </svg>
  );
}

/** Separate, accessible text; the symbol never replaces the brand name. */
export function OrionWordmark({ className = '' }: { className?: string }) {
  return <span className={`${styles.wordmark} ${className}`}><strong>ORION</strong><small>Clinic</small></span>;
}

/** Decorative brand motion is slower than actual loading feedback. */
export function OrionBrand({ className = '', wordmarkClassName = '', size = 44, animated = false }: {
  className?: string;
  wordmarkClassName?: string;
  size?: number;
  animated?: boolean;
}) {
  return <span className={`${styles.brand} ${className}`}><OrionMark animated={animated} size={size} /><OrionWordmark className={wordmarkClassName} /></span>;
}

/** Indeterminate progress only: no artificial percentage or success. */
export function OrionLoading({ label = 'Загружаем рабочее место…', compact = false, className = '' }: {
  label?: string;
  compact?: boolean;
  className?: string;
}) {
  return <div className={`${styles.loading} ${compact ? styles.compact : ''} ${className}`} role="status" aria-live="polite" aria-atomic="true">
    <OrionMark animated size={compact ? 24 : 76} /><span>{label}</span>
  </div>;
}
