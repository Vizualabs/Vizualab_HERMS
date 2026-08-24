export const REQUEST_ID_HEADER = 'X-Request-ID'
export const REQUEST_ID_MAX_LENGTH = 128

const requestIdPattern = /^[A-Za-z0-9._:-]+$/

export function isValidRequestId(value: string | undefined): value is string {
  return Boolean(
    value && value.length <= REQUEST_ID_MAX_LENGTH && requestIdPattern.test(value),
  )
}

export function resolveRequestId(candidate: string | undefined): string {
  return isValidRequestId(candidate) ? candidate : crypto.randomUUID()
}
