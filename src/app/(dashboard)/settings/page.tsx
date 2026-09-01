import { redirect } from "next/navigation";

/**
 * /settings אינו דף בפני עצמו — הוא שולח ללשונית הראשונה.
 *
 * העדפתי הפניה על פני דף פתיחה עם שלושה כרטיסים: כל לשונית היא ממילא מסך
 * שלם, ומסך ביניים שכל תפקידו לבחור אחת משלוש היה עוד קליק בלי תוכן.
 */
export default function SettingsIndex() {
  redirect("/settings/statuses");
}
