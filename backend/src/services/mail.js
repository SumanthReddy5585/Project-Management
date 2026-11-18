// Outbound email over SMTP (any provider: Brevo, Gmail, Mailgun, SES...). Configure SMTP_URL, e.g.
// smtps://user:pass@smtp-relay.brevo.com:465, and MAIL_FROM. Without SMTP_URL email is disabled and the
// app falls back to in-app notifications and copyable links.
import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

let transport = null;
function getTransport() {
  if (!config.emailConfigured) return null;
  transport ??= nodemailer.createTransport(config.SMTP_URL, { from: config.MAIL_FROM });
  return transport;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Branded, minimal HTML email with one call-to-action button. */
export function renderEmail({ heading, body, cta, url, footer }) {
  const text = [heading, '', body, '', url ? `${cta || 'Open'}: ${url}` : '', '', footer || `${config.APP_NAME}`].join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#f2f5f9;font-family:Segoe UI,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f5f9;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #e2e8f0;border-radius:12px">
<tr><td style="background:#0b1626;border-radius:12px 12px 0 0;padding:18px 24px;color:#fff;font-weight:700;font-size:16px">${esc(config.APP_NAME)}</td></tr>
<tr><td style="padding:24px"><h1 style="font-size:18px;margin:0 0 12px">${esc(heading)}</h1>
<div style="font-size:14px;line-height:1.6;color:#334155;white-space:pre-wrap">${esc(body)}</div>
${url ? `<p style="margin:22px 0 4px"><a href="${esc(url)}" style="background:#2563eb;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;font-size:14px;display:inline-block">${esc(cta || 'Open')}</a></p>` : ''}
</td></tr><tr><td style="padding:14px 24px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b">${esc(footer || 'You are receiving this because you have an account on ' + config.APP_NAME + '.')}</td></tr>
</table></td></tr></table></body></html>`;
  return { text, html };
}

export async function sendMail({ to, subject, heading, body, cta, url, footer }) {
  const t = getTransport();
  if (!t) return { sent: false, reason: 'NOT_CONFIGURED' };
  const { text, html } = renderEmail({ heading: heading || subject, body, cta, url, footer });
  try {
    await t.sendMail({ from: config.MAIL_FROM, to, subject, text, html });
    return { sent: true };
  } catch (err) {
    logger.warn({ err: err.message, to }, 'email failed');
    return { sent: false, reason: err.message };
  }
}
