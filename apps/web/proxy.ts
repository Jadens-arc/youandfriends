import { NextResponse, type NextRequest } from 'next/server';

import { isShowcaseEnabled, SHOWCASE_PATH } from '@/lib/showcase';

/**
 * Proxy (`middleware` before Next 16 renamed it).
 *
 * Its only job today is the second lock on the component showcase. The first is that the
 * showcase's page file is not built at all in production; this catches the case where
 * someone renames the file back to `page.tsx` and quietly restores the route.
 *
 * The matcher is the showcase path alone, so no other request pays for this.
 */
export function proxy(request: NextRequest): NextResponse {
  if (request.nextUrl.pathname.startsWith(SHOWCASE_PATH) && !isShowcaseEnabled()) {
    // 404, not 403: a forbidden response confirms the path exists (`docs/THREAT_MODEL.md`
    // T1). Here it also happens to be true — in production the route really is absent.
    return new NextResponse(null, { status: 404 });
  }

  return NextResponse.next();
}

export const config = {
  // Both entries: `:path*` alone does not cover the bare segment.
  matcher: ['/_showcase', '/_showcase/:path*'],
};
