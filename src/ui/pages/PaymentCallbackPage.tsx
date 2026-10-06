import { useEffect, useState } from 'react'
import { Link } from '@/lib/navigation'
import { CheckCircle2, LoaderCircle, XCircle } from 'lucide-react'
import { CustomerHeader } from '../components/CustomerHeader'
import { SiteFooter } from '../components/SiteFooter'
import { ApiError, verifyPaymentTransaction } from '../lib/api'
import { useCart } from '../lib/cart'

import { SEO } from '../components/SEO'
export function PaymentCallbackPage() {
  const { refresh: refreshCart } = useCart()
  const [status, setStatus] = useState<'checking' | 'success' | 'failed'>('checking')
  const [error, setError] = useState('')
  const [reference, setReference] = useState<string | null>(null)

  useEffect(() => {
    const transactionId = sessionStorage.getItem('mwh_pending_transaction')
    if (!transactionId) {
      setStatus('failed')
      setError('We could not find a payment reference for this session.')
      return
    }
    verifyPaymentTransaction(transactionId)
      .then((result) => {
        sessionStorage.removeItem('mwh_pending_transaction')
        setReference(result.transaction_id)
        if (result.successful || result.status === 'successful') {
          setStatus('success')
          refreshCart()
        } else {
          setStatus('failed')
          setError('The payment provider reported that this payment was not completed.')
        }
      })
      .catch((err) => {
        setStatus('failed')
        setError(err instanceof ApiError ? err.message : 'We could not confirm this payment.')
      })
  }, [refreshCart])

  return (
    <div className="public-page min-h-screen bg-maven-paper">
      <SEO title="Payment status | MavenHost" description="Checking the status of your MavenHost payment." path="/payments/callback" indexable={false} />
      <CustomerHeader />
      <main id="main-content" className="container-shell flex max-w-md flex-col items-center py-20 text-center">
        {status === 'checking' && (
          <>
            <LoaderCircle className="size-10 animate-spin text-maven-signal" />
            <p className="mt-4 font-semibold text-maven-ink">Confirming your payment…</p>
          </>
        )}
        {status === 'success' && (
          <>
            <CheckCircle2 className="size-10 text-emerald-600" />
            <p className="mt-4 text-[17px] font-semibold text-maven-ink">Payment confirmed</p>
            <p className="mt-1 text-sm text-maven-muted">The payment has been recorded. Open the order to check setup progress and any action required.</p>
            <Link to="/account/orders" className="btn btn-primary mt-6">View your orders</Link>
          </>
        )}
        {status === 'failed' && (
          <>
            <XCircle className="size-10 text-maven-danger" />
            <p className="mt-4 text-[17px] font-semibold text-maven-ink">We could not confirm this payment</p>
            <p className="mt-1 text-sm text-maven-muted">{error}{reference ? <span className="mono"> (ref: {reference})</span> : null}</p>
            <Link to="/account/orders" className="btn btn-secondary mt-6">Go to your orders</Link>
          </>
        )}
      </main>
    <SiteFooter />
      </div>
  )
}
