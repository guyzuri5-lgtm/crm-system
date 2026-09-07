"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { verifyTeamMember } from "@/lib/dal";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { uploadPublicImage } from "@/lib/media";
import { listCourseAudience, selectRecipients } from "@/lib/course-broadcast";
import { toResult, type ActionResult } from "@/lib/action-result";
import type { CourseCustomField } from "@/lib/supabase/database.types";

// כל הפעולות של לשונית "קורסים". verifyTeamMember בראש כל אחת — Server Action
// הוא endpoint לכל דבר, וההגנה של proxy.ts על הנתיב אינה חלה עליו.

export type CourseResult = { ok: true; id?: string } | { ok: false; error: string };
export type UploadResult = { ok: true; url: string } | { ok: false; error: string };

const MIGRATION_HINT =
  "טבלאות הקורסים לא קיימות. יש להריץ את supabase/migrations/0028_courses.sql ואת 0029_activity_course.sql ב-SQL editor של Supabase.";

/** הודעה מובנת במקום הקוד הגולמי של PostgREST כשהמיגרציה לא רצה. */
function explain(error: { code?: string; message: string }): string {
  return ["42P01", "42703", "PGRST204", "PGRST205"].includes(error.code ?? "")
    ? MIGRATION_HINT
    : error.message;
}

const slugField = z
  .string()
  .trim()
  .min(1, "חובה למלא כתובת לקישור")
  .max(80)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "הכתובת יכולה להכיל אותיות אנגליות קטנות, ספרות ומקפים בלבד");

const optionalText = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .transform((value) => value || null);

// ── יצירה ──────────────────────────────────────────────────────────────────

const createSchema = z.object({
  name: z.string().trim().min(1, "חובה למלא שם לקורס").max(160),
  slug: slugField,
  grow_link: optionalText,
});

/**
 * יוצרת קורס עם שדות הבסיס בלבד, ומעבירה מיד לעורך העיצוב.
 *
 * הפיצול מכוון, בדיוק כמו באירועים: מי שיוצר קורס חושב קודם על *מה*, ורק
 * אחר כך על איך הדף ייראה. הטופס כאן קצר אף יותר — בלי תאריך, מקום וקיבולת
 * נשארו שלושה שדות בסך הכל.
 */
export async function createCourseAction(
  _state: CourseResult | null,
  formData: FormData
): Promise<CourseResult> {
  await verifyTeamMember();

  const parsed = createSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
    grow_link: formData.get("grow_link") ?? "",
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "הטופס אינו תקין" };
  }

  const { data, error } = await supabaseAdmin()
    .from("courses")
    .insert({
      name: parsed.data.name,
      slug: parsed.data.slug,
      grow_link: parsed.data.grow_link,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "הכתובת הזו כבר תפוסה על ידי קורס אחר" };
    }
    return { ok: false, error: explain(error) };
  }

  revalidatePath("/courses");
  // ה-redirect מחוץ לכל טיפול בשגיאה ואחרי הכתיבה — הוא זורק, וטיפול בו
  // כשגיאה היה מציג "משהו השתבש" על פעולה שהצליחה.
  redirect(`/courses/${data.id}/edit`);
}

// ── עורך העיצוב ────────────────────────────────────────────────────────────

const customFieldSchema = z.object({
  key: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1, "לשדה מותאם חסרה תווית").max(120),
  type: z.enum(["text", "select"]),
  options: z.array(z.string().trim().min(1).max(120)).max(30),
});

const designSchema = z.object({
  // דף ההרשמה
  name: z.string().trim().min(1, "חובה למלא שם לקורס").max(160),
  subtitle: optionalText,
  form_description: optionalText,
  button_text: z.string().trim().min(1, "לכפתור חייב להיות טקסט").max(80),
  header_image_url: z.union([z.string().url(), z.literal("")]).transform((v) => v || null),
  // דף התודה — בלי מתג יומן, אין תאריך להוסיף
  thankyou_title: z.string().trim().min(1, "לעמוד התודה חייבת להיות כותרת").max(160),
  thankyou_text: optionalText,
  thankyou_show_image: z.boolean(),
  // שדות הטופס ושדות הבסיס
  custom_fields: z.array(customFieldSchema).max(20),
  grow_link: optionalText,
  legacy_webhook: z.boolean(),
});

export type CourseDesignInput = z.input<typeof designSchema>;

/** שמירה אחת לכל שלוש הלשוניות — כפתור "שמור" יחיד, ולא שמירה לכל שדה. */
export async function saveCourseDesignAction(
  id: string,
  input: CourseDesignInput
): Promise<CourseResult> {
  await verifyTeamMember();

  const parsed = designSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "הטופס אינו תקין" };
  }

  const d = parsed.data;
  const db = supabaseAdmin();

  // ── הדגל של דף הנחיתה הישן ──
  //
  // במסד יש אינדקס ייחודי שמתיר קורס מסומן אחד בלבד. בלי הניקוי הזה, סימון
  // קורס שני היה נדחה עם שגיאת 23505 — נכון מבחינת שלמות הנתונים, ובלתי
  // מובן לחלוטין למי שרק הזיז מתג. ההעברה שקטה ומכוונת: המתג נקרא "הקורס
  // שאליו מגיעים לידים מהדף הישן", ויש רק אחד כזה מעצם הגדרתו.
  if (d.legacy_webhook) {
    const { error: clearError } = await db
      .from("courses")
      .update({ legacy_webhook: false })
      .eq("legacy_webhook", true)
      .neq("id", id);
    if (clearError) return { ok: false, error: explain(clearError) };
  }

  const { error } = await db
    .from("courses")
    .update({
      name: d.name,
      subtitle: d.subtitle,
      form_description: d.form_description,
      button_text: d.button_text,
      header_image_url: d.header_image_url,
      thankyou_title: d.thankyou_title,
      thankyou_text: d.thankyou_text,
      thankyou_show_image: d.thankyou_show_image,
      custom_fields: d.custom_fields as CourseCustomField[],
      grow_link: d.grow_link,
      legacy_webhook: d.legacy_webhook,
    })
    .eq("id", id);

  if (error) return { ok: false, error: explain(error) };

  revalidatePath("/courses");
  revalidatePath(`/courses/${id}`);
  return { ok: true };
}

export async function uploadCourseImageAction(formData: FormData): Promise<UploadResult> {
  await verifyTeamMember();

  const file = formData.get("image");
  if (!(file instanceof File)) return { ok: false, error: "לא נבחר קובץ" };

  try {
    return { ok: true, url: await uploadPublicImage(file, "courses") };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── מסך הניהול ─────────────────────────────────────────────────────────────

/**
 * סימון ידני כשילם — הגיבוי לגרואו.
 *
 * כל עוד אין webhook מגרואו (שלב 6), זו הדרך היחידה לסגור את המעגל: בעל
 * העסק רואה תשלום בגרואו ומסמן כאן. paid_at נכתב רק בפעם הראשונה, כי
 * ה-neq מסנן החוצה מי שכבר מסומן — סימון חוזר לא דוחף את התאריך קדימה.
 */
export async function markCoursePaidAction(formData: FormData): Promise<ActionResult> {
  return toResult(async () => {
    await verifyTeamMember();

    const registrationId = String(formData.get("registration_id") ?? "");
    const courseId = String(formData.get("course_id") ?? "");
    if (!registrationId) throw new Error("לא נמצאה ההרשמה לסימון");

    const { error } = await supabaseAdmin()
      .from("course_registrations")
      .update({ stage: "paid", paid_at: new Date().toISOString() })
      .eq("id", registrationId)
      .neq("stage", "paid");
    if (error) throw new Error(explain(error));

    if (courseId) revalidatePath(`/courses/${courseId}`);
    revalidatePath("/courses");
    revalidatePath("/");
  });
}

/** כיבוי והדלקה של הקורס — דף כבוי מחזיר 404 לציבור. */
export async function toggleCourseActiveAction(formData: FormData): Promise<ActionResult> {
  return toResult(async () => {
    await verifyTeamMember();

    const id = String(formData.get("id") ?? "");
    const active = formData.get("active") === "true";
    if (!id) throw new Error("לא נמצא הקורס");

    const { error } = await supabaseAdmin().from("courses").update({ active }).eq("id", id);
    if (error) throw new Error(explain(error));

    revalidatePath("/courses");
    revalidatePath(`/courses/${id}`);
  });
}

// ── שליחה לנרשמים ──────────────────────────────────────────────────────────

export type CourseBroadcastResult =
  | { ok: true; count: number }
  | { ok: false; error: string };

const broadcastSchema = z
  .object({
    course_id: z.string().uuid(),
    channel: z.enum(["whatsapp", "email"]),
    stages: z
      .array(z.enum(["interested", "registered", "paid"]))
      .min(1, "צריך לבחור לפחות קבוצה אחת של נמענים"),
    subject: z.string().trim().max(200).optional(),
    body: z.string().trim().max(5000).optional(),
    template_id: z.string().uuid().optional(),
  })
  // שני מודלי התוכן, באותה הפרדה שה-check constraint אוכף במסד. הוולידציה
  // כאן קיימת בשבילו הניסוח: שגיאת check גולמית מפוסטגרס לא אומרת למי
  // שנתקל בה מה חסר.
  .superRefine((value, ctx) => {
    if (value.channel === "email") {
      if (!value.subject) ctx.addIssue({ code: "custom", message: "חסרה כותרת למייל" });
      if (!value.body) ctx.addIssue({ code: "custom", message: "המייל ריק" });
    } else if (!value.template_id) {
      ctx.addIssue({ code: "custom", message: "צריך לבחור תבנית מאושרת לוואטסאפ" });
    }
  });

/**
 * יוצרת את השליחה ואת רשימת הנמענים, ומשאירה לקרון להוציא אותה.
 *
 * ── למה לא שולחת כאן ובמקום ──
 * אותו נימוק כמו בניוזלטר: מאה שליחות לא נכנסות בטיימאאוט של Server Action
 * אחד, ושליחה שנקטעת באמצע בלי שורות נמענים היא שליחה שאי אפשר להמשיך.
 * מה שכן קורה כאן מיידית הוא ההחלטה *מי* מקבל — כך שהמספר שגיא רואה
 * ברגע הלחיצה הוא המספר האמיתי, ורשימה ריקה נתפסת מולו ולא בשקט בקרון.
 */
export async function sendCourseBroadcastAction(
  _state: CourseBroadcastResult | null,
  formData: FormData
): Promise<CourseBroadcastResult> {
  await verifyTeamMember();

  const parsed = broadcastSchema.safeParse({
    course_id: formData.get("course_id"),
    channel: formData.get("channel"),
    stages: formData.getAll("stages").map(String),
    subject: String(formData.get("subject") ?? ""),
    body: String(formData.get("body") ?? ""),
    template_id: String(formData.get("template_id") ?? "") || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "הטופס אינו תקין" };
  }

  const { course_id, channel, stages } = parsed.data;
  const db = supabaseAdmin();

  // ── התבנית ──
  // נבדקת מול המסד ולא רק מול הטופס: ה-select מציע רק מאושרות, אבל תבנית
  // יכולה לאבד את אישורה בין טעינת המסך ללחיצה, ו-Server Action הוא
  // endpoint פתוח שאפשר לקרוא לו גם בלי המסך.
  if (channel === "whatsapp") {
    const { data: template, error } = await db
      .from("message_templates")
      .select("channel, meta_template_name, meta_status")
      .eq("id", parsed.data.template_id!)
      .maybeSingle();
    if (error) return { ok: false, error: explain(error) };
    if (!template) return { ok: false, error: "התבנית שנבחרה לא נמצאה" };
    if (template.channel !== "whatsapp") {
      return { ok: false, error: "התבנית שנבחרה אינה תבנית וואטסאפ" };
    }
    if (!template.meta_template_name || template.meta_status !== "APPROVED") {
      return {
        ok: false,
        error:
          "התבנית אינה מאושרת ב-Meta. מחוץ לחלון 24 השעות אפשר לשלוח רק תבנית מאושרת, ולכן השליחה לא נוצרה.",
      };
    }
  }

  // ── הנמענים ──
  let contactIds: string[];
  try {
    const audience = await listCourseAudience(course_id);
    contactIds = selectRecipients(audience, stages, channel);
  } catch (err) {
    return { ok: false, error: explain(err as { code?: string; message: string }) };
  }

  if (!contactIds.length) {
    return {
      ok: false,
      error:
        channel === "email"
          ? "אין אף נמען עם כתובת מייל בקבוצות שנבחרו (מי שהוסר מרשימת התפוצה אינו נספר)"
          : "אין אף נמען עם מספר טלפון תקין בקבוצות שנבחרו",
    };
  }

  const { data: broadcast, error: insertError } = await db
    .from("course_broadcasts")
    .insert({
      course_id,
      channel,
      stages,
      subject: channel === "email" ? parsed.data.subject! : null,
      body: channel === "email" ? parsed.data.body! : null,
      template_id: channel === "whatsapp" ? parsed.data.template_id! : null,
    })
    .select("id")
    .single();

  if (insertError) {
    if (["42P01", "PGRST205"].includes(insertError.code ?? "")) {
      return {
        ok: false,
        error:
          "טבלאות השליחה לא קיימות. יש להריץ את supabase/migrations/0032_course_broadcasts.sql ב-SQL editor של Supabase.",
      };
    }
    return { ok: false, error: insertError.message };
  }

  const { error: recipientsError } = await db
    .from("course_broadcast_recipients")
    .insert(contactIds.map((contactId) => ({ broadcast_id: broadcast.id, contact_id: contactId })));

  if (recipientsError) {
    // שליחה בלי נמענים היא שורה שתישאר "יוצאת עכשיו" לנצח ולא תוציא דבר.
    // עדיף למחוק אותה ולהחזיר שגיאה מאשר להשאיר רוח רפאים במסך.
    await db.from("course_broadcasts").delete().eq("id", broadcast.id);
    return { ok: false, error: recipientsError.message };
  }

  revalidatePath(`/courses/${course_id}`);
  revalidatePath(`/courses/${course_id}/broadcast`);
  return { ok: true, count: contactIds.length };
}
