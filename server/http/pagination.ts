import { HttpError } from './errors'

/** DRF PageNumberPagination: `{count, next, previous, results}` with absolute next/previous links. */
export function pageParams(url: URL, { pageSize = 25, maxPageSize = 100, sizeParam = 'page_size' as string | null } = {}) {
  let size = pageSize
  const requested = sizeParam ? url.searchParams.get(sizeParam) : null
  if (requested && /^\d+$/.test(requested) && Number(requested) > 0) size = Math.min(Number(requested), maxPageSize)
  const rawPage = url.searchParams.get('page') ?? '1'
  const page = rawPage === 'last' ? -1 : /^\d+$/.test(rawPage) ? Number(rawPage) : NaN
  if (Number.isNaN(page) || page === 0) throw new HttpError(404, { detail: 'Invalid page.' })
  return { page, size }
}

export function paginate<T>(url: URL, count: number, page: number, size: number, results: T[]) {
  const pages = Math.max(1, Math.ceil(count / size))
  const current = page === -1 ? pages : page
  if (current > pages) throw new HttpError(404, { detail: 'Invalid page.' })
  const link = (target: number | null) => {
    if (target === null) return null
    const next = new URL(url)
    if (target === 1) next.searchParams.delete('page')
    else next.searchParams.set('page', String(target))
    return next.toString()
  }
  return {
    count,
    next: link(current < pages ? current + 1 : null),
    previous: link(current > 1 ? current - 1 : null),
    results,
  }
}

/** Resolves the page number and SQL offset, including `?page=last`. */
export function pageWindow(count: number, page: number, size: number) {
  const pages = Math.max(1, Math.ceil(count / size))
  const current = page === -1 ? pages : page
  return { current, offset: (current - 1) * size }
}
