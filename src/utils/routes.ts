/** The only routes that own the persistent navigation bar. */
export const PRIMARY_ROUTES = ['/', '/transactions', '/budgets', '/analytics'] as const;

export function isPrimaryRoute(pathname: string): boolean {
  return PRIMARY_ROUTES.some((route) =>
    route === '/'
      ? pathname === '/' || pathname === '/index'
      : pathname === route || pathname.startsWith(`${route}/`),
  );
}

/** Full-screen flows that must never show the nav or the create FAB. */
export function isImmersiveRoute(pathname: string): boolean {
  return (
    pathname.startsWith('/transaction/new') ||
    pathname.startsWith('/quick-entry') ||
    pathname.startsWith('/onboarding') ||
    pathname.startsWith('/data') ||
    pathname.startsWith('/import/') ||
    pathname.startsWith('/shared/expense/new') ||
    pathname.startsWith('/debt/new')
  );
}
