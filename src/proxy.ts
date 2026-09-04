import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Next.js 16 renamed "middleware" to "proxy" — same mechanism, new file/export name.
// See node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md.

// /book/* הוא דף ההזמנה הציבורי: לקוח מקבל קישור ונכנס בלי חשבון ובלי סשן.
// בלי הרישום כאן הוא היה נתפס בבדיקה שלמטה ומופנה ל-/login, וזו הייתה נראית
// כמו מערכת שבורה מצד הלקוח. הדף עצמו קורא ל-DB דרך השרת בלבד (service role)
// ואינו חושף דבר מלבד שעות פנויות.
//
// /event/* הוא אותו סיפור בדיוק לדפי ההרשמה לאירועים (0024): הקישור נשלח
// לקהל, ועמוד התודה שבתוכו הוא גם כתובת ההפניה של גרואו אחרי תשלום — כלומר
// כניסה מדומיין אחר, בלי שום סשן. /course/* (0028) זהה לו.
//
// שימו לב לצורת ההתאמה למטה: היא "שווה בדיוק, או מתחיל ב-path + לוכסן", ולכן
// /event אינו פותח את /events שבדשבורד — וכך גם /course מול /courses. התאמת
// תחילית פשוטה הייתה חושפת כאן שני מסכי ניהול שלמים לכל מי שיבקש.
const PUBLIC_PATHS = ["/login", "/book", "/event", "/course", "/oauth2callback"];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Calling getClaims() (rather than just checking whether a cookie exists) is what
  // actually refreshes an about-to-expire session and writes the new one back via
  // setAll above. Skipping this is the most common cause of "random logout" bugs
  // with @supabase/ssr — see that package's own README.
  const { data } = await supabase.auth.getClaims();
  const isAuthed = Boolean(data?.claims);

  const { pathname } = request.nextUrl;
  const isPublicPath = PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  );

  if (!isAuthed && !isPublicPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (isAuthed && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // Runs on every page route, but not on /api/* (each API route owns its own auth —
  // Supabase session for dashboard-facing endpoints, bearer tokens for the
  // Green API webhook and the Vercel Cron callback) or static assets.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
