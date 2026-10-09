import 'server-only'
import nodemailer, { type Transporter } from 'nodemailer'
import { settings } from '../config'

/** Port of apps/common/email.py: the shared branded shell, plain-text fallback and SMTP delivery. */

const SOCIAL_LINKS: [string, string][] = [
  ['https://www.youtube.com/@mavenhost', 'YouTube'],
  ['https://www.facebook.com/mavenhost', 'Facebook'],
  ['https://www.instagram.com/mavenhost/', 'Instagram'],
  ['https://www.linkedin.com/company/mavenhost/', 'LinkedIn'],
  ['https://x.com/mavenhost', 'X'],
  ['https://www.tiktok.com/@maven.host', 'TikTok'],
]

/** Django template auto-escaping. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

/** `urlize(text, autoescape=True)` followed by newline → `<br>` conversion. */
export function urlize(text: string): string {
  const pattern = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g
  let output = ''
  let last = 0
  for (const match of text.matchAll(pattern)) {
    let url = match[0]
    const trailing = /[.,:;!?)\]]+$/.exec(url)?.[0] ?? ''
    url = url.slice(0, url.length - trailing.length)
    output += escapeHtml(text.slice(last, match.index))
    const href = url.includes('@') && !url.includes('://') ? `mailto:${url}` : url.startsWith('www.') ? `http://${url}` : url
    output += `<a href="${escapeHtml(href)}"${href.startsWith('mailto:') ? '' : ' rel="nofollow"'}>${escapeHtml(url)}</a>${escapeHtml(trailing)}`
    last = (match.index ?? 0) + match[0].length
  }
  output += escapeHtml(text.slice(last))
  return output.replace(/\n/g, '<br>\n')
}

/** `email.utils.parseaddr(identity)[1]` */
export function emailAddress(identity: string): string {
  const match = /<([^>]+)>/.exec(identity ?? '')
  return (match ? match[1] : identity ?? '').trim()
}

export function button(url: string, label: string) {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:26px 0"><tr><td bgcolor="#0C6898" style="border-radius:8px;text-align:center"><a href="${escapeHtml(url)}" style="display:inline-block;padding:15px 25px;color:#ffffff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;border:1px solid #0C6898;border-radius:8px">${escapeHtml(label)}</a></td></tr></table>`
}

export function renderBrandedEmail({ textContent, htmlContent = '', heading = '', preheader = '', contactEmail = '' }: {
  textContent: string
  htmlContent?: string
  heading?: string
  preheader?: string
  contactEmail?: string
}) {
  const siteUrl = settings.frontendUrl
  const body = htmlContent || urlize(textContent || '')
  const contact = emailAddress(contactEmail || settings.email.supportFrom)
  const year = new Date(Date.now() + 3 * 3600_000).getUTCFullYear()
  const socials = SOCIAL_LINKS.map(([url, label]) => `<a href="${escapeHtml(url)}" style="color:#52647a;text-decoration:none;white-space:nowrap">${escapeHtml(label)}</a>`).join(' · ')
  const pre = (preheader || heading || 'An update about your MavenHost account.').slice(0, 150)
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(heading)}</title></head>
<body style="margin:0;padding:0;background:#eef3f8;color:#24364b;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(pre)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#eef3f8"><tr><td align="center" style="padding:28px 12px">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background:#fff;border:1px solid #dce5ee;border-radius:16px;overflow:hidden">
      <tr><td style="background:#0B4C72;padding:20px 28px;border-bottom:3px solid #00D2FF"><a href="${escapeHtml(siteUrl)}" style="text-decoration:none"><img src="${escapeHtml(`${siteUrl}/brand/mavenhost-logo-reversed.png?v=inara-20261004`)}" width="208" alt="MavenHost — Domains and Web Hosting" style="display:block;width:208px;max-width:100%;height:auto;border:0"></a></td></tr>
      <tr><td style="padding:32px 28px 36px;font-size:16px;line-height:1.65;color:#33465c">
        <p style="margin:0 0 10px;color:#0C6898;font-size:11px;letter-spacing:2px;font-weight:700;text-transform:uppercase">YOUR NEXT CHAPTER ONLINE</p>
        ${heading ? `<h1 style="margin:0 0 22px;color:#0B4C72;font-size:28px;line-height:1.2;letter-spacing:-.5px">${escapeHtml(heading)}</h1>` : ''}
        ${body}
      </td></tr>
      <tr><td style="background:#f8fafc;padding:24px 28px;border-top:1px solid #e2e8f0;font-size:13px;line-height:1.7;color:#66758a">
        <p style="margin:0 0 6px;color:#0B4C72;font-weight:700">MavenHost · Your ideas belong online.</p>
        <p style="margin:0 0 14px">Questions? <a href="mailto:${escapeHtml(contact)}" style="color:#0C6898;text-decoration:underline">${escapeHtml(contact)}</a> · <a href="${escapeHtml(siteUrl)}/help-center" style="color:#0C6898;text-decoration:underline">Help center</a></p>
        <p style="margin:0 0 14px">${socials}</p>
        <p style="margin:0;font-size:11px;line-height:1.6">This is a service email about your MavenHost account or a request made to our team. Keep account links private.</p>
      </td></tr>
    </table>
    <p style="margin:16px 0 0;color:#8190a3;font-size:11px">© ${year} MavenHost. All rights reserved.</p>
  </td></tr></table>
</body></html>`
}

export type OutgoingEmail = {
  subject: string
  to: string[]
  from: string
  text: string
  html?: string
  replyTo?: string[]
  attachments?: { filename: string; content: Buffer; contentType: string }[]
  headers?: Record<string, string>
}

let transporter: Transporter | undefined
const sent: OutgoingEmail[] = []

/** Messages captured by the console backend; used by tests. */
export function sentEmails() {
  return sent
}

function smtp(): Transporter | null {
  const config = settings.email
  if (!config.host) return null
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.useSsl,
      requireTLS: config.useTls,
      auth: config.user ? { user: config.user, pass: config.password } : undefined,
      connectionTimeout: config.timeoutSeconds * 1000,
      socketTimeout: config.timeoutSeconds * 1000,
    })
  }
  return transporter
}

/** Django `EmailMessage.send(fail_silently=False)`; without EMAIL_HOST the console backend is used, as in v1 development. */
export async function deliver(message: OutgoingEmail) {
  const transport = smtp()
  if (!transport) {
    if (settings.isProduction) throw new Error('EMAIL_HOST is required in production')
    sent.push(message)
    if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) console.info(`[email] ${message.subject} → ${message.to.join(', ')}\n${message.text}`)
    return 1
  }
  await transport.sendMail({
    subject: message.subject,
    from: message.from,
    to: message.to,
    replyTo: message.replyTo?.length ? message.replyTo : undefined,
    text: message.text,
    html: message.html,
    attachments: message.attachments,
    headers: message.headers,
  })
  return 1
}

export async function sendBrandedEmail({ subject, textContent, recipients, from, replyTo, htmlContent = '', heading = '', preheader = '', contactEmail = '', attachments }: {
  subject: string
  textContent: string
  recipients: string[]
  from: string
  replyTo?: string[] | null
  htmlContent?: string
  heading?: string
  preheader?: string
  contactEmail?: string
  attachments?: OutgoingEmail['attachments']
}) {
  const replyAddresses = (replyTo === undefined || replyTo === null ? [settings.email.supportFrom] : replyTo).map(emailAddress)
  return deliver({
    subject,
    from,
    to: recipients,
    replyTo: replyAddresses,
    text: textContent,
    html: renderBrandedEmail({ textContent, htmlContent, heading: heading || subject, preheader, contactEmail: contactEmail || settings.email.supportFrom }),
    attachments,
  })
}
