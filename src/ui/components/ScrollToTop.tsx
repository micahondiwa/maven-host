import { useEffect } from 'react'
import { useLocation } from '@/lib/navigation'

/** Keep route navigation predictable while preserving in-page anchor links. */
export function ScrollToTop() {
  const { pathname, search, hash } = useLocation()

  useEffect(() => {
    if (!hash) {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
      return
    }

    const anchorId = decodeURIComponent(hash.slice(1))
    window.requestAnimationFrame(() => {
      document.getElementById(anchorId)?.scrollIntoView()
    })
  }, [pathname, search, hash])

  return null
}
