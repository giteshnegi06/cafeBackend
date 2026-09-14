/**
 * Outbound email via Gmail SMTP (nodemailer). Used only for password-reset
 * links today.
 *
 * Configure with a Gmail account and an App Password (Google Account →
 * Security → 2-Step Verification → App passwords):
 *   SMTP_USER=cafe@gmail.com
 *   SMTP_PASS=xxxx xxxx xxxx xxxx   (the 16-char app password)
 *   SMTP_FROM="7 Days Cafe <cafe@gmail.com>"   (optional; defaults to SMTP_USER)
 *
 * Works from Vercel serverless functions — nodemailer opens a short-lived
 * SMTP connection per send, no persistent process needed.
 */

import nodemailer from 'nodemailer';

export function isMailConfigured(): boolean {
  return !!(process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 465),
    secure: (process.env.SMTP_PORT || '465') === '465',
    auth: {
      user: process.env.SMTP_USER,
      // Google shows app passwords with spaces for readability; they're not
      // part of the secret.
      pass: (process.env.SMTP_PASS || '').replace(/\s+/g, ''),
    },
  });
}

export async function sendPasswordResetEmail(opts: {
  to: string;
  name: string;
  cafeName: string;
  resetUrl: string;
  expiresInMinutes: number;
}): Promise<void> {
  const { to, name, cafeName, resetUrl, expiresInMinutes } = opts;
  const from = process.env.SMTP_FROM || `${cafeName} <${process.env.SMTP_USER}>`;

  await getTransport().sendMail({
    from,
    to,
    subject: `Reset your ${cafeName} staff password`,
    text: [
      `Hi ${name},`,
      '',
      `Someone asked to reset the password for your ${cafeName} staff login (${to}).`,
      `Open this link to choose a new password — it works once and expires in ${expiresInMinutes} minutes:`,
      '',
      resetUrl,
      '',
      "If you didn't ask for this, you can ignore this email; your password won't change.",
    ].join('\n'),
    html: `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1c1917">
        <h2 style="margin:0 0 12px;font-size:20px">Reset your ${escapeHtml(cafeName)} staff password</h2>
        <p style="margin:0 0 12px;font-size:14px;line-height:1.5">Hi ${escapeHtml(name)},</p>
        <p style="margin:0 0 16px;font-size:14px;line-height:1.5">
          Someone asked to reset the password for your staff login (<strong>${escapeHtml(to)}</strong>).
          Click the button to choose a new password. The link works once and expires in ${expiresInMinutes} minutes.
        </p>
        <p style="margin:0 0 20px">
          <a href="${resetUrl}" style="display:inline-block;background:#d97706;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 20px;border-radius:12px">Choose a new password</a>
        </p>
        <p style="margin:0 0 8px;font-size:12px;color:#78716c">Or copy this link into your browser:</p>
        <p style="margin:0 0 20px;font-size:12px;word-break:break-all"><a href="${resetUrl}" style="color:#b45309">${resetUrl}</a></p>
        <p style="margin:0;font-size:12px;color:#78716c">If you didn't ask for this, you can ignore this email — your password won't change.</p>
      </div>`,
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
