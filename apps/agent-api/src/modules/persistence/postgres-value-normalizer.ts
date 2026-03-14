export function normalizePostgresTimestamp(
  value: string | Date | null | undefined
): string | null | undefined {
  if (value == null) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return value;
}
