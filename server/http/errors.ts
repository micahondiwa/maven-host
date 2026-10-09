/** Errors rendered with the same JSON shapes as the v1 Django REST Framework API. */
export type ErrorBody = Record<string, unknown>

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: ErrorBody,
    readonly headers: Record<string, string> = {},
  ) {
    super(typeof body.detail === 'string' ? body.detail : `HTTP ${status}`)
  }
}

/** DRF `serializers.ValidationError`: `{field: [messages]}` or `{non_field_errors: [...]}`. */
export class ValidationError extends HttpError {
  constructor(readonly errors: Record<string, string[] | Record<string, unknown>>) {
    super(400, errors)
  }

  static field(field: string, message: string) {
    return new ValidationError({ [field]: [message] })
  }

  static nonField(message: string) {
    return new ValidationError({ non_field_errors: [message] })
  }
}

/** Application/domain rule violation, rendered by v1's exception handler as `{"detail": ...}` with 400. */
export class DetailError extends HttpError {
  constructor(detail: unknown, status = 400, code?: string) {
    super(status, code ? { detail, code } : { detail })
  }
}

export const notFound = (detail = 'Not found.') => new HttpError(404, { detail })
export const forbidden = (detail = 'You do not have permission to perform this action.') => new HttpError(403, { detail })
export const notAuthenticated = () =>
  new HttpError(401, { detail: 'Authentication credentials were not provided.' }, { 'WWW-Authenticate': 'Bearer realm="api"' })
export const invalidToken = () =>
  new HttpError(
    401,
    {
      detail: 'Given token not valid for any token type',
      code: 'token_not_valid',
      messages: [{ token_class: 'AccessToken', token_type: 'access', message: 'Token is invalid or expired' }],
    },
    { 'WWW-Authenticate': 'Bearer realm="api"' },
  )
