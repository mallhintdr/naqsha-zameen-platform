/**
 * Emails for the sub-admin program. Every value that comes from a user is
 * HTML-escaped. Sending failures are logged and never break the action.
 */
const { sendHtmlEmail, getFrontendUrl } = require('../utils/emailUtils');
const logger = require('../utils/logger');

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => `Rs ${Number(n || 0).toLocaleString('en-PK')}`;
const day = (d) => (d ? new Date(d).toLocaleDateString('en-PK', { dateStyle: 'medium', timeZone: 'Asia/Karachi' }) : '—');

const shell = (title, body) => `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px; color: #212529;">
  <h2 style="text-align: center; margin-top: 0;">${esc(title)}</h2>
  ${body}
  <hr style="border: 0; border-top: 1px solid #eeeeee; margin: 20px 0;">
  <p style="font-size: 12px; color: #6c757d; text-align: center;">GeoMatrix Naqsha Zameen · This is an automated message, please do not reply.</p>
</div>`;

const button = (href, label) => `
  <div style="text-align: center; margin: 26px 0;">
    <a href="${esc(href)}" style="background-color: #28a745; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">${esc(label)}</a>
  </div>
  <p style="font-size: 13px; color: #555;">If the button doesn't work, copy this link into your browser:<br><a href="${esc(href)}">${esc(href)}</a></p>`;

const providerBlock = (provider) => {
  if (!provider) return '';
  const rows = [
    ['Your provider', provider.name],
    ['JazzCash', provider.jazzcash ? `${provider.jazzcash.number} (${provider.jazzcash.title || ''})` : ''],
    ['EasyPaisa', provider.easypaisa ? `${provider.easypaisa.number} (${provider.easypaisa.title || ''})` : ''],
    ['Phone', provider.phone],
    ['WhatsApp', provider.whatsapp]
  ].filter(([, v]) => v);
  return `<table style="width:100%; border-collapse: collapse; margin: 12px 0; font-size: 14px;">${rows.map(([k, v]) =>
    `<tr><td style="padding:4px 8px; color:#6c757d;">${esc(k)}</td><td style="padding:4px 8px; font-weight:bold;">${esc(v)}</td></tr>`).join('')}</table>`;
};

async function safeSend(opts, context) {
  try {
    await sendHtmlEmail(opts);
    return true;
  } catch (err) {
    logger.error(`Sub-admin email failed: ${context}`, { to: opts.to, error: err.message });
    return false;
  }
}

/** Activation email for a customer created by a sub-admin. */
function sendCustomerActivation({ to, userName, userId, token, planLabel, mouzas, customerFee, provider, expiresAt }) {
  const url = `${getFrontendUrl()}/activate/${encodeURIComponent(token)}`;
  const body = `
    <p>Hello <strong>${esc(userName)}</strong>,</p>
    <p>An account has been created for you on Naqsha Zameen by your provider. Your User ID is <strong>${esc(userId)}</strong>.</p>
    <table style="width:100%; border-collapse: collapse; margin: 12px 0; font-size: 14px;">
      <tr><td style="padding:4px 8px; color:#6c757d;">Plan</td><td style="padding:4px 8px; font-weight:bold;">${esc(planLabel)}</td></tr>
      <tr><td style="padding:4px 8px; color:#6c757d;">Mouzas</td><td style="padding:4px 8px;">${esc((mouzas || []).join(', '))}</td></tr>
      ${customerFee ? `<tr><td style="padding:4px 8px; color:#6c757d;">Fee recorded by your provider</td><td style="padding:4px 8px; font-weight:bold;">${money(customerFee)}</td></tr>` : ''}
    </table>
    <p>Your access starts when you activate. Open the link below and press <strong>Activate account</strong>.</p>
    ${button(url, 'Open activation page')}
    <p style="font-size: 13px;">This link expires on ${day(expiresAt)}.</p>
    ${providerBlock(provider)}
    <p style="font-size: 13px; color:#555;">If something about this account isn't right, you can report it to Naqsha Zameen from your profile after logging in.</p>`;
  return safeSend({ to, subject: 'Activate your Naqsha Zameen account', html: shell('Activate your account', body) }, 'customer activation');
}

/** One-time activation email for a new or promoted sub-admin. */
function sendSubAdminActivation({ to, userName, userId, token, expiresAt }) {
  const url = `${getFrontendUrl()}/subadmin/activate/${encodeURIComponent(token)}`;
  const body = `
    <p>Hello <strong>${esc(userName)}</strong>,</p>
    <p>You've been appointed as a sub-admin on Naqsha Zameen (User ID <strong>${esc(userId)}</strong>).</p>
    <p>To start, open the link below, enter the JazzCash / EasyPaisa details your customers will pay you on, accept the Fair Charge Policy, and press <strong>Activate</strong>.</p>
    ${button(url, 'Activate sub-admin account')}
    <p style="font-size: 13px;">This link expires on ${day(expiresAt)}.</p>`;
  return safeSend({ to, subject: 'Activate your Naqsha Zameen sub-admin account', html: shell('Sub-admin activation', body) }, 'sub-admin activation');
}

/** Confirmation link for a changed customer email; the old address is told separately. */
async function sendEmailChangeConfirmation({ to, oldEmail, userName, token }) {
  const url = `${getFrontendUrl()}/confirm-email/${encodeURIComponent(token)}`;
  const ok = await safeSend({
    to,
    subject: 'Confirm your new email address',
    html: shell('Confirm your new email', `<p>Hello <strong>${esc(userName)}</strong>,</p><p>Please confirm this is your new email address for Naqsha Zameen.</p>${button(url, 'Confirm email')}`)
  }, 'email change confirmation');
  if (oldEmail) {
    await safeSend({
      to: oldEmail,
      subject: 'Your Naqsha Zameen email is being changed',
      html: shell('Email change requested', `<p>Hello <strong>${esc(userName)}</strong>,</p><p>A change of your account email to <strong>${esc(to)}</strong> was requested. It only takes effect once confirmed from the new address. If you didn't ask for this, please contact Naqsha Zameen support.</p>`)
    }, 'email change notice');
  }
  return ok;
}

/** Renewal notice to a customer, with provider and fee (Fair Charge Policy). */
function sendCustomerRenewal({ to, userName, planLabel, periodEnd, customerFee, provider }) {
  const body = `
    <p>Hello <strong>${esc(userName)}</strong>,</p>
    <p>Your <strong>${esc(planLabel)}</strong> subscription has been renewed and is valid until <strong>${day(periodEnd)}</strong>.</p>
    ${customerFee ? `<p>Fee recorded by your provider: <strong>${money(customerFee)}</strong></p>` : ''}
    ${providerBlock(provider)}`;
  return safeSend({ to, subject: 'Your subscription has been renewed', html: shell('Subscription renewed', body) }, 'customer renewal');
}

module.exports = { sendCustomerActivation, sendSubAdminActivation, sendEmailChangeConfirmation, sendCustomerRenewal, safeSend, shell, esc, money, day, button, providerBlock };
