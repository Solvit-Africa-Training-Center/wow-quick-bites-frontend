import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { routes } from "@/lib/routes";

/** Centred card shared by the auth pages (sign in, create account, verify, complete profile). */
export function AuthShell({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className="px-4 pb-40 pt-18">
      <div className={`mx-auto w-full max-w-[29.25rem] rounded-3xl bg-card p-7 light:border light:border-border sm:p-9 ${className ?? ""}`}>
        {children}
      </div>
    </div>
  );
}

/** Sign in / Create account: title, subtitle, Google button, "or", then the form. */
export default function AuthCard({
  title,
  subtitle,
  dict,
  lang,
  next,
  googleConfigError = false,
  backendConfigError = false,
  children,
}: {
  title: string;
  subtitle: string;
  dict: Dictionary["account"];
  lang: Locale;
  /** Page to return to after signing in (?next=) */
  next: string;
  googleConfigError?: boolean;
  backendConfigError?: boolean;
  children: React.ReactNode;
}) {
  // Full page navigation: the Route Handler redirects to Google's consent screen
  const google = `${routes.googleSignIn}?${new URLSearchParams({ lang, ...(next && { next }) })}`;

  return (
    <AuthShell>
      <h1 className="text-3xl">{title}</h1>
      <p className="mt-3 text-sm text-muted-foreground">{subtitle}</p>

      <a
        href={google}
        className="mt-6 flex h-11 w-full items-center justify-center gap-3 rounded-full bg-background text-sm font-semibold transition hover:brightness-125 light:border light:border-border light:bg-input"
      >
        <svg aria-hidden="true" className="h-5 w-5 shrink-0" viewBox="0 0 24 24" focusable="false">
          <path
            fill="#4285F4"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.22 3.31v2.77h3.59c2.1-1.93 3.27-4.77 3.27-8.09z"
          />
          <path
            fill="#34A853"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.59-2.77c-.98.66-2.23 1.06-3.69 1.06-2.84 0-5.25-1.91-6.11-4.48H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          />
          <path
            fill="#FBBC05"
            d="M5.89 14.15a6.9 6.9 0 0 1 0-4.3V7.01H2.18a11 11 0 0 0 0 9.98l3.71-2.84z"
          />
          <path
            fill="#EA4335"
            d="M12 4.52c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 1.14 14.97 0 12 0 7.7 0 3.99 2.47 2.18 7.01l3.71 2.84C6.75 6.43 9.16 4.52 12 4.52z"
          />
        </svg>
        {dict.google}
      </a>
      {googleConfigError && (
        <p role="alert" className="mt-3 text-center text-sm text-critical">{dict.googleConfigError}</p>
      )}
      {backendConfigError && (
        <p role="alert" className="mt-3 text-center text-sm text-critical">{dict.googleBackendConfigError}</p>
      )}
      <p className="my-5 text-center text-xs text-muted-foreground">{dict.or}</p>

      {children}
    </AuthShell>
  );
}
