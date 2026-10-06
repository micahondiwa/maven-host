import type { SocialLink } from '../lib/site'
export function SocialIcon({ name, className = 'size-4' }: { name: SocialLink['key']; className?: string }) {
  const props = { viewBox: '0 0 24 24', className, 'aria-hidden': true as const }
  if (name === 'instagram') return <svg {...props} fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" /></svg>
  const paths = {
    linkedin: 'M3 2h18a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Zm2 7v10h3V9H5Zm1.5-4a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM10 9v10h3v-5.4c0-2.5 3-2.7 3 0V19h3v-6.3c0-4.2-4.3-4.7-6-2.4V9h-3Z',
    facebook: 'M12 2a10 10 0 0 1 1.5 19.9V15H16l.4-3h-2.9v-1.9c0-.9.3-1.5 1.5-1.5h1.5V6a18 18 0 0 0-2.2-.2c-2.3 0-3.8 1.4-3.8 4V12H8v3h2.5v6.9A10 10 0 0 1 12 2Z',
    tiktok: 'M14.6 2c.7 2.7 2.3 4.3 5.4 4.5v3.2c-1.9 0-3.7-.6-5.3-1.6v7.3a6.4 6.4 0 1 1-5.4-6.3v3.3a3.2 3.2 0 1 0 2.2 3V2h3.1Z',
    youtube: 'M4 5h16a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H4a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3Zm6 3v8l7-4-7-4Z',
    x: 'M3 3h5l5 7 6-7h2l-7 9 7 9h-5l-6-7-6 7H2l7-9-6-9Zm3 2 11 14h2L8 5H6Z',
  }
  return <svg {...props} fill="currentColor" fillRule="evenodd"><path d={paths[name]} /></svg>
}
