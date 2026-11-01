/** Server-owned CSS: visible HTML must not depend on client hydration for layout. */
export function safeFirstPaintCss(css: string) { return css.replace(/<\/style/gi, '<\\/style'); }

export function FirstPaintStyles({ id, css }: { id: string; css: string }) {
  return <style data-orion-first-paint={id} dangerouslySetInnerHTML={{ __html: safeFirstPaintCss(css) }} />;
}
