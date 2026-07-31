import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

const PUBLIC_PATHS = ["/login", "/cadastro"];

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

    // Callback OAuth precisa da sessão renovada, mas trata auth internamente
    if (isKommoOAuthCallback) {
      return supabaseResponse;
    }

    if (!isAuthenticated && !isPublic && !isAuthCallback && pathname !== "/") {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }

    if (isAuthenticated && (isPublic || pathname === "/")) {
      const url = request.nextUrl.clone();
      url.pathname = "/dashboard";
      return NextResponse.redirect(url);
    }

    return supabaseResponse;
  } catch {
    // Sem env de Supabase no build/dev — deixa a página tratar o erro.
    if (
      pathname.startsWith("/api/kommo/oauth/callback") ||
      PUBLIC_PATHS.includes(pathname) ||
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
