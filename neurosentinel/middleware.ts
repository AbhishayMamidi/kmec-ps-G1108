import { NextResponse, type NextRequest } from 'next/server'

/**
 * Middleware: pure cookie-check, zero network calls.
 *
 * @supabase/ssr's getSession() can silently trigger a token-refresh HTTP
 * request when the JWT is near expiry — that round-trip exceeds Vercel Edge's
 * ~1 s budget and causes MIDDLEWARE_INVOCATION_TIMEOUT.
 *
 * Fix: read the raw Supabase auth cookie directly. It is set by the browser
 * on every request, so checking its presence tells us "logged in or not"
 * without any network I/O. Real token verification still happens in every
 * API route and Server Component via createServerClient + getUser().
 */

function isLoggedIn(request: NextRequest): boolean {
  // Supabase auth cookies are always named sb-<project-ref>-auth-token
  // or sb-<project-ref>-auth-token.0 (chunked). Scan all cookies so we
  // don't need to hardcode or derive the project ref at runtime.
  return request.cookies.getAll().some(
    ({ name }) =>
      name.startsWith('sb-') &&
      (name.endsWith('-auth-token') || name.includes('-auth-token.'))
  )
}

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  // Only guard protected routes — if there's no auth cookie at all,
  // send the user to the landing page.
  // We do NOT redirect logged-in users away from '/' here because
  // the cookie may be expired: the cookie exists but the session is dead.
  // That would create an infinite loop (/ → /dashboard → / → ...).
  // Let the individual pages handle "already logged in" redirects instead.
  const isProtectedPage =
    pathname.startsWith('/dashboard') ||
    pathname === '/onboarding' ||
    pathname.startsWith('/report/')

  if (isProtectedPage && !isLoggedIn(request)) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  return NextResponse.next({ request })
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
