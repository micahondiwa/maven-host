import { useEffect, useState } from 'react'
import { ApiError, listWebsitePages, saveWebsitePage, type EditableWebsitePage, type GeneratedWebsitePage } from '../lib/api'

export function WebsiteDraftEditor({ name, pages, websiteId, onSaved }: { name: string; pages: GeneratedWebsitePage[]; websiteId?: string; onSaved: () => void }) {
  const [drafts, setDrafts] = useState(pages)
  const [selected, setSelected] = useState(0)
  const [narrow, setNarrow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    if (!websiteId) return
    let active = true
    listWebsitePages(websiteId).then(result => { if (active) { setDrafts(result); setSelected(0); setReady(true) } }).catch(() => { if (active) setMessage('Could not load saved pages. Reload to try again.') })
    return () => { active = false }
  }, [websiteId])
  const page = drafts[selected]
  if (!page) return <p role="status" className="mt-4 text-sm">{message || (websiteId && !ready ? 'Loading saved pages…' : 'This website has no pages yet.')}</p>
  function update(values: Partial<GeneratedWebsitePage>) {
    setDrafts(current => current.map((item, index) => index === selected ? { ...item, ...values } : item))
    setMessage('Unsaved changes')
  }
  async function save() {
    if (!websiteId || !ready) return
    setBusy(true)
    try {
      const saved = await saveWebsitePage(websiteId, page as EditableWebsitePage)
      setDrafts(current => current.map(item => item.slug === saved.slug ? saved : item))
      setMessage('Page saved')
      onSaved()
    } catch (error) { setMessage(error instanceof ApiError ? error.message : 'Could not save this page.') }
    finally { setBusy(false) }
  }
  return <div className="panel p-5">
    <h3 className="text-lg font-semibold">Page editor and live preview</h3>
    <div className="mt-3 flex flex-wrap gap-2">{drafts.map((item, index) => <button key={item.slug} className="btn btn-secondary" aria-pressed={selected === index} onClick={() => setSelected(index)}>{item.title}</button>)}</div>
    {!websiteId && <p className="mt-3 text-sm text-maven-muted">Sign in to save and edit your pages.</p>}
    {websiteId && ready && <fieldset disabled={busy} className="mt-4 space-y-3">
      <label className="block text-sm">Page title<input className="field mt-1" value={page.title} maxLength={150} onChange={event => update({ title: event.target.value })} /></label>
      <label className="block text-sm">SEO title<input className="field mt-1" value={page.seo_title} maxLength={60} onChange={event => update({ seo_title: event.target.value })} /></label>
      <label className="block text-sm">Meta description<textarea className="field mt-1" value={page.seo_description} maxLength={160} onChange={event => update({ seo_description: event.target.value })} /></label>
      {(page.content.sections ?? []).map((section, index) => <div key={index} className="space-y-2 rounded-lg border p-3">
        <p className="text-sm font-semibold">{section.type} section</p>
        {(['heading', 'subheading', 'body', 'cta', 'cta_url'] as const).map(field => <label key={field} className="block text-sm">{field.replace('_', ' ')}<textarea className="field mt-1" value={section[field] ?? ''} onChange={event => update({ content: { ...page.content, sections: page.content.sections?.map((item, i) => i === index ? { ...item, [field]: event.target.value } : item) } })} /></label>)}
        {section.items?.map((item, itemIndex) => <div key={itemIndex} className="space-y-2 border-t pt-2">{(['title', 'description', 'question', 'answer', 'image_url', 'alt'] as const).map(field => <label key={field} className="block text-sm">Item {itemIndex + 1}: {field.replace('_', ' ')}<textarea className="field mt-1" value={item[field] ?? ''} onChange={event => update({ content: { ...page.content, sections: page.content.sections?.map((entry, i) => i === index ? { ...entry, items: entry.items?.map((row, j) => j === itemIndex ? { ...row, [field]: event.target.value } : row) } : entry) } })} /></label>)}</div>)}
      </div>)}
      <button className="btn btn-primary" onClick={save}>{busy ? 'Saving…' : 'Save page'}</button>
    </fieldset>}
    {message && <p role="status" className="mt-3 text-sm">{message}</p>}
    <button className="btn btn-secondary mt-4" onClick={() => setNarrow(value => !value)}>{narrow ? 'Desktop preview' : 'Mobile preview'}</button>
    <div className="mt-4 overflow-auto rounded-lg border bg-slate-100 p-3">
      <div className="mx-auto min-h-96 bg-white p-6 text-slate-800" style={{ maxWidth: narrow ? 375 : '100%' }} aria-label="Website page preview">
        <header className="border-b pb-4"><strong>{name}</strong><nav className="mt-3 flex flex-wrap gap-3">{drafts.map((item, index) => <button key={item.slug} onClick={() => setSelected(index)} className="text-sm underline">{item.title}</button>)}</nav></header>
        {(page.content.sections ?? []).map((section, index) => <section key={index} className={section.type === 'hero' ? 'py-12' : 'py-6'}>
          {section.heading && (section.type === 'hero' ? <h1 className="text-3xl font-bold">{section.heading}</h1> : <h2 className="text-xl font-semibold">{section.heading}</h2>)}
          {section.subheading && <p className="mt-3 text-lg">{section.subheading}</p>}
          {section.body && <p className="mt-3 whitespace-pre-line">{section.body}</p>}
          {section.items?.map((item, i) => <div key={i} className="mt-4"><h3 className="font-semibold">{item.title || item.question}</h3><p>{item.description || item.answer}</p>{item.image_url && /^https?:\/\//.test(item.image_url) && <img src={item.image_url} alt={item.alt || ''} loading="lazy" className="mt-2 max-w-full" />}</div>)}
          {section.cta && <span className="mt-4 inline-block rounded bg-slate-800 px-4 py-2 text-white">{section.cta}</span>}
        </section>)}
      </div>
    </div>
    <p className="mt-2 text-xs text-maven-muted">Responsive content preview. Publishing to a hosting account is a separate step.</p>
  </div>
}
