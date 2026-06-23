import * as cheerio from "cheerio";
import { lookup } from "node:dns/promises";
import { EXTRACTION_PROMPT, RETRY_PROMPT_SUFFIX } from "@/lib/server/prompts";
import { callGeminiJson } from "@/lib/server/gemini";
import { checkScrapeLimits } from "@/lib/server/rate-limit";
import {
  getClientIp,
  hasSuspiciousPromptIntent,
  isPrivateHostname,
  isPrivateIp,
  jsonError,
  SAFE_ERROR,
  safeLog,
  sanitizeString,
} from "@/lib/server/security";
import { NextResponse } from "next/server";

const FETCH_TIMEOUT_MS = 18_000;
const GEMINI_TIMEOUT_MS = 35_000;
const MAX_EXTRACTED_CHARS = 10_000;
const MIN_READABLE_CHARS = 20;
const MAX_URL_LENGTH = 300;
const MAX_RESPONSE_BYTES = 1_500_000;
const MAX_REDIRECTS = 3;

export const runtime = "nodejs";

type ExtractedFields = {
  startupIdea: string;
  targetUser: string;
  currentAlternative: string;
  differentiation: string;
  pricingOrBusinessModel: string;
  confidence: "High" | "Medium" | "Low";
  missingInfo: string[];
};

function compactText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeUrl(rawUrl: unknown) {
  if (typeof rawUrl !== "string" || rawUrl.length > MAX_URL_LENGTH) return null;
  const raw = sanitizeString(rawUrl, MAX_URL_LENGTH);
  if (!raw) return null;

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

  try {
    const url = new URL(withProtocol);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname.includes(".")) return null;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

async function assertPublicHttpUrl(url: URL) {
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("INVALID_URL");
  if (isPrivateHostname(url.hostname)) throw new Error("INVALID_URL");

  const records = await lookup(url.hostname, { all: true, verbatim: true }).catch(() => []);
  if (records.length === 0) throw new Error("INVALID_URL");
  if (records.some((record) => isPrivateIp(record.address))) throw new Error("INVALID_URL");
}

function buildUrlCandidates(url: URL) {
  const withoutWww = url.hostname.replace(/^www\./i, "");
  const hostnames = Array.from(new Set([url.hostname, `www.${withoutWww}`, withoutWww]));
  const protocols = url.protocol === "http:" ? ["http:", "https:"] : ["https:", "http:"];

  return Array.from(
    new Set(
      protocols.flatMap((protocol) =>
        hostnames.map((hostname) => {
          const candidate = new URL(url.toString());
          candidate.protocol = protocol;
          candidate.hostname = hostname;
          return candidate;
        }),
      ),
    ),
  );
}

async function readLimitedText(response: Response) {
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > MAX_RESPONSE_BYTES) throw new Error("TOO_LARGE");

  const reader = response.body?.getReader();
  if (!reader) return response.text();

  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) throw new Error("TOO_LARGE");
    chunks.push(value);
  }

  return new TextDecoder().decode(Buffer.concat(chunks));
}

async function fetchHtmlSafely(initialUrl: URL) {
  let current = initialUrl;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    await assertPublicHttpUrl(current);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(current, {
        signal: controller.signal,
        redirect: "manual",
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent":
            "Mozilla/5.0 (compatible; Delta4Analyzer/1.0; +https://delta4.vercel.app)",
        },
      });

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) throw new Error("UNREACHABLE");
        current = new URL(location, current);
        continue;
      }

      if (!response.ok) throw new Error("UNREACHABLE");

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.toLowerCase().includes("text/html")) throw new Error("UNREACHABLE");

      return { html: await readLimitedText(response), finalUrl: current };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new Error("TIMEOUT");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error("UNREACHABLE");
}

async function fetchFirstReachable(url: URL) {
  let timedOut = false;

  for (const candidate of buildUrlCandidates(url)) {
    try {
      return await fetchHtmlSafely(candidate);
    } catch (error) {
      if (error instanceof Error && error.message === "TIMEOUT") timedOut = true;
      if (error instanceof Error && error.message === "INVALID_URL") throw error;
    }
  }

  throw new Error(timedOut ? "TIMEOUT" : "UNREACHABLE");
}

function extractText(html: string) {
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, "");
  const $ = cheerio.load(withoutComments);

  const title = compactText($("title").first().text());
  const description = compactText(
    $("meta[name='description']").attr("content") ||
      $("meta[property='og:description']").attr("content") ||
      $("meta[name='twitter:description']").attr("content") ||
      "",
  );
  const ogTitle = compactText(
    $("meta[property='og:title']").attr("content") ||
      $("meta[name='twitter:title']").attr("content") ||
      "",
  );

  $(
    [
      "script",
      "style",
      "noscript",
      "svg",
      "img",
      "video",
      "iframe",
      "form",
      "input",
      "textarea",
      "select",
      "option",
      "nav",
      "footer",
      "header",
      "[hidden]",
      "[aria-hidden='true']",
      "[style*='display:none' i]",
      "[style*='display: none' i]",
      "[style*='visibility:hidden' i]",
      "[style*='visibility: hidden' i]",
      "[class*='cookie' i]",
      "[id*='cookie' i]",
      "[class*='banner' i]",
      "[id*='banner' i]",
      "[class*='popup' i]",
      "[id*='popup' i]",
      "[class*='modal' i]",
      "[id*='modal' i]",
    ].join(","),
  ).remove();

  const chunks: string[] = [];
  if (title) chunks.push(`Title: ${title}`);
  if (ogTitle && ogTitle !== title) chunks.push(`Social title: ${ogTitle}`);
  if (description) chunks.push(`Meta description: ${description}`);

  $("h1, h2, h3, p, button, a, li, dt, dd, summary, [class*='price' i], [id*='price' i], [class*='faq' i], [id*='faq' i]")
    .each((_, element) => {
      const text = compactText($(element).text());
      if (text && text.length >= 3 && text.length <= 600) chunks.push(text);
    });

  return Array.from(new Set(chunks)).join("\n").slice(0, MAX_EXTRACTED_CHARS);
}

function asString(value: unknown, maxLength = 500) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function validateExtractedFields(raw: any): ExtractedFields {
  if (!raw || typeof raw !== "object") throw new Error("INVALID_SCHEMA");

  const confidence = asString(raw.confidence, 20);
  const fields: ExtractedFields = {
    startupIdea: asString(raw.startupIdea),
    targetUser: asString(raw.targetUser),
    currentAlternative: asString(raw.currentAlternative),
    differentiation: asString(raw.differentiation),
    pricingOrBusinessModel: asString(raw.pricingOrBusinessModel),
    confidence: confidence === "High" || confidence === "Medium" ? confidence : "Low",
    missingInfo: Array.isArray(raw.missingInfo)
      ? raw.missingInfo.map((item: unknown) => asString(item, 160)).filter(Boolean).slice(0, 5)
      : [],
  };

  if (!fields.startupIdea || !fields.targetUser || !fields.currentAlternative) {
    throw new Error("INVALID_SCHEMA");
  }

  return fields;
}

function fallbackFieldsFromText(url: URL, text: string): ExtractedFields {
  const lines = text
    .split("\n")
    .map((line) => line.replace(/^(Title|Social title|Meta description):\s*/i, "").trim())
    .filter(Boolean);
  const title = lines[0] || url.hostname.replace(/^www\./, "");
  const description = lines.slice(1, 4).join(" ").slice(0, 260) || title;

  return {
    startupIdea: `${title}: ${description}`.slice(0, 500),
    targetUser: "People or teams looking for the product described on this landing page",
    currentAlternative: "Existing incumbent tools, manual workflows, spreadsheets, agencies, or doing nothing",
    differentiation: description,
    pricingOrBusinessModel: /pricing|price|\$|month|year|free|plan/i.test(text)
      ? "Pricing signals are present on the website, but exact model is unclear"
      : "Not clear from website",
    confidence: "Low",
    missingInfo: ["Website copy was sparse, so fields were inferred from visible metadata."],
  };
}

async function extractWithGemini(apiKey: string, url: URL, text: string) {
  const input = `Website URL: ${url.toString()}

Untrusted website text:
${text}

Return JSON only.`;

  try {
    return validateExtractedFields(
      await callGeminiJson({
        apiKey,
        systemInstruction: EXTRACTION_PROMPT,
        input,
        timeoutMs: GEMINI_TIMEOUT_MS,
        temperature: 0.2,
      }),
    );
  } catch (firstError) {
    safeLog("scrape", firstError instanceof Error ? firstError.message : "first extraction failed");
    return validateExtractedFields(
      await callGeminiJson({
        apiKey,
        systemInstruction: `${EXTRACTION_PROMPT}\n\n${RETRY_PROMPT_SUFFIX}`,
        input,
        timeoutMs: GEMINI_TIMEOUT_MS,
        temperature: 0.1,
      }),
    );
  }
}

export async function POST(request: Request) {
  const ip = getClientIp(request);

  try {
    if (!checkScrapeLimits(ip)) return jsonError(SAFE_ERROR.tooMany, 429);

    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 1_000) return jsonError(SAFE_ERROR.url, 413);

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return jsonError(SAFE_ERROR.scrape, 500);

    const body = await request.json().catch(() => ({}));
    const url = normalizeUrl(body?.url);
    if (!url) return jsonError(SAFE_ERROR.url, 400);

    let html = "";
    let finalUrl = url;

    try {
      const fetched = await fetchFirstReachable(url);
      html = fetched.html;
      finalUrl = fetched.finalUrl;
    } catch (error) {
      safeLog("scrape", error instanceof Error ? error.message : "fetch failed");
      if (error instanceof Error && error.message === "TIMEOUT") return jsonError(SAFE_ERROR.timeout, 502);
      return jsonError(SAFE_ERROR.unreachable, 502);
    }

    const extractedText = extractText(html);
    if (hasSuspiciousPromptIntent(extractedText)) return jsonError(SAFE_ERROR.suspicious, 400);

    if (extractedText.length < MIN_READABLE_CHARS) {
      return jsonError(SAFE_ERROR.littleText, 422);
    }

    let fields: ExtractedFields;

    try {
      fields = await extractWithGemini(apiKey, finalUrl, extractedText);
    } catch (error) {
      safeLog("scrape", error instanceof Error ? error.message : "extraction failed");
      fields = fallbackFieldsFromText(finalUrl, extractedText);
    }

    return NextResponse.json({
      fields: {
        idea: fields.startupIdea,
        targetUser: fields.targetUser,
        currentAlternative: fields.currentAlternative,
        differentiator: fields.differentiation,
        pricing: fields.pricingOrBusinessModel,
      },
      confidence: fields.confidence,
      missingInfo: fields.missingInfo,
    });
  } catch (error) {
    safeLog("scrape", error instanceof Error ? error.message : "unknown failure");
    return jsonError(SAFE_ERROR.scrape, 500);
  }
}
