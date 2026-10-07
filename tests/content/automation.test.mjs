import { test } from "node:test";
import assert from "node:assert/strict";
import * as A from "../../src/lib/content/pure/automation.ts";

const ACCT = { id: "acc1", profileId: "prof1", username: "guy" };
const auto = (kw = {}) => ({
  id: "1234567890ab", name: "מדריך נשימה", trigger_mode: "keyword", keyword: "מדריךמלא", match_mode: "word",
  gate_enabled: false, verify_text: "", verify_button: "", gate_text: "",
  dm1_text: "הנה זה 🙌", button_title: "קח את המדריך",
  email_enabled: false, email_ask_text: "", email_invalid_text: "", email_thanks_text: "",
  link_enabled: true, link: "https://example.com", link_text: "יאללה", link_card_title: "המדריך", link_button_title: "לקבלת המדריך",
  closing_text: "שאלות? כתבו לי", comment_reply: "", ...kw });
const v = (a, topics = [], others = []) => A.validateAutomation(a, topics, others);

test("clean automation passes", () => assert.deepEqual(v(auto()).errors, []));
test("short contains blocked", () => {
  assert.ok(v(auto({ keyword: "לינק", match_mode: "contains" })).errors.some((e) => e.includes("קצרה מדי")));
  assert.deepEqual(v(auto({ keyword: "לינקים", match_mode: "contains" })).errors, []);
});
test("topic word with hebrew prefix warns with two alternatives", () => {
  const r = v(auto({ keyword: "הומור" }), ["הכל בהומור :)"]);
  assert.ok(r.warnings.length);
  assert.equal(r.alternatives.length, 2);
  assert.equal(v(auto({ keyword: "מור" }), ["הכל בהומור"]).warnings.length, 0);
});
test("any comment: no keyword needed, loud warning", () => {
  const r = v(auto({ trigger_mode: "any", keyword: "" }));
  assert.deepEqual(r.errors, []);
  assert.ok(r.warnings[0].includes("כל תגובה"));
  assert.deepEqual(A.commentAutomationBody(auto({ trigger_mode: "any", keyword: "x" }), ACCT, "it").keywords, []);
});
test("button utf16 limit", () => {
  assert.equal(A.utf16Len("🙌"), 2);
  assert.ok(v(auto({ button_title: "👈 קח את המדריך המלא 👉" })).errors.some((e) => e.includes("20")));
});
test("gate needs its texts; verify button must not resemble the main button", () => {
  assert.ok(v(auto({ gate_enabled: true })).errors.some((e) => e.includes("האימות")));
  assert.ok(v(auto({ gate_enabled: true, verify_text: "x", gate_text: "y", verify_button: "קח את המדריך עכשיו" })).errors.some((e) => e.includes("דומים")));
});
test("email or link must be on; email texts required", () => {
  assert.ok(v(auto({ link_enabled: false })).errors.some((e) => e.includes("לפחות אחד")));
  assert.ok(v(auto({ email_enabled: true })).errors.some((e) => e.includes("המייל")));
});
test("button collision blocks, keyword reuse only warns", () => {
  const r = v(auto(), [], [{ label: "אוטומציה אחרת", keywords: ["מדריךמלא"], buttons: ["קח את"] }]);
  assert.ok(r.errors.some((e) => e.includes("מתנגש")));
  assert.ok(r.warnings.some((e) => e.includes("פוסטים שונים")));
});
test("graph: email then link", () => {
  const g = A.buildGraph(auto({ email_enabled: true, email_ask_text: "מייל?", email_invalid_text: "לא תקין", email_thanks_text: "תודה" }), ACCT);
  const ids = g.nodes.map((n) => n.id);
  for (const id of ["t1", "w_ask", "wait_e1", "c_e1", "w_retry", "wait_e2", "c_e2", "w_thanks", "w_link", "end_ok", "end_out"]) assert.ok(ids.includes(id), id);
  const has = (s, t, h) => g.edges.some((e) => e.source === s && e.target === t && (h ? e.sourceHandle === h : true));
  assert.ok(has("t1", "w_ask") && has("c_e1", "w_thanks", "valid") && has("c_e1", "w_retry", "default") && has("w_thanks", "w_link", "success"));
  assert.equal(g.nodes.find((n) => n.id === "t1").config.keywords[0], "קח את המדריך");
  const cond = g.nodes.find((n) => n.id === "c_e1").config.rules[0];
  assert.equal(cond.operator, "matches");
  assert.ok(new RegExp(cond.value).test("a@b.co") && !new RegExp(cond.value).test("לא מייל"));
});
test("graph: link only, bodyTemplate is a JSON string with the card", () => {
  const g = A.buildGraph(auto(), ACCT);
  assert.deepEqual(g.nodes.map((n) => n.id).sort(), ["end_ok", "end_out", "t1", "w_link"]);
  const link = g.nodes.find((n) => n.id === "w_link");
  assert.equal(typeof link.config.bodyTemplate, "string");
  const body = JSON.parse(link.config.bodyTemplate);
  assert.equal(body.template.elements[0].buttons[0].url, "https://example.com");
  assert.equal(body.message, "יאללה\nשאלות? כתבו לי");
});
test("graph: email only ends after thanks", () => {
  const g = A.buildGraph(auto({ link_enabled: false, email_enabled: true, email_ask_text: "a", email_invalid_text: "b", email_thanks_text: "c" }), ACCT);
  assert.ok(g.edges.some((e) => e.source === "w_thanks" && e.target === "end_ok"));
  assert.ok(!g.nodes.some((n) => n.id === "w_link"));
});
test("key is only a placeholder until send, and only in the header", () => {
  const a = auto({ link_text: `x ${A.KEY_PLACEHOLDER}` });
  const wf = A.workflowBody(a, ACCT);
  assert.ok(!JSON.stringify(wf).includes("sk_fake"));
  const sent = A.injectKey(wf, "sk_fake");
  const n = sent.nodes.find((x) => x.id === "w_link");
  assert.equal(n.config.headers.Authorization, "Bearer sk_fake");
  assert.ok(!n.config.bodyTemplate.includes("sk_fake"));
  assert.ok(v(a).errors.some((e) => e.includes("מחרוזת שמורה")));
});
test("comment automation body: native verified follow gate, tracking off", () => {
  const b = A.commentAutomationBody(auto({ gate_enabled: true, verify_text: "לחץ", verify_button: "שלח לי", gate_text: "עקוב" }), ACCT, "item-1", "1789");
  assert.equal(b.linkTracking, false);
  assert.equal(b.platformPostId, "1789");
  assert.deepEqual(b.audience, { followerStatus: "follower", whenUnknown: "verify" });
  assert.deepEqual(b.followGate, { message: "לחץ", buttonLabel: "שלח לי", notFollowingMessage: "עקוב" });
  assert.equal(b.buttons[0].type, "postback");
  const p = A.commentAutomationPatch(auto());
  assert.deepEqual(p.audience, { followerStatus: "any", whenUnknown: "send" });
});
test("stats read variables and dedupe executions; emails extracted", () => {
  const ex = [
    { id: "1", variables: { email_reply: "  Guy@Example.com ", sent_w_link: { ok: true, status: 200 } } },
    { id: "1", variables: { email_reply: "dup@x.com" } },
    { id: "2", variables: { email_reply: "לא", email_reply2: "a@b.io" , sent_w_link: { ok: false } } },
    { id: "3", variables: {} },
  ];
  assert.deepEqual(A.executionStats(ex), { taps: 3, emails: 2, links: 1 });
  assert.equal(A.emailFromVars(ex[0].variables), "guy@example.com");
  assert.equal(A.emailFromVars(ex[2].variables), "a@b.io");
});
test("content hash changes with copy, not with name", () => {
  assert.equal(A.contentHash(auto()), A.contentHash(auto({ name: "שם אחר" })));
  assert.notEqual(A.contentHash(auto()), A.contentHash(auto({ dm1_text: "אחר" })));
});
