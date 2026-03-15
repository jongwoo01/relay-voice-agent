function findTranscriptOverlap(previous: string, next: string): number {
  const maxLength = Math.min(previous.length, next.length);

  for (let length = maxLength; length > 0; length -= 1) {
    if (previous.slice(-length) === next.slice(0, length)) {
      return length;
    }
  }

  return 0;
}

function shouldInsertTranscriptSpace(previous: string, next: string): boolean {
  const previousChar = previous.at(-1);
  const nextChar = next[0];

  if (!previousChar || !nextChar) {
    return false;
  }

  return /[A-Za-z0-9]$/.test(previousChar) && /^[A-Za-z0-9]/.test(nextChar);
}

function looksLikeWordContinuation(previous: string, next: string): boolean {
  const previousChar = previous.at(-1);
  const nextChar = next[0];

  if (!previousChar || !nextChar) {
    return false;
  }

  if (!/[A-Za-z]/.test(previousChar) || !/[a-z]/.test(nextChar)) {
    return false;
  }

  const lastWord = previous.match(/[A-Za-z]+$/)?.[0] ?? "";
  if (lastWord.length === 0 || lastWord.length > 3 || /\s/.test(previous)) {
    return false;
  }

  const nextWordPrefix = next.match(/^[a-z]+/)?.[0] ?? "";
  return nextWordPrefix.length >= 3;
}

export function mergeStreamingTranscript(previous: string, next: string): string {
  if (!previous) {
    return next;
  }

  if (!next || next === previous) {
    return previous;
  }

  if (next.startsWith(previous)) {
    return next;
  }

  if (previous.startsWith(next)) {
    return previous;
  }

  if (looksLikeWordContinuation(previous, next)) {
    return `${previous}${next}`;
  }

  const overlap = findTranscriptOverlap(previous, next);
  if (overlap > 0) {
    return `${previous}${next.slice(overlap)}`;
  }

  if (shouldInsertTranscriptSpace(previous, next)) {
    return `${previous} ${next}`;
  }

  return `${previous}${next}`;
}
