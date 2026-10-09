/**
 * Python `json.dumps` compatible serialisation (ensure_ascii, optional sort_keys and separators), for hashes that
 * must match values computed by v1.
 */
export function pythonJsonString(value: string) {
  return JSON.stringify(value).replace(/[\u007f-￿]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)
}

export function pythonDumps(value: unknown, options: { sortKeys?: boolean; compact?: boolean } = {}): string {
  const [itemSeparator, keySeparator] = options.compact ? [',', ':'] : [', ', ': ']
  const encode = (item: unknown): string => {
    if (item === null || item === undefined) return 'null'
    if (typeof item === 'string') return pythonJsonString(item)
    if (typeof item === 'boolean') return item ? 'true' : 'false'
    if (typeof item === 'number') return JSON.stringify(item)
    if (Array.isArray(item)) return `[${item.map(encode).join(itemSeparator)}]`
    const keys = Object.keys(item as Record<string, unknown>)
    if (options.sortKeys) keys.sort()
    return `{${keys.map((key) => `${pythonJsonString(key)}${keySeparator}${encode((item as Record<string, unknown>)[key])}`).join(itemSeparator)}}`
  }
  return encode(value)
}
