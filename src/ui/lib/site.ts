export type SocialLink = {
  key: 'instagram' | 'tiktok' | 'facebook' | 'linkedin' | 'x' | 'youtube'
  label: string
  href: string
}

export const WHATSAPP_NUMBER = '254786738685'

export function whatsappUrl(message = 'Hello MavenHost'): string {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`
}

/**
 * MavenHost public social profiles.
 * These are public URLs, so they are intentionally safe to ship in the frontend bundle.
 * Environment variables may override them for a future brand/account change.
 */
const configured = {
  youtube: process.env.NEXT_PUBLIC_SOCIAL_YOUTUBE?.trim() || 'https://www.youtube.com/@mavenhost',
  instagram: process.env.NEXT_PUBLIC_SOCIAL_INSTAGRAM?.trim() || 'https://www.instagram.com/mavenhost/',
  tiktok: process.env.NEXT_PUBLIC_SOCIAL_TIKTOK?.trim() || 'https://www.tiktok.com/@maven.host',
  facebook: process.env.NEXT_PUBLIC_SOCIAL_FACEBOOK?.trim() || 'https://www.facebook.com/mavenhost',
  linkedin: process.env.NEXT_PUBLIC_SOCIAL_LINKEDIN?.trim() || 'https://www.linkedin.com/company/mavenhost/',
  x: process.env.NEXT_PUBLIC_SOCIAL_X?.trim() || 'https://x.com/mavenhost',
}

export const SOCIAL_LINKS: SocialLink[] = [
  { key: 'youtube', label: 'YouTube', href: configured.youtube },
  { key: 'instagram', label: 'Instagram', href: configured.instagram },
  { key: 'tiktok', label: 'TikTok', href: configured.tiktok },
  { key: 'facebook', label: 'Facebook', href: configured.facebook },
  { key: 'linkedin', label: 'LinkedIn', href: configured.linkedin },
  { key: 'x', label: 'X', href: configured.x },
]

export function socialHandle(key: SocialLink['key']): string {
  return key === 'tiktok' ? '@maven.host' : '@mavenhost'
}

export function isSafeExternalUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && Boolean(url.hostname)
  } catch {
    return false
  }
}

export const CONTACT = { email: 'info@maven-host.com', emailHref: 'mailto:info@maven-host.com', whatsapp: WHATSAPP_NUMBER }
export const INARA_CREST = { home: 'https://www.inaracresttechnologies.com/', developers: 'https://www.inaracresttechnologies.com/developers' }
