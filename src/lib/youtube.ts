/**
 * מזהה הסרטון מכל פורמט מקובל של קישור יוטיוב — watch?v=, youtu.be/,
 * /embed/, /shorts/, /live/ — או המזהה עצמו אם הודבק לבדו.
 *
 * מודול נפרד ובלי "server-only" כי העורך מריץ אותו בדפדפן: הדבקת קישור
 * מציגה מיד את תמונת הסרטון, ואי אפשר לחכות לשמירה כדי לדעת אם הוא נקלט.
 */
export function youtubeIdFrom(input: string): string | null {
  const value = input.trim();
  if (!value) return null;

  if (/^[\w-]{11}$/.test(value)) return value;

  const match =
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([\w-]{11})/.exec(
      value
    );
  return match ? match[1] : null;
}
