const HANGUL_REGEX = /[\u3131-\u318e\uac00-\ud7a3]/;

function normalizeText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function englishOnlyDetail(
  value: string | null | undefined
): string | null {
  const normalized = normalizeText(value);
  if (!normalized || HANGUL_REGEX.test(normalized)) {
    return null;
  }

  return normalized;
}

export function englishOnlyText(
  value: string | null | undefined,
  fallback: string
): string {
  return englishOnlyDetail(value) ?? fallback;
}

export function appendEnglishOnlyDetail(
  prefix: string,
  value: string | null | undefined
): string {
  const detail = englishOnlyDetail(value);
  return detail ? `${prefix} ${detail}` : prefix;
}
