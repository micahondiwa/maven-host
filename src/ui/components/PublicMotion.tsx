import { useEffect } from 'react'
import { useLocation } from '@/lib/navigation'

/** One-time entry motion for editorial content, never transactional controls. */
export function PublicMotion() {
  const { pathname, search } = useLocation()
  useEffect(() => {
    const main = document.querySelector<HTMLElement>('.public-page main')
    if (!main || !('IntersectionObserver' in window)) return
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const tracked = new Set<HTMLElement>()
    let intersection: IntersectionObserver | undefined
    let mutations: MutationObserver | undefined
    function clear() {
      intersection?.disconnect()
      mutations?.disconnect()
      tracked.forEach(element => {
        element.removeAttribute('data-reveal')
        element.style.removeProperty('--reveal-delay')
      })
      tracked.clear()
    }
    function start() {
      clear()
      if (preference.matches) return
      intersection = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return
          entry.target.setAttribute('data-reveal', 'shown')
          intersection?.unobserve(entry.target)
        })
      }, { threshold: 0.08, rootMargin: '0px 0px -24px 0px' })
      function collect() {
        const candidates = main!.querySelectorAll<HTMLElement>('.service-summary, article.panel, .steps-list li')
        candidates.forEach((element, index) => {
          if (tracked.has(element)) return
          tracked.add(element)
          // Above-the-fold content renders immediately; no entry delay for LCP.
          if (element.getBoundingClientRect().top < window.innerHeight - 24) return
          element.style.setProperty('--reveal-delay', `${(index % 4) * 45}ms`)
          element.setAttribute('data-reveal', 'pending')
          intersection?.observe(element)
        })
      }
      collect()
      mutations = new MutationObserver(collect)
      mutations.observe(main!, { childList: true, subtree: true })
    }
    start()
    preference.addEventListener('change', start)
    return () => { clear(); preference.removeEventListener('change', start) }
  }, [pathname, search])
  return null
}
