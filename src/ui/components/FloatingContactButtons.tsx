import { Mail, MessageSquare } from 'lucide-react'
import { useState } from 'react'
import { whatsappUrl } from '../lib/site'

const WHATSAPP_URL = whatsappUrl('Hello MavenHost')
const EMAIL_URL = 'mailto:info@maven-host.com'

function WhatsAppMark() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5 fill-current"><path d="M12 2a9.7 9.7 0 0 0-8.37 14.6L2.3 21.7l5.22-1.3A9.7 9.7 0 1 0 12 2Zm0 17.7a8 8 0 0 1-4.08-1.12l-.3-.18-3.1.77.82-3.02-.2-.31A8 8 0 1 1 12 19.7Zm4.4-5.94c-.24-.12-1.4-.69-1.62-.77-.22-.08-.38-.12-.54.12-.16.24-.62.77-.76.93-.14.16-.28.18-.52.06-1.4-.7-2.32-1.25-3.25-2.84-.24-.42.24-.39.68-1.3.08-.16.04-.3-.02-.42-.06-.12-.54-1.3-.74-1.78-.2-.47-.4-.4-.54-.41h-.46c-.16 0-.42.06-.64.3-.22.24-.84.82-.84 2s.86 2.32.98 2.48c.12.16 1.69 2.58 4.1 3.62.57.25 1.02.4 1.37.51.58.18 1.1.15 1.51.09.46-.07 1.4-.57 1.6-1.12.2-.55.2-1.02.14-1.12-.06-.1-.22-.16-.46-.28Z" /></svg>
}

export function FloatingContactButtons() {
  const [chatOpen, setChatOpen] = useState(false)

  return (
    <div className="floating-contact" aria-label="Contact MavenHost">
      <a href={WHATSAPP_URL} target="_blank" rel="noreferrer" aria-label="WhatsApp" className="floating-contact-action floating-contact-whatsapp"><WhatsAppMark /></a>
      <a href={EMAIL_URL} aria-label="Email MavenHost" className="floating-contact-action floating-contact-email"><Mail className="size-5" /></a>
      <button type="button" onClick={() => setChatOpen((value) => !value)} aria-expanded={chatOpen} aria-label="Open chat" className="floating-contact-action floating-contact-chat"><MessageSquare className="size-5" /></button>
      {chatOpen && <div className="floating-contact-popover"><p className="text-xs font-semibold text-maven-ink">Need help?</p><p className="mt-1 text-xs leading-5 text-maven-muted">Start a WhatsApp conversation with MavenHost.</p><a href={WHATSAPP_URL} target="_blank" rel="noreferrer" className="mt-3 inline-flex text-xs font-bold text-maven-signal">Start chat →</a></div>}
    </div>
  )
}
