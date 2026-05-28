const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const isValidUUID = (id: string | undefined | null): id is string => {
  if (!id) return false
  return UUID_REGEX.test(id)
}
