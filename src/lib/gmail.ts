import "server-only";

import { google } from "googleapis";

// Sends mail through the Gmail API using OAuth2 (three-legged, with a stored refresh
// token) — per spec section 2 ("שליחה ישירה מהחשבון האישי שלך"). No SMTP, no
// nodemailer; the googleapis client posts the raw MIME message directly to
// gmail.users.messages.send.
//
// One-time setup to get GOOGLE_REFRESH_TOKEN (see README for the full walkthrough):
//   1. Google Cloud Console → new/existing project → enable the Gmail API.
//   2. OAuth consent screen: while unverified, only the test users you add can
//      authorize this — fine for one sending account, but confirm which Google
//      account will actually send mail (spec section 7, still open).
//   3. Credentials → OAuth client ID → Web application → add a redirect URI (can be
//      http://localhost for a one-time manual token exchange).
//   4. Authorize with scope https://www.googleapis.com/auth/gmail.send, exchange the
//      returned code for tokens, and save the refresh_token — it does not expire
//      under normal use (only if revoked, unused for 6 months, or the OAuth consent
//      screen stays in "Testing" and the 7-day test-token expiry policy applies to it —
//      publish the consent screen or keep the app in "Testing" with awareness of that).

function getOAuth2Client() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Gmail is not configured — set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN (see README)."
    );
  }

  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    process.env.GOOGLE_REDIRECT_URI
  );
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return oauth2Client;
}

/** RFC 2822 message with a UTF-8 (Hebrew-safe) subject and HTML body, base64url-encoded
 * the way the Gmail API's `raw` field requires. */
function buildRawMessage({
  from,
  to,
  subject,
  html,
}: {
  from: string;
  to: string;
  subject: string;
  html: string;
}) {
  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject, "utf-8").toString("base64")}?=`;

  const message = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(html, "utf-8").toString("base64"),
  ].join("\r\n");

  return Buffer.from(message, "utf-8").toString("base64url");
}

export async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}) {
  if (!to.includes("@")) {
    throw new Error(`Refusing to send: "${to}" doesn't look like an email address.`);
  }

  const auth = getOAuth2Client();
  const gmail = google.gmail({ version: "v1", auth });

  const senderEmail = process.env.GMAIL_SENDER_EMAIL;
  const senderName = process.env.GMAIL_SENDER_NAME;
  // The Gmail API always sends as the authorized ("me") account regardless of the
  // From header's address — this only controls the display name shown to the
  // recipient. Falls back to the bare "me" account if not set.
  const from = senderEmail
    ? `${senderName ? `${senderName} ` : ""}<${senderEmail}>`
    : "me";

  const raw = buildRawMessage({ from, to, subject, html });

  const res = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw },
  });

  return res.data;
}
