/**
 * SEO: páginas públicas con dirección propia (`/como-se-juega`,
 * `/privacidad`), además de los `#…` de siempre dentro de la app.
 */
export const PAGE_RULES = '/como-se-juega';
export const PAGE_PRIVACY = '/privacidad';

/** Abre una página pública sin recargar (queda en el historial). */
export function openPage(path: string): void {
  history.pushState({ inApp: true }, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/**
 * Cierra una página pública: si se abrió desde la app, atrás; si se entró
 * directamente (desde Google), a la portada sin salir de la web.
 */
export function closePage(): void {
  if ((history.state as { inApp?: boolean } | null)?.inApp) {
    history.back();
    return;
  }
  history.replaceState(null, '', '/');
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/** Para enlaces: `<a href="/como-se-juega" onClick={linkTo('/como-se-juega')}>`. */
export function linkTo(path: string) {
  return (e: { preventDefault: () => void; metaKey?: boolean; ctrlKey?: boolean }) => {
    if (e.metaKey || e.ctrlKey) return; // abrir en otra pestaña: que lo haga el navegador
    e.preventDefault();
    openPage(path);
  };
}
