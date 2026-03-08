export function isTrustedSenderUrl(senderUrl, allowedUrl) {
  if (!senderUrl || !allowedUrl) {
    return false;
  }

  return senderUrl === allowedUrl;
}

export function assertTrustedSenderUrl(senderUrl, allowedUrl) {
  if (!isTrustedSenderUrl(senderUrl, allowedUrl)) {
    throw new Error("Blocked IPC message from an untrusted sender.");
  }
}
