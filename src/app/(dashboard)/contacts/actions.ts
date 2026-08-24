"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyTeamMember } from "@/lib/dal";
import { defaultStatus, listStatuses, resolveStatus } from "@/lib/statuses";
import { parseContactsFile, phoneVariants, type ParsedContactRow } from "@/lib/contact-import";
import type { Contact, Database } from "@/lib/supabase/database.types";
import { updateContactStatus } from "@/lib/automation-engine";

// Manual contact creation — not driven by the ManyChat webhook. Lets the team add a
// lead by hand (phone lead, walk-in, referral, ...) and gives the dashboard something
// to show/test before ManyChat is wired up.
const createContactSchema = z.object({
  full_name: z.string().min(1, "חובה למלא שם"),
  phone: z.string().optional(),
  email: z.string().email("אימייל לא תקין").optional(),
  tags: z.string().optional(),
});

export async function createContactAction(formData: FormData) {
  await verifyTeamMember();

  const parsed = createContactSchema.safeParse({
    full_name: formData.get("full_name"),
    phone: formData.get("phone") || undefined,
    email: formData.get("email") || undefined,
    tags: formData.get("tags") || undefined,
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join(", "));
  }
  const { full_name, phone, email, tags } = parsed.data;

  // הסטטוסים הם נתונים מאז 0003_statuses.sql, אז הוולידציה היא מול ה-DB
  // ולא z.enum. סטטוס ריק → הטריגר ב-DB ממלא את הראשון בסדר התצוגה.
  const status = await resolveStatus(formData.get("status"));

  const { error } = await supabaseAdmin()
    .from("contacts")
    .insert({
      full_name,
      phone: phone || null,
      email: email || null,
      ...(status ? { status } : {}),
      source: "ידני",
      tags: tags
        ? tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        : [],
    });

  if (error) {
    throw new Error(
      error.code === "23505" ? "כבר קיים איש קשר עם הטלפון הזה" : error.message
    );
  }

  revalidatePath("/contacts");
}

export type SetStatusResult = { ok: true } | { ok: false; error: string };

/**
 * שינוי סטטוס ישירות מהשורה בטבלה (StatusPicker). עובר דרך
 * updateContactStatus בדיוק כמו הטופס בעמוד איש הקשר, כדי שכללי
 * status_change ייורו בשני המקרים.
 *
 * מחזיר שגיאה במקום לזרוק — נפילה כאן היא נפילה של שורה אחת בטבלה, ולא
 * סיבה להחליף את כל העמוד ב-error.tsx.
 */
export async function setContactStatusAction(
  contactId: string,
  statusName: string
): Promise<SetStatusResult> {
  await verifyTeamMember();

  const status = await resolveStatus(statusName);
  if (!contactId || !status) return { ok: false, error: "סטטוס לא תקין" };

  try {
    await updateContactStatus(contactId, status);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "עדכון הסטטוס נכשל" };
  }

  revalidatePath("/contacts");
  revalidatePath(`/contacts/${contactId}`);
  return { ok: true };
}

// ── ייבוא מקובץ ────────────────────────────────────────────────────────

export type ImportState =
  | null
  | { ok: false; error: string }
  | {
      ok: true;
      created: number;
      updated: number;
      skipped: number;
      issues: { rowNumber: number; reason: string }[];
      unknownStatuses: string[];
      defaultStatusName: string | null;
    };

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/**
 * ייבוא אנשי קשר מ-CSV/XLSX.
 *
 * החלטה מכוונת: ייבוא *לא* מפעיל כללי אוטומציה, גם כשהקובץ קובע סטטוס.
 * העלאה של רשימה בת 200 לידים דרך updateContactStatus הייתה מפעילה כלל
 * status_change על כל אחד מהם ושולחת מאות הודעות וואטסאפ/מייל בלחיצה אחת.
 * סטטוסים מהקובץ נכתבים ישירות ל-contacts.status.
 */
export async function importContactsAction(
  _prevState: ImportState,
  formData: FormData
): Promise<ImportState> {
  await verifyTeamMember();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "לא נבחר קובץ" };
  }
  if (file.size > MAX_IMPORT_BYTES) {
    return { ok: false, error: "הקובץ גדול מ-5MB" };
  }

  const statuses = await listStatuses();

  let parsed;
  try {
    parsed = parseContactsFile(
      file.name,
      Buffer.from(await file.arrayBuffer()),
      statuses.map((s) => s.name)
    );
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "קריאת הקובץ נכשלה" };
  }

  const issues = [...parsed.issues];
  const unknownStatuses = [
    ...new Set(parsed.rows.map((r) => r.unknownStatus).filter((s): s is string => !!s)),
  ];

  if (!parsed.rows.length) {
    return {
      ok: true,
      created: 0,
      updated: 0,
      skipped: issues.length,
      issues,
      unknownStatuses,
      defaultStatusName: await defaultStatus(),
    };
  }

  const db = supabaseAdmin();

  // שליפה אחת של כל ההתאמות הקיימות במקום שאילתה לכל שורה. הפיצול לקבוצות
  // הוא בגלל מגבלת אורך ה-URL של PostgREST ב-‎.in()‎.
  const existingByPhone = new Map<string, Contact>();
  const existingByEmail = new Map<string, Contact>();

  const phones = [
    ...new Set(
      parsed.rows.flatMap((r) => (r.phone ? phoneVariants(r.phone) : []))
    ),
  ];
  const emails = [...new Set(parsed.rows.map((r) => r.email).filter((e): e is string => !!e))];

  for (const chunk of chunked(phones, 200)) {
    const { data, error } = await db.from("contacts").select("*").in("phone", chunk);
    if (error) return { ok: false, error: error.message };
    // ממופתח תחת כל הצורות, כך שחיפוש לפי הצורה המנורמלת של הקובץ ימצא גם
    // רשומה שנשמרה ב-‎+972‎ על ידי ה-webhook של ManyChat.
    for (const contact of data ?? []) {
      if (!contact.phone) continue;
      for (const variant of phoneVariants(contact.phone)) existingByPhone.set(variant, contact);
      if (contact.phone.startsWith("+972")) {
        existingByPhone.set(`0${contact.phone.slice(4)}`, contact);
      }
    }
  }
  for (const chunk of chunked(emails, 200)) {
    const { data, error } = await db.from("contacts").select("*").in("email", chunk);
    if (error) return { ok: false, error: error.message };
    for (const contact of data ?? []) if (contact.email) existingByEmail.set(contact.email, contact);
  }

  type ContactInsert = Database["public"]["Tables"]["contacts"]["Insert"];
  const toInsert: { row: ParsedContactRow; values: ContactInsert }[] = [];
  let updated = 0;

  for (const row of parsed.rows) {
    const existing =
      (row.phone ? existingByPhone.get(row.phone) : undefined) ??
      (row.email ? existingByEmail.get(row.email) : undefined);

    if (existing) {
      // עדכון משלים, לא דורסני: רק שדות שהקובץ באמת מילא. תגיות מתאחדות
      // עם הקיימות כדי שייבוא חוזר לא ימחק תיוג שנעשה ידנית בדשבורד.
      const patch: Database["public"]["Tables"]["contacts"]["Update"] = {};
      if (row.full_name && row.full_name !== existing.full_name) patch.full_name = row.full_name;
      // רק אם אין טלפון בכלל — לא מחליפים ‎+972...‎ שמור ב-‎05...‎ ולהפך,
      // כי זה אותו מספר וההחלפה רק הייתה מנתקת אותו מ-ManyChat.
      if (row.phone && !existing.phone) patch.phone = row.phone;
      if (row.email && !existing.email) patch.email = row.email;
      if (row.notes && row.notes !== existing.notes) patch.notes = row.notes;
      if (row.status && row.status !== existing.status) patch.status = row.status;
      if (row.tags.length) {
        const merged = [...new Set([...existing.tags, ...row.tags])];
        if (merged.length !== existing.tags.length) patch.tags = merged;
      }

      if (Object.keys(patch).length === 0) {
        issues.push({ rowNumber: row.rowNumber, reason: "כבר קיים במערכת, אין מה לעדכן" });
        continue;
      }

      const { error } = await db.from("contacts").update(patch).eq("id", existing.id);
      if (error) {
        issues.push({ rowNumber: row.rowNumber, reason: error.message });
        continue;
      }
      updated += 1;
      continue;
    }

    toInsert.push({
      row,
      values: {
        full_name: row.full_name,
        phone: row.phone,
        email: row.email,
        ...(row.status ? { status: row.status } : {}),
        source: row.source || "ייבוא",
        tags: row.tags,
        notes: row.notes,
      },
    });
  }

  let created = 0;
  for (const chunk of chunked(toInsert, 200)) {
    const { error } = await db.from("contacts").insert(chunk.map((c) => c.values));
    if (!error) {
      created += chunk.length;
      continue;
    }
    // הכנסה קבוצתית היא הכל-או-כלום: שורה אחת פסולה (טלפון שנוצר בינתיים
    // על ידי webhook, למשל) מפילה את כל הקבוצה. במקרה כזה חוזרים שורה-שורה
    // כדי שרק היא תיפול, ומדווחים עליה למשתמש עם מספר השורה בקובץ.
    for (const item of chunk) {
      const { error: rowError } = await db.from("contacts").insert(item.values);
      if (rowError) {
        issues.push({
          rowNumber: item.row.rowNumber,
          reason: rowError.code === "23505" ? "כבר קיים איש קשר עם הטלפון הזה" : rowError.message,
        });
      } else {
        created += 1;
      }
    }
  }

  revalidatePath("/contacts");

  return {
    ok: true,
    created,
    updated,
    skipped: issues.length,
    issues: issues.sort((a, b) => a.rowNumber - b.rowNumber),
    unknownStatuses,
    defaultStatusName: await defaultStatus(),
  };
}

function chunked<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}
