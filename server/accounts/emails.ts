import 'server-only'
import { settings } from '../config'
import { button, escapeHtml, sendBrandedEmail } from '../communications/email'

/** Port of apps/accounts/services/email.py and its templates. */

type Recipient = { email: string; first_name: string; is_email_verified: boolean }

const greetingName = (user: Recipient) => user.first_name.trim() || 'there'

const linkFallback = (url: string) =>
  `<p style="margin:24px 0 6px;font-size:12px;color:#66758a">If the button doesn't work, copy this link into your browser:</p>
<p style="margin:0;font-size:12px;line-height:1.6;word-break:break-all;overflow-wrap:anywhere"><a href="${escapeHtml(url)}" style="color:#0C6898;text-decoration:underline;word-break:break-all">${escapeHtml(url)}</a></p>`

export async function sendAccountEmail({ subject, recipient, textContent, htmlContent, fromEmail, replyTo, heading, preheader }: {
  subject: string
  recipient: string
  textContent: string
  htmlContent?: string
  fromEmail?: string
  replyTo?: string[] | null
  heading?: string
  preheader?: string
}) {
  return sendBrandedEmail({
    subject,
    textContent,
    htmlContent: htmlContent ?? '',
    heading: heading || subject,
    preheader,
    contactEmail: settings.email.supportFrom,
    from: fromEmail || settings.email.notificationsFrom,
    recipients: [recipient],
    replyTo: replyTo === undefined ? null : replyTo,
  })
}

export function sendWelcomeEmail(user: Recipient) {
  const siteUrl = settings.frontendUrl
  const accountUrl = `${siteUrl}/account`
  const name = greetingName(user)
  const verificationNote = user.is_email_verified ? '' : 'Please also open your verification email to confirm your email address.\n\n'
  const html = `<p style="margin:0 0 16px">Hi ${escapeHtml(name)},</p>
<p style="margin:0 0 16px">Every great idea needs a place to grow. Your MavenHost account is ready — let's give yours a home online.</p>
${button(accountUrl, 'Explore my account')}
<h2 style="margin:0 0 16px;font-size:18px;color:#0B4C72">Make your next move</h2>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
  <tr><td style="padding:14px 0;border-top:1px solid #e2e8f0"><a href="${escapeHtml(siteUrl)}/domains" style="font-size:15px;font-weight:700;color:#0C6898;text-decoration:none">Find your domain →</a><br><span style="font-size:14px;color:#66758a">Give your business a memorable address.</span></td></tr>
  <tr><td style="padding:14px 0;border-top:1px solid #e2e8f0"><a href="${escapeHtml(siteUrl)}/hosting" style="font-size:15px;font-weight:700;color:#0C6898;text-decoration:none">Choose your hosting →</a><br><span style="font-size:14px;color:#66758a">Compare plans and pick the right home for your website.</span></td></tr>
  <tr><td style="padding:14px 0;border-top:1px solid #e2e8f0"><a href="${escapeHtml(siteUrl)}/help-center" style="font-size:15px;font-weight:700;color:#0C6898;text-decoration:none">Get a little guidance →</a><br><span style="font-size:14px;color:#66758a">Browse practical setup guides or ask our team for help.</span></td></tr>
</table>
${user.is_email_verified ? '' : `<p style="margin:20px 0 0;padding:16px;background:#f1f7fb;font-size:13px;line-height:1.6">One quick step: open your verification email to confirm your address. This welcome email doesn't verify your account.</p>`}
<p style="margin:22px 0 0">Need a hand getting started? Reply to this email. We're here to help you take the next step.</p>`
  return sendAccountEmail({
    subject: 'Welcome to MavenHost',
    recipient: user.email,
    heading: 'Welcome to MavenHost',
    textContent:
      `Hi ${name},\n\nYour MavenHost account is ready.\n\n` +
      'Find a domain for your business, compare hosting plans, and manage your services from your account.\n\n' +
      `${verificationNote}Open your account: ${accountUrl}\n\n` +
      'Need a hand getting started? Reply to this email and our support team will help.',
    htmlContent: html,
    preheader: 'Your next chapter online starts here. Find a domain, choose hosting, and get support.',
  })
}

export function sendVerificationEmail(user: Recipient, verificationUrl: string) {
  const name = greetingName(user)
  const html = `<p style="margin:0 0 16px">Hi ${escapeHtml(name)},</p>
<p style="margin:0 0 16px">You're one step away. Confirm your email address so we can send you important updates about your domains, hosting and account.</p>
${button(verificationUrl, 'Verify my email')}
<p style="margin:0 0 22px;font-size:13px;color:#66758a">This link expires in <strong>24 hours</strong> and can be used once.</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="background:#f1f7fb;border-left:3px solid #00D2FF;padding:16px;font-size:13px;line-height:1.6"><strong style="color:#0B4C72">Didn't create this account?</strong><br>You can safely ignore this email. Don't share the verification link with anyone.</td></tr></table>
${linkFallback(verificationUrl)}`
  return sendAccountEmail({
    subject: 'Confirm your email to get started with MavenHost',
    recipient: user.email,
    heading: 'One step closer to your next big idea',
    preheader: 'Confirm your email address. Your secure link is valid for 24 hours.',
    textContent:
      `Hi ${name},\n\nConfirm your email address so we can send important updates about your domains, hosting and account.\n\n` +
      `Verify your email: ${verificationUrl}\n\n` +
      'This link expires in 24 hours and can be used once. If you did not create this account, you can safely ignore this email. Keep this link private.',
    htmlContent: html,
    fromEmail: settings.email.noreplyFrom,
    replyTo: [],
  })
}

export function sendStaffInvitation(user: Recipient, invitationUrl: string, role: string, renewed = false) {
  const name = greetingName(user)
  const html = `<p style="margin:0 0 16px">Hi ${escapeHtml(name)},</p>
<p style="margin:0 0 20px">${renewed ? 'Your invitation to the MavenHost team has been renewed.' : "You've been invited to join the MavenHost team."} Complete your profile and choose your own password to activate your staff account.</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f1f7fb;border:1px solid #dce5ee;border-radius:8px"><tr><td style="padding:16px;font-size:13px;line-height:1.8"><strong style="color:#0B4C72">Your account</strong><br>${escapeHtml(user.email)}<br><strong style="color:#0B4C72">Assigned role</strong><br>${escapeHtml(role)}</td></tr></table>
${button(invitationUrl, 'Set up my staff profile')}
<p style="margin:0 0 16px;font-size:13px;color:#66758a">This invitation expires in <strong>24 hours</strong>. You'll choose your own password; your access is determined by your assigned role.${renewed ? ' This link replaces your previous invitation.' : ''}</p>
<p style="margin:0 0 16px;font-size:13px">Not expecting this invitation? Don't activate the account. Contact the MavenHost administrator who invited you.</p>
${linkFallback(invitationUrl)}`
  return sendAccountEmail({
    subject: 'Your MavenHost staff invitation',
    recipient: user.email,
    heading: 'Your place on the team is ready',
    preheader: `Set up your ${role} profile and choose your own password. Invitation valid for 24 hours.`,
    textContent:
      `Hi ${name},\n\nYou have been invited to join the MavenHost team.\n\n` +
      `Account: ${user.email}\nRole: ${role}\n\nActivate your staff account: ${invitationUrl}\n\n` +
      'Set up your profile and choose your own password to get started. This invitation expires in 24 hours and can be used once. ' +
      (renewed ? 'This link replaces your previous invitation. ' : '') +
      'If you were not expecting this invitation, do not activate the account; contact the administrator who invited you.',
    htmlContent: html,
    fromEmail: settings.email.noreplyFrom,
    replyTo: [],
  })
}

export function sendPasswordResetEmail(email: string, resetUrl: string) {
  return sendAccountEmail({
    subject: 'Reset your MavenHost password',
    recipient: email,
    textContent: `We received a request to reset your MavenHost password. Use this link to continue: ${resetUrl}`,
    fromEmail: settings.email.noreplyFrom,
    replyTo: [],
  })
}
