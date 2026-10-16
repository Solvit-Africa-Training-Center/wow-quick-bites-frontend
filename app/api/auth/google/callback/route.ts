import { NextResponse, type NextRequest } from "next/server";
import { isLocale, type Locale } from "@/i18n/config";
import { saveGoogleProfile, takeGoogleState } from "@/lib/auth/flows";
import { fetchGoogleProfile, googleConfig } from "@/lib/auth/google";
import { API_BASE_URL, ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from "@/lib/api/config";
import type { Role } from "@/lib/auth/roles";
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/auth/token";
import { localePath, routes } from "@/lib/routes";

// Google redirects here after consent. The account is matched (or created) by its verified
// email, the session starts, then /finish-sign-in mirrors the profile for the storefront.

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const saved = await takeGoogleState();
  const lang: Locale = saved && isLocale(saved.lang) ? saved.lang : "en";
  const fail = (error = "google") =>
    NextResponse.redirect(new URL(`${localePath(lang, routes.signIn)}?error=${error}`, request.url));

  if (!saved || !params.get("state") || params.get("state") !== saved.state) return fail();

  const code = params.get("code");
  if (!code) return fail();
  if (!googleConfig()) return fail("google-config");
  if (!process.env.BACKEND_FRONTEND_SECRET) return fail("backend-config");
  const profile = await fetchGoogleProfile(request, code, saved.verifier);
  if (!profile) return fail();

  let data: {
    access: string;
    refresh: string;
    user: {
      id: string;
      role: Role;
      name: string;
      email: string;
      phone?: string | null;
      clientCode?: string | null;
    };
  };
  try {
    const res = await fetch(`${API_BASE_URL}/auth/google/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Frontend-Secret": process.env.BACKEND_FRONTEND_SECRET,
      },
      body: JSON.stringify({ email: profile.email, name: profile.name }),
      cache: "no-store",
    });
    if (!res.ok) {
      const errorBody = (await res.json().catch(() => null)) as
        | { error?: { code?: unknown }; code?: unknown }
        | null;
      const candidateCode = errorBody?.error?.code ?? errorBody?.code;
      const code =
        typeof candidateCode === "string" && /^[a-z0-9_-]{1,80}$/i.test(candidateCode)
          ? candidateCode
          : "not_provided";
      console.error("Google sign-in backend rejected the server request.", { status: res.status, code });
      return fail();
    }
    data = await res.json();
  } catch (error) {
    console.error("Google sign-in backend request failed.", error);
    return fail();
  }

  const response = NextResponse.redirect(new URL(localePath(lang, routes.finishSignIn), request.url));
  response.cookies.set(
    SESSION_COOKIE,
    await signSession({ sub: data.user.id, role: data.user.role, name: data.user.name }),
    sessionCookieOptions,
  );
  response.cookies.set(ACCESS_TOKEN_COOKIE, data.access, {
    ...sessionCookieOptions,
    httpOnly: false,
  });
  response.cookies.set(REFRESH_TOKEN_COOKIE, data.refresh, sessionCookieOptions);
  await saveGoogleProfile({
    name: data.user.name,
    email: data.user.email,
    phone: data.user.phone || undefined,
    clientCode: data.user.clientCode ?? "",
    lang,
    next: saved.next,
  });
  return response;
}
