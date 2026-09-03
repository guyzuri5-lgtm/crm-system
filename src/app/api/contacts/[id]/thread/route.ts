import { NextResponse, type NextRequest } from "next/server";
import { requireTeamSession } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * השיחה של איש קשר אחד, לטעינה לפי דרישה כשנפתחת שורה ב"לקוחות פעילים".
 *
 * למה Route Handler ולא Server Action: התיעוד של Next 16 קובע שהדפדפן שולח
 * Server Actions אחת-אחת בטור, וששכל תשובה כזו גוררת איתה רינדור מחדש של כל
 * המסלול. פתיחת שורה היא קריאה, לא שינוי — בטור זה היה אומר שפתיחת שלוש
 * שורות ברצף ממתינה לשלוש תשובות, וכל אחת מהן מרנדרת מחדש רשימה של 200
 * שורות כדי להחזיר שיחה אחת. Route Handler רץ במקביל ומחזיר רק את מה שביקשו.
 *
 * פרטי איש הקשר עצמם *אינם* חוזרים מכאן בכוונה: הרשימה כבר טענה את שורות
 * ה-contacts המלאות כדי לצייר את השורות, ולכן הן כבר בדף.
 */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/contacts/[id]/thread">) {
  const session = await requireTeamSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;

  // התקרה קיימת כדי ששיחה בת שנתיים לא תפיל דפדפן. הסדר יורד כדי שהתקרה
  // תחתוך את הישן ולא את החדש; רכיב השיחה מסדר מחדש לפי סדר עולה.
  const { data, error } = await supabaseAdmin()
    .from("interactions")
    .select("id, type, content, created_at")
    .eq("contact_id", id)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ messages: data ?? [] });
}
