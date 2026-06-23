import { ANALYSIS_PROMPT, RETRY_PROMPT_SUFFIX } from "@/lib/server/prompts";
import { callGeminiJson } from "@/lib/server/gemini";
import { checkAnalysisLimits } from "@/lib/server/rate-limit";
import {
  getClientIp,
  hasSuspiciousPromptIntent,
  isSpammy,
  jsonError,
  SAFE_ERROR,
  safeLog,
  sanitizeString,
} from "@/lib/server/security";
import { NextResponse } from "next/server";

type AnalyzePayload = {
  idea?: string;
  targetUser?: string;
  currentAlternative?: string;
  differentiator?: string;
  pricing?: string;
};

type AnalysisResult = {
  ideaSummary: string;
  oldBehavior: { description: string; scoreOutOf10: number; why: string };
  newBehavior: { description: string; scoreOutOf10: number; why: string };
  deltaScore: number;
  verdict: string;
  verdictLabel: "Delta 4" | "Not Delta 4" | "Borderline";
  behaviorChange: string;
  wouldUsersGoBack: string;
  ubp: { scoreOutOf10: number; analysis: string };
  risks: string[];
  whatMakesItWeak: string[];
  howToIncreaseDelta: string[];
  oneLineTakeaway: string;
};

const MIN_IDEA_LENGTH = 12;
const MAX_IDEA_LENGTH = 2_000;
const MAX_CONTEXT_FIELD_LENGTH = 600;
const GEMINI_TIMEOUT_MS = 35_000;

export const runtime = "nodejs";

function validatePayload(raw: unknown): AnalyzePayload | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const body = raw as AnalyzePayload;

  if (typeof body.idea !== "string" || body.idea.length > MAX_IDEA_LENGTH) return null;
  for (const field of ["targetUser", "currentAlternative", "differentiator", "pricing"] as const) {
    if (typeof body[field] === "string" && body[field].length > MAX_CONTEXT_FIELD_LENGTH) {
      return null;
    }
  }

  return {
    idea: sanitizeString(body.idea, MAX_IDEA_LENGTH),
    targetUser: sanitizeString(body.targetUser, MAX_CONTEXT_FIELD_LENGTH),
    currentAlternative: sanitizeString(body.currentAlternative, MAX_CONTEXT_FIELD_LENGTH),
    differentiator: sanitizeString(body.differentiator, MAX_CONTEXT_FIELD_LENGTH),
    pricing: sanitizeString(body.pricing, MAX_CONTEXT_FIELD_LENGTH),
  };
}

function asScore(value: unknown) {
  const score = Number(value);
  return Number.isFinite(score) ? Math.max(0, Math.min(10, Number(score.toFixed(1)))) : 0;
}

function asString(value: unknown, maxLength = 800) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function asStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => asString(item, 220)).filter(Boolean).slice(0, 5)
    : [];
}

function validateAnalysisResult(raw: any): AnalysisResult {
  if (!raw || typeof raw !== "object") throw new Error("INVALID_SCHEMA");

  const oldBehavior = raw.oldBehavior || {};
  const newBehavior = raw.newBehavior || {};
  const ubp = raw.ubp || {};

  const result: AnalysisResult = {
    ideaSummary: asString(raw.ideaSummary),
    oldBehavior: {
      description: asString(oldBehavior.description),
      scoreOutOf10: asScore(oldBehavior.scoreOutOf10),
      why: asString(oldBehavior.why),
    },
    newBehavior: {
      description: asString(newBehavior.description),
      scoreOutOf10: asScore(newBehavior.scoreOutOf10),
      why: asString(newBehavior.why),
    },
    deltaScore: 0,
    verdict: asString(raw.verdict),
    verdictLabel: "Not Delta 4",
    behaviorChange: asString(raw.behaviorChange),
    wouldUsersGoBack: asString(raw.wouldUsersGoBack, 300),
    ubp: {
      scoreOutOf10: asScore(ubp.scoreOutOf10),
      analysis: asString(ubp.analysis),
    },
    risks: asStringArray(raw.risks),
    whatMakesItWeak: asStringArray(raw.whatMakesItWeak),
    howToIncreaseDelta: asStringArray(raw.howToIncreaseDelta),
    oneLineTakeaway: asString(raw.oneLineTakeaway, 140),
  };

  if (!result.oldBehavior.description || !result.newBehavior.description || !result.verdict) {
    throw new Error("INVALID_SCHEMA");
  }

  return normalizeVerdict(result);
}

function normalizeVerdict(result: AnalysisResult) {
  const oldScore = result.oldBehavior.scoreOutOf10;
  const newScore = result.newBehavior.scoreOutOf10;
  let adjustedNewScore = newScore;
  let deltaScore = newScore - oldScore;

  if (newScore >= 6.2 && deltaScore >= 2.2 && deltaScore < 4) {
    deltaScore = Math.min(6.8, Math.max(4.2, deltaScore + 1.6));
    adjustedNewScore = Math.min(10, Number((oldScore + deltaScore).toFixed(1)));
  } else if (newScore >= 7 && deltaScore >= 4) {
    deltaScore = Math.min(8.2, deltaScore + 0.8);
    adjustedNewScore = Math.min(10, Number((oldScore + deltaScore).toFixed(1)));
  } else if (newScore >= 8.4 && deltaScore >= 5.5) {
    deltaScore = Math.min(9.1, deltaScore + 0.5);
    adjustedNewScore = Math.min(10, Number((oldScore + deltaScore).toFixed(1)));
  }

  result.newBehavior.scoreOutOf10 = adjustedNewScore;
  result.deltaScore = Number((adjustedNewScore - oldScore).toFixed(1));
  result.verdictLabel =
    result.deltaScore >= 4 ? "Delta 4" : result.deltaScore >= 3 ? "Borderline" : "Not Delta 4";

  return result;
}

async function analyzeWithRetry(apiKey: string, userInput: string) {
  try {
    return validateAnalysisResult(
      await callGeminiJson({
        apiKey,
        systemInstruction: ANALYSIS_PROMPT,
        input: userInput,
        timeoutMs: GEMINI_TIMEOUT_MS,
        temperature: 0.3,
      }),
    );
  } catch (firstError) {
    safeLog("analyze", firstError instanceof Error ? firstError.message : "first attempt failed");
    return validateAnalysisResult(
      await callGeminiJson({
        apiKey,
        systemInstruction: `${ANALYSIS_PROMPT}\n\n${RETRY_PROMPT_SUFFIX}`,
        input: userInput,
        timeoutMs: GEMINI_TIMEOUT_MS,
        temperature: 0.1,
      }),
    );
  }
}

export async function POST(request: Request) {
  const ip = getClientIp(request);

  try {
    if (!checkAnalysisLimits(ip)) {
      return jsonError(SAFE_ERROR.tooMany, 429);
    }

    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 12_000) return jsonError(SAFE_ERROR.unclear, 413);

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return jsonError(SAFE_ERROR.analyze, 500);

    const body = validatePayload(await request.json().catch(() => null));
    if (!body) return jsonError(SAFE_ERROR.unclear, 400);

    const idea = body.idea || "";
    const combinedInput = Object.values(body).filter(Boolean).join("\n");

    if (hasSuspiciousPromptIntent(combinedInput)) {
      return jsonError(SAFE_ERROR.suspicious, 400);
    }

    if (idea.length < MIN_IDEA_LENGTH || isSpammy(idea)) {
      return jsonError(SAFE_ERROR.unclear, 400);
    }

    const hasStructuredContext =
      body.targetUser || body.currentAlternative || body.differentiator || body.pricing;

    const userInput = hasStructuredContext
      ? `Analyze this startup/product idea using Delta 4.

Untrusted startup idea: ${idea}
Untrusted target user: ${body.targetUser || "Infer from the idea"}
Untrusted current alternative: ${body.currentAlternative || "Infer from the idea"}
Untrusted differentiation: ${body.differentiator || "Infer from the idea"}
Untrusted pricing / business model: ${body.pricing || "Not provided"}

Return JSON only.`
      : `Analyze this startup/product idea using Delta 4.

Untrusted user-entered idea:
${idea}

Infer the target user, old behavior/current alternative, new behavior, differentiation, pricing assumptions, and switching dynamics from the idea. If something is unclear, state the assumption in the analysis. Return JSON only.`;

    const analysis = await analyzeWithRetry(apiKey, userInput);
    return NextResponse.json({ analysis });
  } catch (error) {
    safeLog("analyze", error instanceof Error ? error.message : "unknown failure");
    return jsonError(SAFE_ERROR.analyze, 500);
  }
}
