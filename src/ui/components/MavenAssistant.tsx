import { useMemo, useState, type FormEvent } from 'react'
import { Bot, Send, X } from 'lucide-react'
import { ApiError, chatWithMaven, type ChatMessage } from '../lib/api'
import { whatsappUrl } from '../lib/site'

const WELCOME = 'Hi — I’m Maven Assistant. I can explain MavenHost domains, hosting choices and account guidance. For a service investigation or custom development, contact the relevant support team.'

function WhatsAppMark({ className }: { className: string }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" className={`${className} fill-current`}><path d="M12 2a9.7 9.7 0 0 0-8.37 14.6L2.3 21.7l5.22-1.3A9.7 9.7 0 1 0 12 2Zm0 17.7a8 8 0 0 1-4.08-1.12l-.3-.18-3.1.77.82-3.02-.2-.31A8 8 0 1 1 12 19.7Zm4.4-5.94c-.24-.12-1.4-.69-1.62-.77-.22-.08-.38-.12-.54.12-.16.24-.62.77-.76.93-.14.16-.28.18-.52.06-1.4-.7-2.32-1.25-3.25-2.84-.24-.42.24-.39.68-1.3.08-.16.04-.3-.02-.42-.06-.12-.54-1.3-.74-1.78-.2-.47-.4-.4-.54-.41h-.46c-.16 0-.42.06-.64.3-.22.24-.84.82-.84 2s.86 2.32.98 2.48c.12.16 1.69 2.58 4.1 3.62.57.25 1.02.4 1.37.51.58.18 1.1.15 1.51.09.46-.07 1.4-.57 1.6-1.12.2-.55.2-1.02.14-1.12-.06-.1-.22-.16-.46-.28Z" /></svg>
}

export function MavenAssistant() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([{ role: 'assistant', content: WELCOME }])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  const canSend = useMemo(() => Boolean(draft.trim()) && !sending, [draft, sending])

  async function submit(event: FormEvent) {
    event.preventDefault()
    const content = draft.trim()
    if (!content || sending) return
    setDraft('')
    setError('')
    const next: ChatMessage[] = [...messages, { role: 'user', content }]
    setMessages(next)
    setSending(true)
    try {
      const answer = await chatWithMaven(next)
      setMessages((current) => [...current, { role: 'assistant', content: answer }])
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Maven Assistant is temporarily unavailable.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed bottom-3 right-3 z-50 flex w-[min(390px,calc(100vw-1.5rem))] flex-col items-end sm:bottom-6 sm:right-6">
      {open && (
        <div className="mb-3 flex h-[min(600px,calc(100dvh-12rem))] max-h-[calc(100dvh-12rem)] w-full min-h-0 flex-col overflow-hidden rounded-2xl border border-maven-line bg-white shadow-[0_24px_70px_-20px_rgba(12,18,32,0.35)]">
          <div className="flex items-center justify-between bg-maven-ink px-4 py-3.5 text-white">
            <div className="flex items-center gap-2.5">
              <span className="grid size-9 place-items-center rounded-full bg-maven-bright text-maven-ink"><Bot className="size-5" /></span>
              <div>
                <p className="text-sm font-semibold">Maven Assistant</p>
                <p className="text-[11px] text-white/65">MavenHost guidance</p>
              </div>
            </div>
            <button onClick={() => setOpen(false)} aria-label="Close Maven Assistant" className="rounded-lg p-2 text-white/60 hover:bg-white/10 hover:text-white"><X className="size-4" /></button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto bg-maven-paper p-4">
            {messages.map((message, index) => (
              <div key={`${message.role}-${index}`} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[86%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[13px] leading-5 ${message.role === 'user' ? 'rounded-br-md bg-maven-ink text-white' : 'rounded-bl-md border border-maven-line bg-white text-maven-ink'}`}>
                  {message.content}
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex justify-start"><div className="rounded-2xl rounded-bl-md border border-maven-line bg-white px-3.5 py-2.5 text-[13px] text-maven-muted">Thinking…</div></div>
            )}
            {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-maven-danger">{error}</p>}
          </div>

          <form onSubmit={submit} className="border-t border-maven-line bg-white p-3">
            <div className="flex items-end gap-2">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit(event) }
                }}
                rows={2}
                maxLength={4000}
                placeholder="Ask Maven Assistant…"
                className="field min-h-10 resize-none"
                aria-label="Message Maven Assistant"
              />
              <button disabled={!canSend} className="grid size-10 shrink-0 place-items-center rounded-xl bg-maven-blue text-white transition hover:bg-[#086796] disabled:opacity-40" aria-label="Send message">
                <Send className="size-4" />
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="flex flex-col items-center gap-2 sm:gap-3">
        <a
          href={whatsappUrl('Hello MavenHost, I have a question about your services.')}
          target="_blank"
          rel="noreferrer noopener"
          aria-label="Chat with MavenHost on WhatsApp"
          title="WhatsApp MavenHost"
          className="grid size-12 place-items-center rounded-full bg-[#16a34a] text-white shadow-[0_12px_35px_-10px_rgba(12,18,32,0.55)] ring-2 ring-white transition hover:-translate-y-0.5 hover:bg-[#15803d] sm:size-14 sm:ring-4"
        >
          <WhatsAppMark className="size-6 sm:size-7" />
        </a>
        <button
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-label={open ? 'Close Maven Assistant' : 'Open Maven Assistant'}
          title="Chat with Maven Assistant"
          className="grid size-12 place-items-center rounded-full bg-maven-ink text-white shadow-[0_12px_35px_-10px_rgba(12,18,32,0.55)] ring-2 ring-white transition hover:-translate-y-0.5 hover:bg-maven-blue sm:size-14 sm:ring-4"
        >
          {open ? <X className="size-5 sm:size-6" /> : <Bot className="size-5 sm:size-6" />}
        </button>
      </div>
    </div>
  )
}
