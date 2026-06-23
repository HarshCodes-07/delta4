import * as cheerio from "cheerio";
import { NextResponse } from "next/server";

const FETCH_TIMEOUT_MS = 22_000;
const GEMINI_TIMEOUT_MS = 45_000;
const MAX_EXTRACTED_CHARS = 18_000;
const MIN_READABLE_CHARS = 20;

type ExtractedFields = {
  startupIdea?: string;
  targetUser?: string;
  currentAlternative?: string;
  differentiation?: string;
  pricingOrBusinessModel?: string;
  confidence?: string;
  missingInfo?: string[];
};

const EXTRACTION_PROMPT = `You are analyzing a startup/product website.

From the website text, infer the following fields for a Delta 4 startup analysis.

Return only valid JSON:

{
  "startupIdea": "",
  "targetUser": "",
  "currentAlternative": "",
  "differentiation": "",
  "pricingOrBusinessModel": "",
  "confidence": "High / Medium / Low",
  "missingInfo": []
}

Rules:
- Be specific.
- Do not invent details not supported by the website.
- If pricing is not mentioned, say "Not clear from website".
- If current alternative is not directly mentioned, infer the most likely current alternative.
- If confidence is low, explain missing info in missingInfo.
- Keep each field concise but useful.`;

function parseJsonOnly(text: string) {
  const stripped = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");

  try {
    return JSON.parse(stripped);
  } catch {
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");

    if (start >= 0 && end > start) {
      return JSON.parse(stripped.slice(start, end + 1));
    }

    throw new Error("INVALID_JSON");
  }
}

function normalizeUrl(rawUrl: unknown) {
  if (typeof rawUrl !== "string") return null;

  const trimmed = rawUrl.trim();
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(withProtocol);

    if (!["http:", "https:"].includes(url.protocol) || !url.hostname.includes(".")) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

function buildUrlCandidates(url: string) {
  const parsed = new URL(url);
  const withoutWww = parsed.hostname.replace(/^www\./i, "");
  const hostnames = Array.from(new Set([parsed.hostname, `www.${withoutWww}`, withoutWww]));
  const protocols = parsed.protocol === "http:" ? ["http:", "https:"] : ["https:", "http:"];

  return Array.from(
    new Set(
      protocols.flatMap((protocol) =>
        hostnames.map((hostname) => {
          const candidate = new URL(parsed.toString());
          candidate.protocol = protocol;
          candidate.hostname = hostname;
          return candidate.toString();
        }),
      ),
    ),
  );
}

function compactText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function extractText(html: string) {
  const $ = cheerio.load(html);

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
  const keywords = compactText($("meta[name='keywords']").attr("content") || "");

  $(
    [
      "script",
      "style",
      "noscript",
      "svg",
      "img",
      "video",
      "iframe",
      "nav",
      "footer",
      "header",
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
  if (keywords) chunks.push(`Keywords: ${keywords}`);

  $("h1, h2, h3, p, button, a, li, dt, dd, summary, [class*='price' i], [id*='price' i], [class*='faq' i], [id*='faq' i]")
    .each((_, element) => {
      const text = compactText($(element).text());

      if (text && text.length >= 3 && text.length <= 600) {
        chunks.push(text);
      }
    });

  return Array.from(new Set(chunks)).join("\n").slice(0, MAX_EXTRACTED_CHARS);
}

function fallbackFieldsFromText(url: string, text: string): ExtractedFields {
  const lines = text
    .split("\n")
    .map((line) => line.replace(/^(Title|Social title|Meta description|Keywords):\s*/i, "").trim())
    .filter(Boolean);
  const title = lines[0] || new URL(url).hostname.replace(/^www\./, "");
  const description = lines.slice(1, 4).join(" ").slice(0, 260) || title;

  return {
    startupIdea: `${title}: ${description}`.slice(0, 320),
    targetUser: "People or teams looking for the product described on this landing page",
    currentAlternative: "Existing incumbent tools, manual workflows, agencies, spreadsheets, or doing nothing",
    differentiation: description,
    pricingOrBusinessModel: /pricing|price|\$|month|year|free|plan/i.test(text)
      ? "Pricing signals are present on the website, but exact model is unclear"
      : "Not clear from website",
    confidence: "Low",
    missingInfo: [
      "Website copy was sparse or hard to extract, so fields were inferred from visible metadata.",
    ],
  };
}

function getOutputText(payload: any) {
  return (
    payload?.output_text ||
    payload?.steps?.at?.(-1)?.content?.find?.((item: any) => item?.type === "text")?.text ||
    ""
  );
}

async function fetchWithTimeout(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent":
          "Mozilla/5.0 (compatible; Delta4Analyzer/1.0; +https://delta4.analyzer)",
      },
    });

    if (!response.ok) throw new Error("UNREACHABLE");

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) throw new Error("UNREACHABLE");

    return response.text();
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("TIMEOUT");
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchFirstReachable(url: string) {
  let timedOut = false;

  for (const candidate of buildUrlCandidates(url)) {
    try {
      return { html: await fetchWithTimeout(candidate), finalUrl: candidate };
    } catch (error) {
      if (error instanceof Error && error.message === "TIMEOUT") {
        timedOut = true;
      }
    }
  }

  throw new Error(timedOut ? "TIMEOUT" : "UNREACHABLE");
}

async function extractWithGemini(apiKey: string, url: string, text: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

  try {
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        model: process.env.GEMINI_MODEL || "gemini-3.5-flash",
        system_instruction: EXTRACTION_PROMPT,
        input: `Website URL: ${url}\n\nWebsite text:\n${text}\n\nReturn JSON only.`,
        generation_config: {
          temperature: 0.2,
          thinking_level: "low",
        },
      }),
    });

    if (!response.ok) throw new Error("EXTRACTION_FAILED");

    const payload = await response.json().catch(() => null);
    const outputText = getOutputText(payload);

    if (!outputText) throw new Error("EXTRACTION_FAILED");

    return parseJsonOnly(outputText);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("TIMEOUT");
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(request: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "Couldn't understand this website clearly. Try manual mode." },
        { status: 500 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const url = normalizeUrl(body?.url);

    if (!url) {
      return NextResponse.json(
        { error: "Please enter a valid website URL." },
        { status: 400 },
      );
    }

    let html = "";
    let finalUrl = url;

    try {
      const fetched = await fetchFirstReachable(url);
      html = fetched.html;
      finalUrl = fetched.finalUrl;
    } catch (error) {
      const message =
        error instanceof Error && error.message === "TIMEOUT"
          ? "The website took too long to respond. Try again or enter manually."
          : "Couldn't access this website. Try another URL or enter manually.";

      return NextResponse.json({ error: message }, { status: 502 });
    }

    const extractedText = extractText(html);

    if (extractedText.length < MIN_READABLE_CHARS) {
      return NextResponse.json(
        { error: "This website doesn't expose enough text to analyze. Try manual mode." },
        { status: 422 },
      );
    }

    try {
      const fields = await extractWithGemini(apiKey, finalUrl, extractedText);
      return NextResponse.json({
        fields: {
          idea: fields.startupIdea || "",
          targetUser: fields.targetUser || "",
          currentAlternative: fields.currentAlternative || "",
          differentiator: fields.differentiation || "",
          pricing: fields.pricingOrBusinessModel || "",
        },
        confidence: fields.confidence || "Low",
        missingInfo: Array.isArray(fields.missingInfo) ? fields.missingInfo : [],
      });
    } catch (error) {
      const fallbackFields = fallbackFieldsFromText(finalUrl, extractedText);

      return NextResponse.json({
        fields: {
          idea: fallbackFields.startupIdea || "",
          targetUser: fallbackFields.targetUser || "",
          currentAlternative: fallbackFields.currentAlternative || "",
          differentiator: fallbackFields.differentiation || "",
          pricing: fallbackFields.pricingOrBusinessModel || "",
        },
        confidence: fallbackFields.confidence || "Low",
        missingInfo: fallbackFields.missingInfo || [],
      });
    }
  } catch {
    return NextResponse.json(
      { error: "Couldn't understand this website clearly. Try manual mode." },
      { status: 500 },
    );
  }
}
