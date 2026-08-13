import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { safeInternalPath } from "@/lib/safe-redirect";

const PUBLIC_PATHS = [
  "/login",
  "/cadastro",
  "/recuperar-senha",
  "/redefinir-senha",
  "/convite",
];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/api/webhooks/") ||
    pathname.startsWith("/api/workers/")
  ) {
    return NextResponse.next();
  }

  try {
    const { supabaseResponse, claims } = await updateSession(request);
    const isAuthenticated = Boolean(claims?.sub);
    const isPublic = PUBLIC_PATHS.some(
      (path) => pathname === path || pathname.startsWith(`${path}/`),
    );
    const isAuthCallback = pathname.startsWith("/api/auth/callback");
    const isKommoOAuthCallback = pathname.startsWith("/api/kommo/oauth/callback");

    if (isKommoOAuthCallback) {
      return supabaseResponse;
    }

    if (!isAuthenticated && !isPublic && !isAuthCallback && pathname !== "/") {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", safeInternalPath(pathname, "/dashboard"));
      return NextResponse.redirect(url);
    }

    if (isAuthenticated && (pathname === "/login" || pathname === "/cadastro" || pathname === "/")) {
      const url = request.nextUrl.clone();
      url.pathname = "/dashboard";
      return NextResponse.redirect(url);
    }

    return supabaseResponse;
  } catch {
    if (
      pathname.startsWith("/api/kommo/oauth/callback") ||
      PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`)) ||
      pathname === "/"
    ) {
      return NextResponse.next();
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
