import 'server-only'
import { HttpError, notAuthenticated } from './errors'
import { checkThrottle } from './throttle'
import { normalizeUuid } from './validation'

/**
 * Django-style URL dispatch for `/api/v1/...`. Patterns use Django converters (`<uuid:pk>`, `<int:id>`,
 * `<slug:slug>`, `<str:name>`, `<path:p>`) so route tables can be read side by side with the v1 `urls.py` files.
 */

export type AuthUser = {
  id: string
  email: string
  first_name: string
  last_name: string
  is_active: boolean
  is_staff: boolean
  is_superuser: boolean
  is_email_verified: boolean
  date_joined: Date
  password: string
  last_login: Date | null
}

export type Authenticator = (request: Request) => Promise<AuthUser | null>

export class Context {
  private parsedBody: unknown
  private bodyRead = false
  user: AuthUser | null = null

  constructor(
    readonly request: Request,
    readonly url: URL,
    readonly params: Record<string, string>,
  ) {}

  get query() {
    return this.url.searchParams
  }

  get method() {
    return this.request.method
  }

  header(name: string) {
    return this.request.headers.get(name)
  }

  /** Client address for throttling; trusts only the configured number of proxy hops. */
  get ip(): string {
    const hops = Number.parseInt(process.env.TRUSTED_PROXY_HOPS ?? '1', 10) || 0
    const forwarded = (this.header('x-forwarded-for') ?? '').split(',').map((part) => part.trim()).filter(Boolean)
    if (hops > 0 && forwarded.length) return forwarded[Math.max(forwarded.length - hops, 0)]
    return this.header('x-real-ip') ?? '127.0.0.1'
  }

  get authenticatedUser(): AuthUser {
    if (!this.user) throw notAuthenticated()
    return this.user
  }

  private raw?: Buffer

  /** Exact request bytes (webhook signatures are computed over them). */
  async rawBody(): Promise<Buffer> {
    if (!this.raw) this.raw = Buffer.from(await this.request.arrayBuffer())
    return this.raw
  }

  async body<T = Record<string, unknown>>(): Promise<T> {
    if (!this.bodyRead) {
      this.bodyRead = true
      const text = (await this.rawBody()).toString('utf8')
      if (!text.trim()) this.parsedBody = {}
      else {
        const type = this.header('content-type') ?? ''
        if (type.includes('application/x-www-form-urlencoded')) this.parsedBody = Object.fromEntries(new URLSearchParams(text))
        else {
          try {
            this.parsedBody = JSON.parse(text)
          } catch (error) {
            throw new HttpError(400, { detail: `JSON parse error - ${(error as Error).message}` })
          }
        }
      }
    }
    return this.parsedBody as T
  }
}

export type Permission = (ctx: Context) => boolean | Promise<boolean>

export type RouteOptions = {
  /** Default: authentication runs when an Authorization header is present (DRF JWTAuthentication). */
  authenticate?: boolean
  /** Permission checks; every one must pass. Default: IsAuthenticated (the v1 DRF default). */
  permissions?: Permission[]
  /** DRF ScopedRateThrottle scope. */
  throttle?: string
  /** Message for a failed permission, overriding DRF's default. */
  permissionDenied?: string
}

export type Handler = (ctx: Context) => Promise<Response | unknown> | Response | unknown

type Route = { method: string; regex: RegExp; names: string[]; converters: string[]; handler: Handler; options: RouteOptions }

const CONVERTERS: Record<string, string> = {
  str: '[^/]+',
  int: '[0-9]+',
  slug: '[-a-zA-Z0-9_]+',
  uuid: '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
  path: '.+',
}

export const AllowAny: Permission = () => true
export const IsAuthenticated: Permission = (ctx) => ctx.user !== null

export class Router {
  private routes: Route[] = []

  private static compile(pattern: string) {
    const names: string[] = []
    const converters: string[] = []
    const source = pattern.replace(/[.*+?^${}()|[\]\\]/g, (char) => `\\${char}`).replace(
      /<(?:(\w+):)?(\w+)>/g,
      (_, converter = 'str', name) => {
        names.push(name)
        converters.push(converter)
        return `(${CONVERTERS[converter] ?? CONVERTERS.str})`
      },
    )
    return { source, names, converters }
  }

  add(method: string | string[], pattern: string, handler: Handler, options: RouteOptions = {}) {
    const { source, names, converters } = Router.compile(pattern)
    for (const verb of Array.isArray(method) ? method : [method])
      this.routes.push({ method: verb.toUpperCase(), regex: new RegExp(`^${source}$`), names, converters, handler, options })
    return this
  }

  get(pattern: string, handler: Handler, options?: RouteOptions) {
    return this.add('GET', pattern, handler, options)
  }
  post(pattern: string, handler: Handler, options?: RouteOptions) {
    return this.add('POST', pattern, handler, options)
  }
  patch(pattern: string, handler: Handler, options?: RouteOptions) {
    return this.add('PATCH', pattern, handler, options)
  }
  put(pattern: string, handler: Handler, options?: RouteOptions) {
    return this.add('PUT', pattern, handler, options)
  }
  delete(pattern: string, handler: Handler, options?: RouteOptions) {
    return this.add('DELETE', pattern, handler, options)
  }

  /** Mounts another router under `prefix`, which may itself contain converters (e.g. `<uuid:customer_id>`). */
  include(prefix: string, router: Router) {
    const compiled = Router.compile(prefix)
    for (const route of router.routes) {
      const inner = route.regex.source.replace(/^\^/, '')
      this.routes.push({ ...route, regex: new RegExp(`^${compiled.source}${inner}`), names: [...compiled.names, ...route.names], converters: [...compiled.converters, ...route.converters] })
    }
    return this
  }

  match(method: string, path: string) {
    let pathMatched = false
    const allowed = new Set<string>()
    for (const route of this.routes) {
      const match = route.regex.exec(path)
      if (!match) continue
      pathMatched = true
      allowed.add(route.method)
      if (route.method !== method && !(method === 'HEAD' && route.method === 'GET')) continue
      const params: Record<string, string> = {}
      route.names.forEach((name, index) => {
        const raw = decodeURIComponent(match[index + 1])
        params[name] = route.converters[index] === 'uuid' ? normalizeUuid(raw) ?? raw : raw
      })
      return { kind: 'route' as const, route, params }
    }
    return pathMatched ? { kind: 'method' as const, allowed: [...allowed] } : null
  }

  async dispatch(request: Request, path: string, authenticator: Authenticator, unmatched?: () => Response): Promise<Response> {
    const method = request.method.toUpperCase()
    try {
      const found = this.match(method, path)
      if (!found && unmatched) return unmatched()
      if (!found) throw new HttpError(404, { detail: 'Not found.' })
      if (found.kind === 'method') {
        if (method === 'OPTIONS') return new Response(null, { status: 200, headers: { Allow: [...found.allowed, 'OPTIONS'].join(', ') } })
        throw new HttpError(405, { detail: `Method "${method}" not allowed.` }, { Allow: found.allowed.join(', ') })
      }
      const { route, params } = found
      const ctx = new Context(request, new URL(request.url), params)
      const options = route.options
      if (options.authenticate !== false) ctx.user = await authenticator(request)
      for (const permission of options.permissions ?? [IsAuthenticated]) {
        if (!(await permission(ctx))) {
          if (!ctx.user && options.authenticate !== false) throw notAuthenticated()
          throw new HttpError(403, { detail: options.permissionDenied ?? 'You do not have permission to perform this action.' })
        }
      }
      if (options.throttle) checkThrottle(options.throttle, ctx.user ? `user:${ctx.user.id}` : `ip:${ctx.ip}`)
      const result = await route.handler(ctx)
      if (result instanceof Response) return result
      if (result === undefined) return new Response(null, { status: 204 })
      return json(result)
    } catch (error) {
      if (error instanceof HttpError) return json(error.body, error.status, error.headers)
      console.error('Unhandled API error', error)
      return json({ detail: 'A server error occurred.' }, 500)
    }
  }
}

/** JSON response with DRF-compatible serialisation of dates. */
export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body, replacer), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Authorization', ...headers },
  })
}

function replacer(this: Record<string, unknown>, key: string, value: unknown) {
  const original = this[key]
  return original instanceof Date ? formatDateTime(original) : value
}

/** DRF renders aware datetimes in TIME_ZONE (Africa/Nairobi, UTC+3 with no daylight saving). */
export function formatDateTime(date: Date): string {
  const shifted = new Date(date.getTime() + 3 * 3600_000)
  const iso = shifted.toISOString()
  const millis = iso.slice(20, 23)
  return `${iso.slice(0, 19)}${millis === '000' ? '' : `.${millis}000`}+03:00`
}

export const created = (body: unknown) => json(body, 201)
