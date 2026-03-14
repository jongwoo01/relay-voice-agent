import { createHmac, timingSafeEqual } from "node:crypto";

export interface JudgeSessionTokenPayload {
  brainSessionId: string;
  userId: string;
  exp: number;
}

function toBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function fromBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function issueJudgeSessionToken(
  payload: JudgeSessionTokenPayload,
  secret: string
): string {
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature = signPayload(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

export function verifyJudgeSessionToken(
  token: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): JudgeSessionTokenPayload | null {
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    return null;
  }

  const expected = signPayload(encodedPayload, secret);
  const left = Buffer.from(signature, "utf8");
  const right = Buffer.from(expected, "utf8");
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return null;
  }

  let payload: JudgeSessionTokenPayload;
  try {
    payload = JSON.parse(fromBase64Url(encodedPayload)) as JudgeSessionTokenPayload;
  } catch {
    return null;
  }

  if (
    !payload ||
    typeof payload.brainSessionId !== "string" ||
    typeof payload.userId !== "string" ||
    typeof payload.exp !== "number"
  ) {
    return null;
  }

  if (payload.exp <= nowSeconds) {
    return null;
  }

  return payload;
}
