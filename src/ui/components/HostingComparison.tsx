import { useState } from 'react'
import { Check, Minus } from 'lucide-react'
import type { HostingPlan } from '../lib/api'
import { whatsappUrl } from '../lib/site'

type Feature = { key: string; label: string; description?: string; unit?: string; fallback?: string }
const GROUPS: { label: string; features: Feature[] }[] = [
  { label: 'Resources', features: [
    { key: 'websites', label: 'Websites', description: 'Separate websites hosted in one cPanel account.' },
    { key: 'cpu_cores', label: 'CPU cores', description: 'The CPU limit available to your hosting account.' },
    { key: 'memory_gb', label: 'Memory limit', unit: ' GB' },
    { key: 'storage_gb', label: 'NVMe storage', unit: ' GB', fallback: 'storage_mb' },
    { key: 'bandwidth', label: 'Bandwidth', fallback: 'bandwidth_mb' },
  ] },
  { label: 'Email & databases', features: [
    { key: 'max_email_accounts', label: 'Email accounts' },
    { key: 'max_databases', label: 'MySQL databases' },
  ] },
  { label: 'Management & protection', features: [
    { key: 'control_panel', label: 'Control panel' },
    { key: 'ssl', label: 'SSL certificates' },
    { key: 'litespeed', label: 'LiteSpeed web server' },
    { key: 'patchman_included', label: 'Patchman', description: 'Automatically patches supported website software against known vulnerabilities.' },
    { key: 'dedicated_ipv4', label: 'Dedicated IPv4' },
    { key: 'backup_retention', label: 'Backup retention', description: 'Available restore points, subject to the confirmed backup service.' },
  ] },
]

function valueFor(plan: HostingPlan, feature: Feature) {
  const values = plan.verification_status === 'verified' ? plan.verified_features : plan.proposed_features ?? {}
  let value = values[feature.key]
  if (value === undefined && feature.fallback && typeof values[feature.fallback] === 'number') {
    value = `${Number(values[feature.fallback]) / 1024} GB`
  }
  if (value === undefined) return 'To be confirmed'
  if (typeof value === 'boolean') return value ? 'Included' : feature.key === 'patchman_included' ? 'Optional' : 'Not included'
  if (String(value).toLowerCase() === 'unlimited') return 'Unlimited'
  return `${value}${typeof value === 'number' ? feature.unit ?? '' : ''}`
}

export function HostingComparison({ plans, cycle, onChoose }: { plans: HostingPlan[]; cycle: string; onChoose: (plan: HostingPlan) => void }) {
  const [differencesOnly, setDifferencesOnly] = useState(false)
  const pending = plans.some(plan => plan.verification_status !== 'verified')
  const groups = GROUPS.map(group => ({ ...group, features: group.features.filter(feature =>
    !differencesOnly || new Set(plans.map(plan => valueFor(plan, feature))).size > 1) }))
  return (
    <section id="compare-plans" className="mt-14 scroll-mt-40" aria-labelledby="hosting-comparison-title">
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div><p className="text-xs font-bold uppercase tracking-wider text-maven-signal">Find your fit</p><h2 id="hosting-comparison-title" className="mt-2 text-2xl font-semibold tracking-tight text-maven-ink">Compare hosting options</h2><p className="mt-2 max-w-xl text-sm leading-6 text-maven-muted">See the resources and features side by side. Domain registration is purchased separately.</p></div>
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-maven-line bg-white px-3 py-2 text-sm text-maven-ink"><input type="checkbox" checked={differencesOnly} onChange={event => setDifferencesOnly(event.target.checked)} className="size-4 accent-maven-signal" />Show differences only</label>
      </div>
      {pending && <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950"><strong>Preview of proposed plans.</strong> Specifications marked “Proposed” are awaiting confirmation. We’ll confirm your included resources, availability and final price before you order. Unlimited resources are subject to fair-use limits.</div>}
      <p className="mt-4 text-xs text-maven-muted sm:hidden">Swipe across to compare all plans.</p>
      <div role="region" aria-label="Hosting plan comparison, scroll horizontally to see all plans" tabIndex={0} className="mt-4 overflow-x-auto rounded-2xl border border-maven-line bg-white shadow-sm focus-visible:outline-2 focus-visible:outline-maven-signal">
        <table className="w-full min-w-[820px] border-separate border-spacing-0 text-left text-sm">
          <caption className="sr-only">MavenHosting plan resources, protection and availability. Unconfirmed plans show proposed specifications.</caption>
          <thead><tr><th scope="col" className="sticky left-0 z-10 w-48 border-b border-maven-line bg-maven-ink p-5 text-white">Your hosting essentials</th>{plans.map(plan => <th scope="col" key={plan.id} className={`min-w-40 border-b border-maven-line p-5 align-top ${plan.is_featured ? 'bg-maven-signal/10' : 'bg-maven-paper'}`}>
            <span className="block text-base font-semibold text-maven-ink">{plan.name}</span><span className="mt-2 block text-xs font-medium text-maven-muted">{plan.verification_status === 'verified' ? 'Confirmed specifications' : 'Proposed specifications'}</span>
            <span className="mt-3 block font-semibold text-maven-ink">{plan.prices.find(price => price.currency === 'USD' && price.billing_cycle === cycle)?.price ? `$${plan.prices.find(price => price.currency === 'USD' && price.billing_cycle === cycle)!.price} USD · ${cycle.replaceAll('_', ' ')}` : 'Price on request'}</span>
          </th>)}</tr></thead>
          <tbody>{groups.filter(group => group.features.length).map(group => <ComparisonGroup key={group.label} group={group} plans={plans} />)}
            {groups.every(group => !group.features.length) && <tr><td colSpan={plans.length + 1} className="p-6 text-center text-maven-muted">These plans have the same listed features. Turn off “Show differences only” to see them.</td></tr>}
            <tr><th scope="row" className="sticky left-0 z-10 border-t border-maven-line bg-white p-5 font-medium text-maven-ink">Availability</th>{plans.map(plan => <td key={plan.id} className="border-t border-maven-line p-5 text-maven-muted">{plan.requires_quote ? 'Enquire with our team' : 'Ready to order'}</td>)}</tr>
            <tr><th scope="row" className="sticky left-0 z-10 border-t border-maven-line bg-white p-5 font-medium text-maven-ink">Next step</th>{plans.map(plan => <td key={plan.id} className="border-t border-maven-line p-4">{plan.requires_quote ? <a href={whatsappUrl(`Hello MavenHost, I compared the hosting options. Please confirm the specifications and price for ${plan.name}.`)} target="_blank" rel="noreferrer noopener" className="btn btn-primary w-full text-xs">Enquire about this plan</a> : <button type="button" onClick={() => onChoose(plan)} disabled={!plan.prices.some(price => price.currency === 'USD' && price.billing_cycle === cycle)} className="btn btn-primary w-full text-xs disabled:opacity-40">Choose this plan</button>}</td>)}</tr>
          </tbody>
        </table>
      </div>
    </section>
  )
}

function ComparisonGroup({ group, plans }: { group: { label: string; features: Feature[] }; plans: HostingPlan[] }) {
  return <><tr><th colSpan={plans.length + 1} className="border-t border-maven-line bg-maven-paper px-5 py-3 text-xs font-bold uppercase tracking-wider text-maven-signal">{group.label}</th></tr>{group.features.map(feature => <tr key={feature.key} className="group"><th scope="row" className="sticky left-0 z-10 border-t border-maven-line bg-white p-5 font-medium text-maven-ink group-hover:bg-slate-50">{feature.label}{feature.description && <span className="mt-1 block max-w-44 text-xs font-normal leading-5 text-maven-muted">{feature.description}</span>}</th>{plans.map(plan => { const value = valueFor(plan, feature); return <td key={plan.id} className={`border-t border-maven-line p-5 ${plan.is_featured ? 'bg-maven-signal/5' : 'group-hover:bg-slate-50'} text-maven-ink`}>{value === 'Included' ? <span className="inline-flex items-center gap-2"><Check aria-hidden="true" className="size-4 text-maven-signal" />Included</span> : value === 'Not included' ? <span className="inline-flex items-center gap-2 text-maven-muted"><Minus aria-hidden="true" className="size-4" />Not included</span> : value}</td> })}</tr>)}</>
}
