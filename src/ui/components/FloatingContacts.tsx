import { Mail, MessageCircle } from 'lucide-react'
import { whatsappUrl } from '../lib/site'

export function FloatingContacts() {
  return (
    <div className="fixed bottom-5 right-5 z-[50] flex flex-col items-center gap-3 sm:bottom-6 sm:right-6">
      <a href={whatsappUrl()} target="_blank" rel="noreferrer noopener" aria-label="WhatsApp MavenHost" className="floating-contact bg-[#08cf79]">
        <MessageCircle className="size-6" />
      </a>
      <a href="mailto:info@maven-host.com" aria-label="Email MavenHost" className="floating-contact bg-[#ff4b70]">
        <Mail className="size-6" />
      </a>
    </div>
  )
}
