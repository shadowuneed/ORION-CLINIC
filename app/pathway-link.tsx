'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ComponentProps, MouseEvent } from 'react';
import { PATHWAY_NAVIGATION_EVENT } from '@/lib/pathway-transition';

export function requestPathwayMotion(event: MouseEvent<HTMLAnchorElement>, target: string, pathname: string, label: string) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey ||
    event.currentTarget.hasAttribute('download') ||
    (event.currentTarget.target && event.currentTarget.target !== '_self')) return;
  const destination = new URL(target, window.location.href);
  if (destination.origin !== window.location.origin ||
    (pathname === '/pathway') === (destination.pathname === '/pathway') ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const request = new CustomEvent(PATHWAY_NAVIGATION_EVENT, {
    cancelable: true, detail: { from: pathname, target, label },
  });
  if (!window.dispatchEvent(request)) event.preventDefault();
}

/** Opt-in keeps form/unsaved-change navigation handlers in control. */
export function PathwayLink({ transitionLabel = 'Рабочее пространство', onClick, href, ...props }:
  ComponentProps<typeof Link> & { transitionLabel?: string }) {
  const pathname = usePathname();
  return <Link {...props} href={href} onClick={(event) => {
    onClick?.(event);
    if (typeof href === 'string') requestPathwayMotion(event, href, pathname, transitionLabel);
  }} />;
}
