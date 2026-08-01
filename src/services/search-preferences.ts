/** Convert the schema's `<number>[K|M|G]` value into bytes for Rust search. */
export function parseSearchMaxFileSize(value: string): number | undefined {
  const match = value.trim().toUpperCase().match(/^(\d+)([KMG])?$/)
  if (!match) return undefined
  const base = Number(match[1])
  const multiplier = match[2] === 'G'
    ? 1024 ** 3
    : match[2] === 'M'
      ? 1024 ** 2
      : match[2] === 'K'
        ? 1024
        : 1
  const bytes = base * multiplier
  return Number.isSafeInteger(bytes) ? bytes : undefined
}
