import type { Contact } from "./supabase/database.types";

// Renders {{full_name}}-style placeholders in a message_templates.body/subject, per
// spec section 3. Deliberately an allow-list of contact fields rather than a generic
// property-access template engine, so a template can never accidentally interpolate
// something it shouldn't.
const TEMPLATE_FIELDS: Record<string, (contact: Contact) => string> = {
  full_name: (c) => c.full_name ?? "",
  first_name: (c) => (c.full_name ?? "").trim().split(/\s+/)[0] ?? "",
  phone: (c) => c.phone ?? "",
  email: (c) => c.email ?? "",
  status: (c) => c.status,
};

export function renderTemplate(text: string, contact: Contact): string {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, key: string) => {
    const resolver = TEMPLATE_FIELDS[key];
    return resolver ? resolver(contact) : match;
  });
}
