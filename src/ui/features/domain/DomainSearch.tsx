import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { ArrowRight, LoaderCircle, Search } from 'lucide-react'
import { Link, useNavigate } from '@/lib/navigation'
import { addDomainToCart, ApiError, searchDomain, type DomainPrice, type DomainSearchResult } from '../../lib/api'
import { useCart } from '../../lib/cart'
import { useCurrency, usePriceLabel } from '../../lib/currency'
import { CurrencySelector } from '../../components/CurrencySelector'

function normalizeSearch(value: string) {
  const cleaned = value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '')
  return cleaned.includes('.') ? cleaned : cleaned.replace(/\s+/g, '-')
}

function validSearch(value: string) {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value) || /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value)
}

export function DomainSearch({ compact = false }: { compact?: boolean }) {
  const { refresh: refreshCart } = useCart()
  const { code: displayCurrency } = useCurrency()
  const priceLabel = usePriceLabel()
  const label = (price: DomainPrice) => priceLabel(price.usd, price.kes)
  const navigate = useNavigate()
  const [domain, setDomain] = useState('')
  const [domainFocused, setDomainFocused] = useState(false)
  const [result, setResult] = useState<DomainSearchResult | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [claimingDomain, setClaimingDomain] = useState<string | null>(null)
  const [preview, setPreview] = useState<DomainSearchResult | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [activeSuggestion, setActiveSuggestion] = useState(-1)
  const [showUnavailable, setShowUnavailable] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const searchRequest = useRef<AbortController | null>(null)
  const requestVersion = useRef(0)
  const suggestionsId = useId()
  const normalized = normalizeSearch(domain)
  const showPreview = domainFocused && !loading && !result && normalized.length >= 2 && validSearch(normalized)

  useEffect(() => {
    setPreview(null)
    setPreviewError('')
    setActiveSuggestion(-1)
    if (!showPreview) { setPreviewLoading(false); return }
    const controller = new AbortController()
    setPreviewLoading(true)
    const timer = window.setTimeout(async () => {
      try {
        const response = await searchDomain(normalized, 1, { signal: controller.signal, suggestionLimit: 7 })
        if (!controller.signal.aborted) setPreview(response)
      } catch (err) {
        if (!controller.signal.aborted) setPreviewError(err instanceof ApiError && err.status === 429 ? 'Please pause a moment before searching again.' : 'Live suggestions are unavailable. Use Search domains to retry.')
      } finally {
        if (!controller.signal.aborted) setPreviewLoading(false)
      }
    }, 800)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [normalized, showPreview])

  useEffect(() => () => { searchRequest.current?.abort() }, [])

  const previewRows = preview ? [
    { domain: preview.domain, available: preview.available, premium: preview.premium, registration_price: preview.prices.register },
    ...(preview.suggestions ?? []),
  ].sort((a, b) => Number(b.available) - Number(a.available)) : (
    normalized.includes('.') ? [normalized] : ['.com', '.net', '.org', '.co', '.io', '.info', '.biz', '.me'].map(extension => `${normalized}${extension}`)
  ).map(name => ({ domain: name, available: undefined, premium: false, registration_price: undefined }))

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (showPreview && activeSuggestion >= 0) {
      const selected = previewRows[activeSuggestion]?.domain
      if (selected) { setDomain(selected); await lookup(selected); return }
    }
    await lookup(normalized)
  }

  async function lookup(query: string) {
    if (!validSearch(query)) {
      setError('Enter your business name or a domain, for example Bright Studio or brightstudio.com.')
      inputRef.current?.focus()
      return
    }
    searchRequest.current?.abort()
    const controller = new AbortController()
    searchRequest.current = controller
    const version = ++requestVersion.current
    setDomainFocused(false)
    setLoading(true)
    setLoadingMore(false)
    setShowUnavailable(false)
    setError('')
    setResult(null)
    try {
      const response = await searchDomain(query, 1, { signal: controller.signal })
      if (version === requestVersion.current) setResult(response)
    } catch (err) {
      if (!controller.signal.aborted && version === requestVersion.current) setError(err instanceof ApiError ? err.message : 'The registrar lookup failed. Try again in a moment.')
    } finally {
      if (version === requestVersion.current) setLoading(false)
    }
  }

  const registerPrice = result?.prices?.register
  const allSuggestions = result?.suggestions ?? []
  const suggestions = allSuggestions.filter(item => showUnavailable || item.available).sort((a, b) => Number(b.available) - Number(a.available))

  async function loadMore() {
    if (!result || result.next_offset == null) return
    const version = requestVersion.current
    const controller = new AbortController()
    searchRequest.current = controller
    setLoadingMore(true)
    setError('')
    try {
      const page = await searchDomain(result.domain, 1, { signal: controller.signal, suggestionOffset: result.next_offset })
      if (version === requestVersion.current) setResult(current => current ? { ...current, next_offset: page.next_offset, suggestions: [...(current.suggestions ?? []), ...(page.suggestions ?? [])] } : current)
    } catch (err) {
      if (!controller.signal.aborted && version === requestVersion.current) setError(err instanceof ApiError ? err.message : 'Could not check more extensions. Please try again.')
    } finally {
      if (version === requestVersion.current) setLoadingMore(false)
    }
  }

  async function claimDomain(targetDomain: string, price: DomainPrice | null | undefined) {
    if (!price) return
    setError('')
    setClaimingDomain(targetDomain)
    try {
      // KES is charged when an exact KES price exists; every other selection is charged in USD.
      await addDomainToCart({ resource_id: price.product_id, domain: targetDomain, billing_cycle: 'annually', currency: displayCurrency === 'KES' && price.kes ? 'KES' : 'USD' })
      await refreshCart()
      navigate('/cart')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not add this domain to your cart.')
    } finally {
      setClaimingDomain(null)
    }
  }

  return (
    <div className={compact ? '' : 'panel-raised p-1.5'} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDomainFocused(false) }}>
      <form onSubmit={submit} aria-busy={loading} className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3 rounded-lg border border-transparent px-4 py-2.5">
          <Search className="size-[18px] shrink-0 text-maven-muted" />
          <div className="relative min-w-0 flex-1">
            <input
              ref={inputRef}
              value={domain}
              onChange={(e) => { searchRequest.current?.abort(); requestVersion.current += 1; setLoading(false); setLoadingMore(false); setDomain(e.target.value); setResult(null); setError(''); setShowUnavailable(false); setDomainFocused(true) }}
              onFocus={() => setDomainFocused(true)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') { setDomainFocused(false); setActiveSuggestion(-1) }
                if (showPreview && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
                  event.preventDefault()
                  setActiveSuggestion(current => event.key === 'ArrowDown' ? (current + 1) % previewRows.length : (current <= 0 ? previewRows.length - 1 : current - 1))
                }
              }}
              placeholder=""
              role="combobox"
              aria-label="Business name or domain"
              aria-autocomplete="list"
              aria-expanded={showPreview}
              aria-controls={showPreview ? suggestionsId : undefined}
              aria-activedescendant={showPreview && activeSuggestion >= 0 ? `${suggestionsId}-${activeSuggestion}` : undefined}
              autoComplete="off"
              spellCheck={false}
              className="w-full min-w-0 bg-transparent text-[15px] text-maven-ink outline-none"
            />
            {!domain && <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 flex items-center text-sm text-maven-muted">Your business name or domain</span>}
          </div>
        </div>
        <button disabled={loading} className="btn btn-primary sm:mr-1.5">
          {loading ? <LoaderCircle className="size-4 animate-spin" /> : null}
          {loading ? 'Searching…' : 'Search domains'}
        </button>
      </form>

      <p className="mx-4 mb-3 mt-1 text-xs text-maven-muted">Start with your business name. We’ll check matching domain extensions. Spaces become hyphens.</p>

      {showPreview && <section className="mx-1.5 mb-3 overflow-hidden rounded-xl border border-maven-line bg-white shadow-lg" aria-label="Suggested domains">
        <div className="flex items-center justify-between gap-2 border-b border-maven-line bg-slate-50 px-4 py-3">
          <span className="text-sm font-semibold text-maven-ink">Find your domain</span>
          <span className="flex items-center gap-1.5 text-xs text-maven-muted" role="status">{previewLoading && <LoaderCircle className="size-3 animate-spin" />}{previewLoading ? 'Checking availability…' : preview ? 'Live availability · price per year' : 'Choose an extension'}</span>
        </div>
        <ul id={suggestionsId} role="listbox" aria-label="Domain suggestions" className="max-h-80 overflow-y-auto divide-y divide-maven-line">
          {previewRows.map((item, index) => <li key={item.domain} role="option" id={`${suggestionsId}-${index}`} aria-selected={activeSuggestion === index}>
            <button type="button" onClick={() => { setDomain(item.domain); void lookup(item.domain) }} className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-sky-50 ${activeSuggestion === index ? 'bg-sky-50' : ''}`}>
              <span className="mono truncate text-sm font-semibold text-maven-ink">{item.domain}</span>
              <span className="shrink-0 text-xs font-medium text-maven-muted">{item.available === undefined ? 'Check availability' : item.premium ? 'Premium' : item.available ? item.registration_price ? `${label(item.registration_price).main} / yr · Available` : 'Available' : 'Taken'}</span>
            </button>
          </li>)}
        </ul>
        {previewError && <p role="status" className="border-t border-maven-line px-4 py-3 text-xs text-maven-muted">{previewError}</p>}
        <button type="button" onClick={() => { void lookup(normalized) }} className="flex w-full items-center justify-between border-t border-maven-line px-4 py-3 text-sm font-semibold text-maven-signal hover:bg-sky-50">Search more extensions <ArrowRight className="size-4" /></button>
      </section>}

      {error && <div role="alert" className="mx-1.5 mb-1.5 rounded-lg bg-red-50 px-4 py-3 text-sm text-maven-danger"><p>{error}</p>{validSearch(normalized) && <><p className="mt-1">Availability has not been confirmed. A failed lookup does not mean the name is registered.</p><button type="button" disabled={loading} onClick={() => { void lookup(normalized) }} className="mt-2 font-semibold underline">Retry availability lookup</button></>}</div>}

      {result && (
        <div className="mx-1.5 mb-1.5 border-t border-maven-line px-4 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <span className={`status-dot ${result.available ? 'is-live' : 'is-off'}`} />
              <div className="min-w-0">
                <p className="break-all text-[15px] font-semibold text-maven-ink">{result.domain}</p>
                <p className="text-[13px] text-maven-muted">{result.message ?? (result.premium ? 'Available as a premium domain' : result.available ? 'Available to register' : 'Already registered')}</p>
              </div>
            </div>
            {result.premium ? <Link to="/contact?type=general" className="btn btn-secondary">Ask about premium domain</Link> : result.available && registerPrice ? (
              <div className="flex items-center gap-4">
                <p className="mono text-sm font-semibold text-maven-ink">{label(registerPrice).main} <span className="font-normal text-maven-muted">per year</span>{label(registerPrice).note && <span className="block text-xs font-normal text-maven-muted">{label(registerPrice).note}</span>}</p>
                <button onClick={() => claimDomain(result.domain, registerPrice)} disabled={claimingDomain !== null} className="btn btn-signal">
                  {claimingDomain === result.domain ? <LoaderCircle className="size-4 animate-spin" /> : null}
                  Add to cart
                </button>
              </div>
            ) : result.available ? <span className="text-xs font-medium text-maven-muted">Price confirmation needed</span> : null}
          </div>

          <p className="mt-3 text-xs leading-6 text-maven-muted">{result.prices.renew ? `Renewal: ${label(result.prices.renew).main} per year.` : 'Renewal price requires confirmation.'} {result.prices.transfer ? `Transfer price: ${label(result.prices.transfer).main}, subject to eligibility.` : 'Transfer and expired-domain recovery fees are confirmed separately.'} Premium names are excluded from ordinary pricing. Review the final total and taxes in your cart.</p>
          <CurrencySelector className="mt-4" />
          {allSuggestions.length > 0 && <section className="mt-5" aria-labelledby={`${suggestionsId}-results`}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h3 role="status" id={`${suggestionsId}-results`} className="text-sm font-semibold text-maven-ink">{allSuggestions.filter(item => item.available).length} available alternatives</h3><label className="flex items-center gap-2 text-xs text-maven-muted"><input type="checkbox" checked={showUnavailable} onChange={event => setShowUnavailable(event.target.checked)} />Show taken domains</label></div>
            {suggestions.length === 0 && <p className="mb-3 text-sm text-maven-muted">No available alternatives in this selection. Try a different business name or extension.</p>}
            <ul className="divide-y divide-maven-line overflow-hidden rounded-xl border border-maven-line bg-white">
              {suggestions.map((suggestion) => {
                const suggestionPrice = suggestion.registration_price
                return <li key={suggestion.domain} className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className={`status-dot ${suggestion.available ? 'is-live' : 'is-off'}`} />
                    <div className="min-w-0"><p className="mono truncate text-sm font-semibold text-maven-ink">{suggestion.domain}</p><p className="text-xs text-maven-muted">{suggestion.premium ? 'Premium · price confirmation required' : suggestion.available ? 'Available to register' : 'Already registered'}</p></div>
                  </div>
                  {suggestion.premium ? <Link to="/contact?type=general" className="inline-flex items-center gap-1 text-sm font-semibold text-maven-signal hover:underline">Ask about this domain <ArrowRight className="size-3.5" /></Link> : suggestion.available && suggestionPrice ? <div className="flex items-center justify-between gap-3 sm:justify-end"><p className="mono text-sm font-semibold text-maven-ink">{label(suggestionPrice).main} <span className="text-xs font-medium text-maven-muted">/ yr</span></p><button type="button" onClick={() => claimDomain(suggestion.domain, suggestionPrice)} disabled={claimingDomain !== null} className="btn btn-signal px-3 py-2">{claimingDomain === suggestion.domain ? <LoaderCircle className="size-4 animate-spin" /> : 'Add to cart'}</button></div> : <span className="text-xs font-medium text-maven-muted">{suggestion.available ? 'Price confirmation needed' : 'Unavailable'}</span>}
                </li>
              })}
            </ul>
            {result.next_offset != null && <button type="button" disabled={loadingMore} onClick={() => { void loadMore() }} className="btn btn-secondary mt-3 w-full">{loadingMore ? <LoaderCircle className="size-4 animate-spin" /> : null}{loadingMore ? 'Checking more extensions…' : 'Explore more extensions'}</button>}
          </section>}
        </div>
      )}
    </div>
  )
}
