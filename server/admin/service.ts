import 'server-only'
import { randomUUID } from 'node:crypto'
import { database, query, queryOne, transaction, type Queryable } from '../db'
import { DetailError, notFound, ValidationError } from '../http/errors'
import { paginate, pageParams, pageWindow } from '../http/pagination'
import { normalizeUuid } from '../http/validation'
import { hasPerm } from '../auth/permissions'
import { audit } from '../audit/audit'
import { encryptProviderSecret } from '../lib/fernet'
import type { AuthUser } from '../http/router'
import { RESOURCES, resourceByKey, type Field, type Resource } from './registry'

/** Generic list/detail/create/update/action service behind the staff administration pages. */

const ident = (name: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Unsafe identifier: ${name}`)
  return `"${name}"`
}

async function holdsAll(user: AuthUser, codes: string[]) {
  for (const code of codes) if (!(await hasPerm(user, code))) return false
  return true
}

export async function canView(user: AuthUser, resource: Resource) {
  return user.is_staff && (await holdsAll(user, resource.view))
}

export async function canManage(user: AuthUser, resource: Resource) {
  return Boolean(user.is_staff && resource.manage && (await holdsAll(user, resource.manage)))
}

/** Resource for a staff member, or 404 when it does not exist or is not visible to them. */
export async function visibleResource(user: AuthUser, key: string) {
  const resource = resourceByKey(key)
  if (!resource || !(await canView(user, resource))) throw notFound()
  return resource
}

export async function listResources(user: AuthUser) {
  const visible = []
  for (const resource of RESOURCES)
    if (await canView(user, resource))
      visible.push({ key: resource.key, label: resource.label, group: resource.group, description: resource.description, can_manage: await canManage(user, resource) })
  return visible
}

function fieldMeta(field: Field) {
  return {
    name: field.name, label: field.label, type: field.type, editable: Boolean(field.editable), required: Boolean(field.required), nullable: Boolean(field.nullable),
    choices: field.choices ?? null, help: field.help ?? null, max_length: field.maxLength ?? null, decimal_places: field.decimalPlaces ?? null, min: field.min ?? null,
  }
}

export async function resourceMeta(user: AuthUser, resource: Resource) {
  const manage = await canManage(user, resource)
  return {
    key: resource.key, label: resource.label, group: resource.group, description: resource.description, pk: resource.pk,
    fields: resource.fields.map(fieldMeta), list: resource.list, filters: resource.filters ?? [], searchable: Boolean(resource.search?.length),
    can_manage: manage, can_create: manage && Boolean(resource.createDefaults),
    actions: manage ? (resource.actions ?? []).map((action) => ({ name: action.name, label: action.label, confirm: action.confirm ?? null })) : [],
  }
}

function selectSql(resource: Resource) {
  const columns = [`t.${ident('id')}`]
  for (const field of resource.fields) {
    if (field.type === 'secret') columns.push(`(t.${ident(field.name)} <> '') AS ${ident(`${field.name}__set`)}`)
    else if (field.name !== 'id') columns.push(`t.${ident(field.name)}`)
    if (field.type === 'ref' && field.ref) columns.push(`(SELECT ${field.ref.label} FROM ${ident(field.ref.table)} r WHERE r.id = t.${ident(field.name)}) AS ${ident(`${field.name}__label`)}`)
  }
  return `SELECT ${columns.join(', ')} FROM ${ident(resource.table)} t`
}

function present(resource: Resource, row: Record<string, unknown>) {
  const out: Record<string, unknown> = { id: row.id }
  for (const field of resource.fields) {
    if (field.type === 'secret') out[field.name] = row[`${field.name}__set`] ? '••••••••' : ''
    else out[field.name] = row[field.name] ?? null
    if (field.type === 'ref') out[`${field.name}__label`] = row[`${field.name}__label`] ?? null
  }
  return out
}

function parseId(resource: Resource, raw: string) {
  if (resource.pk === 'bigint') {
    if (!/^\d{1,18}$/.test(raw)) throw notFound()
    return raw
  }
  const id = normalizeUuid(raw)
  if (!id) throw notFound()
  return id
}

export async function listRecords(resource: Resource, url: URL) {
  const where: string[] = []
  const params: unknown[] = []
  const search = (url.searchParams.get('search') ?? '').trim()
  if (search && resource.search?.length) {
    params.push(`%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`)
    where.push(`(${resource.search.map((name) => `t.${ident(name)}::text ILIKE $${params.length}`).join(' OR ')})`)
  }
  for (const name of resource.filters ?? []) {
    const value = url.searchParams.get(`filter_${name}`)
    if (value === null || value === '') continue
    const field = resource.fields.find((item) => item.name === name)!
    if (field.type === 'boolean') {
      if (!['true', 'false'].includes(value)) continue
      params.push(value === 'true')
    } else params.push(value)
    where.push(`t.${ident(name)}::text = $${params.length}::text`)
  }
  const clause = where.length ? ` WHERE ${where.join(' AND ')}` : ''
  const count = (await queryOne<{ n: number }>(`SELECT count(*)::integer AS n FROM ${ident(resource.table)} t${clause}`, params))!.n
  const { page, size } = pageParams(url, { pageSize: 25, maxPageSize: 100 })
  const { current, offset } = pageWindow(count, page, size)
  const rows = await query<Record<string, unknown>>(`${selectSql(resource)}${clause} ORDER BY ${resource.order.split(',').map((part) => `t.${part.trim()}`).join(', ')} LIMIT ${size} OFFSET ${offset}`, params)
  return paginate(url, count, current, size, rows.map((row) => present(resource, row)))
}

export async function recordDetail(resource: Resource, rawId: string, db: Queryable = database()) {
  const row = await queryOne<Record<string, unknown>>(`${selectSql(resource)} WHERE t.id = $1`, [parseId(resource, rawId)], db)
  if (!row) throw notFound()
  return present(resource, row)
}

/** Options for a reference field (forms and filters). */
export async function refOptions(resource: Resource, name: string) {
  const field = resource.fields.find((item) => item.name === name && item.type === 'ref')
  if (!field?.ref) throw notFound()
  return query<{ value: string; label: string }>(
    `SELECT r.id::text AS value, (${field.ref.label})::text AS label FROM ${ident(field.ref.table)} r${field.ref.where ? ` WHERE ${field.ref.where}` : ''} ORDER BY 2 LIMIT 500`,
  )
}

async function coerce(field: Field, value: unknown, db: Queryable): Promise<unknown> {
  if (value === null || value === undefined || value === '') {
    if (field.type === 'boolean') return false
    if (field.nullable) return null
    if (field.type === 'text' || field.type === 'longtext') return ''
    throw 'This field is required.'
  }
  switch (field.type) {
    case 'text':
    case 'longtext': {
      if (typeof value !== 'string') throw 'Not a valid string.'
      const text = field.type === 'text' ? value.trim() : value
      if (field.maxLength && text.length > field.maxLength) throw `Ensure this field has no more than ${field.maxLength} characters.`
      return text
    }
    case 'boolean':
      if (typeof value !== 'boolean') throw 'Must be a valid boolean.'
      return value
    case 'integer': {
      const number = typeof value === 'number' ? value : Number(String(value))
      if (!Number.isInteger(number)) throw 'A valid integer is required.'
      if (field.min !== undefined && number < field.min) throw `Ensure this value is greater than or equal to ${field.min}.`
      return number
    }
    case 'decimal': {
      const text = String(value).trim()
      const places = field.decimalPlaces ?? 2
      if (!new RegExp(`^\\d{1,10}(\\.\\d{1,${places}})?$`).test(text)) throw `Enter a number with at most ${places} decimal places.`
      if (field.min !== undefined && Number(text) < field.min) throw `Ensure this value is greater than or equal to ${field.min}.`
      return text
    }
    case 'choice':
      if (typeof value !== 'string' || !field.choices?.includes(value)) throw `"${String(value)}" is not a valid choice.`
      return value
    case 'json':
      if (typeof value !== 'object') throw 'Value must be a JSON object or list.'
      return JSON.stringify(value)
    case 'ref': {
      const id = String(value)
      const exists = await queryOne(`SELECT 1 FROM ${ident(field.ref!.table)} r WHERE r.id::text = $1${field.ref!.where ? ` AND ${field.ref!.where}` : ''}`, [id], db)
      if (!exists) throw 'Select a valid choice.'
      return id
    }
    case 'secret':
      if (typeof value !== 'string' || !value.trim()) throw 'This field is required.'
      return encryptProviderSecret(value.trim())
    default:
      throw 'This field cannot be set.'
  }
}

/** Domain rules checked before a write: validation and making room for a new default (one default per table). */
async function beforeWrite(resource: Resource, id: string | null, values: Record<string, unknown>, db: Queryable) {
  if (resource.key === 'hosting-plans' && typeof values.slug === 'string' && values.slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(values.slug))
    throw new ValidationError({ slug: ['Use lowercase letters, numbers and single hyphens.'] })
  if ((resource.key === 'pricing-rules' || resource.key === 'payment-gateways') && values.is_default === true)
    await db.query(`UPDATE ${ident(resource.table)} SET is_default = false, updated_at = CURRENT_TIMESTAMP WHERE is_default AND ($1::text IS NULL OR id::text <> $1::text)`, [id])
}

/** Domain rules applied after a write. */
async function afterWrite(resource: Resource, id: string, values: Record<string, unknown>, previous: Record<string, unknown> | null, db: Queryable) {
  if (resource.key === 'hosting-packages' && values.is_provider_verified === true && previous?.is_provider_verified !== true)
    await db.query('UPDATE hosting_hostingpackage SET last_verified_at = CURRENT_TIMESTAMP WHERE id = $1', [id])
}

function translateDatabaseError(error: unknown): never {
  const code = (error as { code?: string }).code
  if (code === '23505') throw new ValidationError({ non_field_errors: ['A record with these values already exists.'] })
  if (code === '23514') throw new ValidationError({ non_field_errors: ['These values break a data rule (for example an amount out of range).'] })
  if (code === '23503') throw new ValidationError({ non_field_errors: ['A referenced record does not exist or this record is still in use.'] })
  throw error
}

const masked = (resource: Resource, values: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(values).map(([key, value]) => [key, resource.fields.find((field) => field.name === key)?.type === 'secret' ? '[changed]' : value]))

async function collect(resource: Resource, body: unknown, mode: 'create' | 'update', db: Queryable) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ValidationError({ non_field_errors: ['Invalid data. Expected a dictionary.'] })
  const input = body as Record<string, unknown>
  const values: Record<string, unknown> = {}
  const errors: Record<string, string[]> = {}
  for (const field of resource.fields) {
    const settable = field.editable || (mode === 'create' && field.required)
    if (!settable) continue
    const present = Object.prototype.hasOwnProperty.call(input, field.name)
    if (!present) {
      if (mode === 'create' && field.required) errors[field.name] = ['This field is required.']
      continue
    }
    try {
      values[field.name] = await coerce(field, input[field.name], db)
    } catch (message) {
      if (typeof message !== 'string') throw message
      errors[field.name] = [message]
    }
  }
  if (Object.keys(errors).length) throw new ValidationError(errors)
  return values
}

export async function updateRecord(user: AuthUser, resource: Resource, rawId: string, body: unknown, ipAddress: string | null) {
  if (!(await canManage(user, resource))) throw new DetailError('You do not have permission to perform this action.', 403)
  const id = parseId(resource, rawId)
  try {
    return await transaction(async (client) => {
      const previous = await queryOne<Record<string, unknown>>(`SELECT * FROM ${ident(resource.table)} WHERE id = $1 FOR UPDATE`, [id], client)
      if (!previous) throw notFound()
      const values = await collect(resource, body, 'update', client)
      const changed = Object.fromEntries(Object.entries(values).filter(([key, value]) => {
        const field = resource.fields.find((item) => item.name === key)!
        if (field.type === 'secret') return true
        const before = previous[key]
        return JSON.stringify(field.type === 'json' ? before : before === null || before === undefined ? null : before instanceof Date ? before.toISOString() : String(before)) !==
          JSON.stringify(field.type === 'json' ? JSON.parse(String(value)) : value === null ? null : String(value))
      }))
      if (Object.keys(changed).length) {
        const sets = Object.keys(changed).map((key, index) => `${ident(key)} = $${index + 2}${resource.fields.find((field) => field.name === key)?.type === 'json' ? '::jsonb' : ''}`)
        if (resource.fields.some((field) => field.name === 'updated_at')) sets.push('updated_at = CURRENT_TIMESTAMP')
        await beforeWrite(resource, id, changed, client)
        await client.query(`UPDATE ${ident(resource.table)} SET ${sets.join(', ')} WHERE id = $1`, [id, ...Object.values(changed)])
        await afterWrite(resource, id, changed, previous, client)
        await audit(
          {
            event: 'admin_record_updated', category: 'system', performedBy: user.id, targetId: id, ipAddress, message: `${resource.label}: updated ${Object.keys(changed).join(', ')}.`,
            metadata: {
              resource: resource.key,
              changes: Object.fromEntries(Object.keys(changed).map((key) => [key, { from: resource.fields.find((field) => field.name === key)?.type === 'secret' ? '[hidden]' : previous[key] ?? null, to: masked(resource, changed)[key] }])),
            },
          },
          client,
        )
      }
      return recordDetail(resource, id, client)
    })
  } catch (error) {
    return translateDatabaseError(error)
  }
}

export async function createRecord(user: AuthUser, resource: Resource, body: unknown, ipAddress: string | null) {
  if (!(await canManage(user, resource)) || !resource.createDefaults) throw new DetailError('You do not have permission to perform this action.', 403)
  try {
    return await transaction(async (client) => {
      const values = await collect(resource, body, 'create', client)
      await beforeWrite(resource, null, values, client)
      const columns: string[] = []
      const expressions: string[] = []
      const params: unknown[] = []
      if (resource.pk === 'uuid') {
        params.push(randomUUID())
        columns.push('id')
        expressions.push(`$${params.length}`)
      }
      for (const [key, value] of Object.entries(values)) {
        params.push(value)
        columns.push(key)
        expressions.push(`$${params.length}${resource.fields.find((field) => field.name === key)?.type === 'json' ? '::jsonb' : ''}`)
      }
      for (const [key, expression] of Object.entries(resource.createDefaults!)) {
        if (columns.includes(key)) continue
        columns.push(key)
        expressions.push(expression)
      }
      const created = (await queryOne<{ id: string }>(
        `INSERT INTO ${ident(resource.table)} (${columns.map(ident).join(', ')}) VALUES (${expressions.join(', ')}) RETURNING id::text AS id`,
        params,
        client,
      ))!
      await afterWrite(resource, created.id, values, null, client)
      await audit(
        { event: 'admin_record_created', category: 'system', performedBy: user.id, targetId: created.id, ipAddress, message: `${resource.label}: created.`, metadata: { resource: resource.key, values: masked(resource, values) } },
        client,
      )
      return recordDetail(resource, created.id, client)
    })
  } catch (error) {
    return translateDatabaseError(error)
  }
}

export async function runAction(user: AuthUser, resource: Resource, rawId: string, name: string, ipAddress: string | null) {
  const action = (resource.actions ?? []).find((item) => item.name === name)
  if (!action) throw notFound()
  if (!(await canManage(user, resource)) || !(await hasPerm(user, action.permission))) throw new DetailError('You do not have permission to perform this action.', 403)
  const id = parseId(resource, rawId)
  return transaction(async (client) => {
    const eligible = await queryOne(`SELECT 1 FROM ${ident(resource.table)} WHERE id = $1${action.when ? ` AND ${action.when}` : ''} FOR UPDATE`, [id], client)
    if (!eligible) throw new DetailError(`${action.label} is not available for this record.`, 409)
    await client.query(action.sql, [id])
    await audit({ event: 'admin_action', category: 'system', performedBy: user.id, targetId: id, ipAddress, message: `${resource.label}: ${action.label}.`, metadata: { resource: resource.key, action: action.name } }, client)
    return recordDetail(resource, id, client)
  })
}
