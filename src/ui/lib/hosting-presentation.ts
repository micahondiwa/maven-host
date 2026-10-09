import { useEffect, useState } from 'react'
import { listHostingPlans, type HostingPlan } from './api'
export const BILLING_TERMS = [{ value: '1-month', label: 'Monthly', cycle: 'monthly' }, { value: '1-year', label: '1 year', cycle: 'annually' }, { value: '2-year', label: '2 years', cycle: 'biennially' }]
export function useHostingCatalog() {
  const [plans, setPlans] = useState<HostingPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => { let current = true; setLoading(true); setError(''); listHostingPlans({ currency: 'USD' }).then(data => { if (current) setPlans(data) }).catch(() => { if (current) setError('The hosting catalog could not be loaded. Try again or contact support for current options.') }).finally(() => { if (current) setLoading(false) }); return () => { current = false } }, [attempt])
  return { plans, loading, error, retry: () => setAttempt(value => value + 1) }
}
export function features(plan: HostingPlan) { return plan.verification_status === 'verified' ? plan.verified_features : plan.proposed_features ?? {} }
export function featureValue(plan: HostingPlan, key: string, unit = '') {
  const v = features(plan)[key]
  if (v === undefined) return 'Confirm before purchase'
  if (typeof v === 'boolean') return v ? 'Included' : key === 'patchman_included' ? 'Optional' : 'Not included'
  if (v === 'unlimited') return 'Unlimited (subject to use limits)'
  return `${typeof v === 'number' ? v.toLocaleString('en-US') : v}${unit}`
}
export function usd(value: string) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value)) }
