/**
 * Request validation with Django REST Framework field semantics and messages, so the existing client receives the
 * same `{field: ["message"]}` errors it received from v1.
 */
import { ValidationError } from './errors'

const SKIP = Symbol('skip')
type Parsed<T> = T | typeof SKIP

class FieldError extends Error {
  constructor(readonly detail: string[] | Record<string, unknown>) {
    super('field error')
  }
}
const fail = (message: string): never => {
  throw new FieldError([message])
}

export type FieldOptions<T> = {
  required?: boolean
  allowNull?: boolean
  default?: T | (() => T)
  validate?: (value: T) => T | void
}

export abstract class Field<T> {
  constructor(protected readonly options: FieldOptions<T> = {}) {}

  get required() {
    return this.options.required ?? this.options.default === undefined
  }

  /** Converts a raw JSON value; throws FieldError with DRF-format messages. */
  protected abstract convert(value: unknown): T

  run(value: unknown, present: boolean, partial: boolean): Parsed<T | null> {
    if (!present) {
      if (partial) return SKIP
      if (this.options.default !== undefined) {
        const fallback = this.options.default
        return typeof fallback === 'function' ? (fallback as () => T)() : fallback
      }
      if (this.required) fail('This field is required.')
      return SKIP
    }
    if (value === null) {
      if (this.options.allowNull) return null
      fail('This field may not be null.')
    }
    const converted = this.convert(value)
    const replaced = this.options.validate?.(converted)
    return replaced === undefined ? converted : replaced
  }

  optional(): Field<T> {
    return this.with({ required: false })
  }

  nullable(): Field<T> {
    return this.with({ allowNull: true })
  }

  check(validate: (value: T) => T | void): Field<T> {
    return this.with({ validate })
  }

  protected with(options: FieldOptions<T>): this {
    const clone = Object.create(Object.getPrototypeOf(this)) as this
    Object.assign(clone, this)
    ;(clone as unknown as { options: FieldOptions<T> }).options = { ...this.options, ...options }
    return clone
  }
}

type StringOptions = FieldOptions<string> & { allowBlank?: boolean; trim?: boolean; minLength?: number; maxLength?: number }

class StringField extends Field<string> {
  constructor(protected readonly options: StringOptions = {}) {
    super(options)
  }

  protected convert(value: unknown): string {
    if (typeof value === 'boolean' || !['string', 'number'].includes(typeof value)) fail('Not a valid string.')
    let text = String(value)
    if (this.options.trim !== false) text = text.trim()
    if (text === '') {
      if (this.options.allowBlank) return ''
      fail('This field may not be blank.')
    }
    if (this.options.maxLength !== undefined && text.length > this.options.maxLength)
      fail(`Ensure this field has no more than ${this.options.maxLength} characters.`)
    if (this.options.minLength !== undefined && text.length < this.options.minLength)
      fail(`Ensure this field has at least ${this.options.minLength} characters.`)
    return this.refine(text)
  }

  protected refine(text: string): string {
    return text
  }
}

// Django EmailValidator: dot-atom local part and a hostname domain with an alphabetic-or-IDN top-level label.
const EMAIL_USER = /^[-!#$%&'*+/=?^_`{}|~0-9A-Z]+(\.[-!#$%&'*+/=?^_`{}|~0-9A-Z]+)*$|^"([\x01-\x08\x0b\x0c\x0e-\x1f!#-[\]-\x7f]|\\[\x01-\x09\x0b\x0c\x0d-\x7f])*"$/i
const EMAIL_DOMAIN = /^((?:[a-z0-9¡-￿](?:[a-z0-9¡-￿-]{0,61}[a-z0-9¡-￿])?\.)+)(?:[a-z¡-￿-]{2,63}|xn--[a-z0-9]{1,59})\.?$/i

export function isValidEmail(value: string): boolean {
  if (!value || value.length > 320 || !value.includes('@')) return false
  const at = value.lastIndexOf('@')
  const user = value.slice(0, at)
  const domain = value.slice(at + 1)
  if (!EMAIL_USER.test(user)) return false
  return domain === 'localhost' || EMAIL_DOMAIN.test(domain)
}

class EmailField extends StringField {
  protected refine(text: string): string {
    if (!isValidEmail(text)) fail('Enter a valid email address.')
    return text
  }
}

class ChoiceField<T extends string> extends Field<T> {
  constructor(
    private readonly choices: readonly T[],
    protected readonly options: FieldOptions<T> & { allowBlank?: boolean } = {},
  ) {
    super(options)
  }

  protected convert(value: unknown): T {
    if (value === '' && this.options.allowBlank) return '' as T
    const text = typeof value === 'string' || typeof value === 'number' ? String(value) : ''
    if (!(this.choices as readonly string[]).includes(text)) fail(`"${displayValue(value)}" is not a valid choice.`)
    return text as T
  }
}

class BooleanField extends Field<boolean> {
  protected convert(value: unknown): boolean {
    if ([true, 'true', 'True', 'TRUE', 'yes', 'Yes', 'on', 'On', 'y', 'Y', '1', 1].includes(value as never)) return true
    if ([false, 'false', 'False', 'FALSE', 'no', 'No', 'off', 'Off', 'n', 'N', '0', 0].includes(value as never)) return false
    return fail('Must be a valid boolean.')
  }
}

type IntegerOptions = FieldOptions<number> & { min?: number; max?: number }

class IntegerField extends Field<number> {
  constructor(protected readonly options: IntegerOptions = {}) {
    super(options)
  }

  protected convert(value: unknown): number {
    const text = typeof value === 'string' ? value.trim() : value
    const number = typeof text === 'number' ? text : typeof text === 'string' && /^-?\d+(\.0*)?$/.test(text) ? Number(text) : NaN
    if (typeof value === 'boolean' || !Number.isSafeInteger(number)) fail('A valid integer is required.')
    if (this.options.max !== undefined && number > this.options.max)
      fail(`Ensure this value is less than or equal to ${this.options.max}.`)
    if (this.options.min !== undefined && number < this.options.min)
      fail(`Ensure this value is greater than or equal to ${this.options.min}.`)
    return number
  }
}

type DecimalOptions = FieldOptions<string> & { maxDigits: number; decimalPlaces: number; min?: string; max?: string }

/** Decimal values stay strings so money never passes through binary floating point. */
class DecimalField extends Field<string> {
  constructor(protected readonly options: DecimalOptions) {
    super(options)
  }

  protected convert(value: unknown): string {
    const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : ''
    const match = /^([-+]?)(\d*)(?:\.(\d*))?$/.exec(text)
    if (typeof value === 'boolean' || !match || (match[2] === '' && !match[3])) fail('A valid number is required.')
    const [, sign, rawWhole, rawFraction = ''] = match!
    const whole = rawWhole.replace(/^0+(?=\d)/, '') || '0'
    const fraction = rawFraction.replace(/0+$/, '')
    const wholeDigits = whole === '0' ? 0 : whole.length
    if (wholeDigits + fraction.length > this.options.maxDigits)
      fail(`Ensure that there are no more than ${this.options.maxDigits} digits in total.`)
    if (fraction.length > this.options.decimalPlaces)
      fail(`Ensure that there are no more than ${this.options.decimalPlaces} decimal places.`)
    if (wholeDigits > this.options.maxDigits - this.options.decimalPlaces)
      fail(`Ensure that there are no more than ${this.options.maxDigits - this.options.decimalPlaces} digits before the decimal point.`)
    const normalized = `${sign === '-' ? '-' : ''}${whole}.${fraction.padEnd(this.options.decimalPlaces, '0')}`
    if (this.options.min !== undefined && compareDecimal(normalized, this.options.min) < 0)
      fail(`Ensure this value is greater than or equal to ${this.options.min}.`)
    if (this.options.max !== undefined && compareDecimal(normalized, this.options.max) > 0)
      fail(`Ensure this value is less than or equal to ${this.options.max}.`)
    return normalized
  }
}

export function compareDecimal(a: string, b: string): number {
  const scale = (value: string) => {
    const [whole, fraction = ''] = value.replace(/^-/, '').split('.')
    const magnitude = BigInt(whole || '0') * 10n ** 12n + BigInt((fraction + '0'.repeat(12)).slice(0, 12))
    return value.startsWith('-') ? -magnitude : magnitude
  }
  const difference = scale(a) - scale(b)
  return difference === 0n ? 0 : difference > 0n ? 1 : -1
}

const UUID_PATTERN = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i

export function normalizeUuid(value: string): string | null {
  const text = value.trim().replace(/^urn:uuid:/i, '').replace(/^\{(.*)\}$/, '$1')
  if (!UUID_PATTERN.test(text)) return null
  const hex = text.replace(/-/g, '').toLowerCase()
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

class UuidField extends Field<string> {
  protected convert(value: unknown): string {
    const normalized = typeof value === 'string' ? normalizeUuid(value) : null
    return normalized ?? fail('Must be a valid UUID.')
  }
}

class ListField<T> extends Field<T[]> {
  constructor(
    private readonly child: Field<T>,
    protected readonly options: FieldOptions<T[]> & { allowEmpty?: boolean; maxLength?: number } = {},
  ) {
    super(options)
  }

  protected convert(value: unknown): T[] {
    if (typeof value === 'string' || !Array.isArray(value)) fail(`Expected a list of items but got type "${pythonType(value)}".`)
    const items = value as unknown[]
    if (items.length === 0 && this.options.allowEmpty === false) fail('This list may not be empty.')
    if (this.options.maxLength !== undefined && items.length > this.options.maxLength)
      fail(`Ensure this field has no more than ${this.options.maxLength} elements.`)
    const errors: Record<string, unknown> = {}
    const result: T[] = []
    items.forEach((item, index) => {
      try {
        result.push(this.child.run(item, true, false) as T)
      } catch (error) {
        if (!(error instanceof FieldError)) throw error
        errors[index] = error.detail
      }
    })
    if (Object.keys(errors).length) throw new FieldError(errors)
    return result
  }
}

class DictField extends Field<Record<string, unknown>> {
  protected convert(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      fail(`Expected a dictionary of items but got type "${pythonType(value)}".`)
    return value as Record<string, unknown>
  }
}

class JsonField extends Field<unknown> {
  protected convert(value: unknown): unknown {
    return value
  }
}

class DateField extends Field<string> {
  protected convert(value: unknown): string {
    const text = typeof value === 'string' ? value.trim() : ''
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`)))
      fail('Date has wrong format. Use one of these formats instead: YYYY-MM-DD.')
    return text
  }
}

class DateTimeField extends Field<Date> {
  protected convert(value: unknown): Date {
    const text = typeof value === 'string' ? value.trim() : ''
    const parsed = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})?$/.test(text) ? new Date(text) : null
    if (!parsed || Number.isNaN(parsed.getTime()))
      fail('Datetime has wrong format. Use one of these formats instead: YYYY-MM-DDThh:mm[:ss[.uuuuuu]][+HH:MM|-HH:MM|Z].')
    return parsed!
  }
}

class UrlField extends StringField {
  protected refine(text: string): string {
    try {
      const url = new URL(text)
      if (!['http:', 'https:', 'ftp:', 'ftps:'].includes(url.protocol) || !url.hostname.includes('.') && url.hostname !== 'localhost')
        fail('Enter a valid URL.')
    } catch (error) {
      if (error instanceof FieldError) throw error
      fail('Enter a valid URL.')
    }
    return text
  }
}

function pythonType(value: unknown): string {
  if (value === null) return 'NoneType'
  if (Array.isArray(value)) return 'list'
  if (typeof value === 'string') return 'str'
  if (typeof value === 'number') return Number.isInteger(value) ? 'int' : 'float'
  if (typeof value === 'boolean') return 'bool'
  return 'dict'
}

function displayValue(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value ? 'True' : 'False'
  if (value === null) return 'None'
  return JSON.stringify(value)
}

export const f = {
  string: (options: StringOptions = {}) => new StringField(options),
  email: (options: StringOptions = {}) => new EmailField(options),
  choice: <T extends string>(choices: readonly T[], options: FieldOptions<T> & { allowBlank?: boolean } = {}) =>
    new ChoiceField<T>(choices, options),
  boolean: (options: FieldOptions<boolean> = {}) => new BooleanField(options),
  integer: (options: IntegerOptions = {}) => new IntegerField(options),
  decimal: (options: DecimalOptions) => new DecimalField(options),
  uuid: (options: FieldOptions<string> = {}) => new UuidField(options),
  list: <T>(child: Field<T>, options: FieldOptions<T[]> & { allowEmpty?: boolean; maxLength?: number } = {}) =>
    new ListField<T>(child, options),
  dict: (options: FieldOptions<Record<string, unknown>> = {}) => new DictField(options),
  json: (options: FieldOptions<unknown> = {}) => new JsonField(options),
  date: (options: FieldOptions<string> = {}) => new DateField(options),
  datetime: (options: FieldOptions<Date> = {}) => new DateTimeField(options),
  url: (options: StringOptions = {}) => new UrlField(options),
}

export type Schema = Record<string, Field<unknown>>
type FieldValue<F> = F extends Field<infer T> ? T : never
export type Validated<S extends Schema> = { [K in keyof S]: FieldValue<S[K]> }

/**
 * Validates `data` against `schema` like `Serializer.is_valid(raise_exception=True)`: unknown keys are ignored,
 * field errors are collected together, then `validate` runs for object-level rules.
 */
export function validate<S extends Schema>(
  schema: S,
  data: unknown,
  options: { partial?: boolean; validate?: (values: Validated<S>) => void } = {},
): Validated<S> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new ValidationError({ non_field_errors: [`Invalid data. Expected a dictionary, but got ${pythonType(data)}.`] })
  }
  const record = data as Record<string, unknown>
  const values: Record<string, unknown> = {}
  const errors: Record<string, string[] | Record<string, unknown>> = {}
  for (const [name, field] of Object.entries(schema)) {
    try {
      const parsed = field.run(record[name], Object.prototype.hasOwnProperty.call(record, name) && record[name] !== undefined, Boolean(options.partial))
      if (parsed !== SKIP) values[name] = parsed
    } catch (error) {
      if (!(error instanceof FieldError)) throw error
      errors[name] = error.detail
    }
  }
  if (Object.keys(errors).length) throw new ValidationError(errors)
  options.validate?.(values as Validated<S>)
  return values as Validated<S>
}

/** Raised from `validate` callbacks for a single field, mirroring `raise ValidationError({field: msg})`. */
export function fieldError(field: string, message: string): never {
  throw ValidationError.field(field, message)
}

/** Raised from `validate` callbacks without a field, mirroring `raise ValidationError(msg)` in `Serializer.validate`. */
export function nonFieldError(message: string): never {
  throw ValidationError.nonField(message)
}
