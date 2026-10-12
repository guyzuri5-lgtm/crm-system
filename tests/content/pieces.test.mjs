// node --test tests/content
import { test } from "node:test";
import assert from "node:assert/strict";
import * as P from "../../src/lib/content/pure/pieces.ts";

const rainbow = "ידעתם שבגוף שלכם יש קשת בענן? תעבירו אור לבן דרך מנסרה ותקבלו שבעה צבעים. לכל צבע יש תדר משלו. אדום הוא האיטי ביותר, סגול המהיר ביותר. ועכשיו תסתכלו על הגוף: שבעה מרכזים אנרגטיים, מאדום בבסיס עמוד השדרה ועד סגול בקודקוד.";
const wheel = "למה אחרי מפגש עם אנשים מסוימים אתם פשוט סחוטים? צ'אקרה בסנסקריט זה גלגל. מערבולת שמסתובבת בתוך הגוף, וכמו כל מערבולת היא מושכת פנימה את הרגשות של האנשים שאתם פוגשים.";
const crystal = "חשבתם שקריסטלים הם רק לרוחניקים? בתוך הטלפון שאתם מחזיקים יש קריסטל קוורץ. כשמחשמלים אותו הוא רוטט בקצב קבוע, ובזכות זה המכשיר יודע מה השעה.";

test("improvised read still matches the right piece", () => {
  const spoken = "תגידו, ידעתם שיש לכם קשת בענן בתוך הגוף? כשמעבירים אור לבן במנסרה מקבלים שבעה צבעים, ולכל צבע תדר אחר. האדום הכי איטי והסגול הכי מהיר. ועכשיו הגוף, שבעה מרכזי אנרגיה מהאדום בבסיס של עמוד השדרה עד הסגול בקודקוד.";
  const r = P.rankCandidates(spoken, [
    { pieceNo: 13, title: "קשת", script: rainbow },
    { pieceNo: 14, title: "גלגל", script: wheel },
    { pieceNo: 15, title: "קריסטל", script: crystal },
  ]);
  assert.equal(r.best.pieceNo, 13);
  assert.equal(r.confident, true);
});

test("unrelated video is not confident", () => {
  const r = P.rankCandidates("היום אני רוצה לדבר על מדיטציה בבוקר ועל קפה", [
    { pieceNo: 13, title: "קשת", script: rainbow },
    { pieceNo: 14, title: "גלגל", script: wheel },
  ]);
  assert.equal(r.confident, false);
});

test("pieces without script are skipped", () => {
  const r = P.rankCandidates(rainbow, [{ pieceNo: 1, title: "x", script: null }]);
  assert.equal(r.best, null);
  assert.equal(r.confident, false);
});

test("script is what follows the heading", () => {
  const doc = "# כותרת\nקישור\n## הרעיון מהמקור\nסיכום\n## גרסה בשפה שלי (כ-30 שניות)\nשורה אחת\nשורה שתיים\n";
  assert.equal(P.extractScript(doc), "שורה אחת\nשורה שתיים");
  assert.equal(P.extractScript("רק טקסט"), "רק טקסט");
});

test("names and numbers", () => {
  assert.equal(P.titleFromDocName("רפרנס | Spirit Science | הגוף שלכם הוא קשת"), "הגוף שלכם הוא קשת");
  assert.equal(P.titleFromDocName("13- הגוף שלכם הוא קשת"), "הגוף שלכם הוא קשת");
  assert.equal(P.parsePieceNo("dir:9- יצירתיות היא אנרגיה"), 9);
  assert.equal(P.parsePieceNo("13- כותרת"), 13);
  assert.equal(P.parsePieceNo("dir:שמש"), null);
  assert.equal(P.pieceName(13, 'מה/זה: "בדיקה"'), "13- מה זה בדיקה");
  assert.equal(P.normPermalink("https://www.instagram.com/reel/DR4MEZUDbXW/?igsh=1"), "DR4MEZUDbXW");
  assert.equal(P.normPermalink("https://www.instagram.com/guy/p/ABC_1/"), "ABC_1");
});

test("isDuplicateScript: copy vs different script", async () => {
  const { isDuplicateScript } = P;
  const a = "הצבע הירוק של צ'אקרת הלב מחבר את האנרגיה של היצירתיות עם הנשימה העמוקה שעולה מהבטן ומשחררת את הגוף מכל התקיעות";
  const b = a + " ועכשיו";
  const c = "המצרים שמרו בחניטה את הלב וזרקו את המוח כי ידעו שהלב חושב ושולח מידע למוח יותר ממה שהמוח שולח ללב";
  assert.equal(isDuplicateScript(a, b), true);
  assert.equal(isDuplicateScript(a, c), false);
});
