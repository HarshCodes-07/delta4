import { isIP } from "node:net";

export const SAFE_ERROR = {
  tooMany: "Too many requests. Please try again later.",
  unclear: "Give us a little more context so the analysis is useful.",
  suspicious: "Can't help with that. Try entering a startup idea instead.",
  analyze: "Couldn't analyze right now. Please try again.",
  scrape: "Couldn't understand this website clearly. Try manual mode.",
  url: "Please enter a valid website URL.",
  unreachable: "Couldn't access this website. Try another URL or enter manually.",
  timeout: "The website took too long to respond. Try again or enter manually.",
  littleText: "This website doesn't expose enough text to analyze. Try manual mode.",
};

const promptExtractionPatterns = [
  /show\s+(me\s+)?(your\s+)?system\s+prompt/i,
  /reveal\s+(the\s+)?(hidden|system|master)\s+(prompt|rules|instructions)/i,
  /print\s+(the\s+)?(hidden|system|master)\s+(prompt|rules|instructions)/i,
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /what\s+prompt\s+are\s+you\s+using/i,
  /reveal\s+json\s+schema/i,
  /api\s*key/i,
  /hidden\s+instructions/i,
  /system\s+message/i,
];

const spamPatterns = [
  /(.)\1{24,}/,
  /^[\W_]+$/,
  /\b(?:buy now|free money|casino|porn|viagra)\b/i,
];

export function getClientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}

export function hasSuspiciousPromptIntent(value: string) {
  return promptExtractionPatterns.some((pattern) => pattern.test(value));
}

export function isSpammy(value: string) {
  const trimmed = value.trim();
  return trimmed.length === 0 || spamPatterns.some((pattern) => pattern.test(trimmed));
}

export function sanitizeString(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.replace(/\u0000/g, "").trim().slice(0, maxLength);
}

export function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export function safeLog(scope: string, message: string) {
  if (process.env.NODE_ENV !== "production") {
    console.warn(`[${scope}] ${message}`);
  }
}

export function isPrivateHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return (
    normalized === "localhost" ||
    normalized === "0.0.0.0" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal")
  );
}

export function isPrivateIp(ip: string) {
  const version = isIP(ip);
  if (!version) return false;

  if (version === 6) {
    const normalized = ip.toLowerCase();
    return (
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80:")
    );
  }

  const parts = ip.split(".").map(Number);
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}
