import { NextResponse } from "next/server";

type AnalyzePayload = {
  idea?: string;
  targetUser?: string;
  currentAlternative?: string;
  differentiator?: string;
  pricing?: string;
};

const MIN_IDEA_LENGTH = 12;
const GEMINI_TIMEOUT_MS = 35_000;

const SYSTEM_PROMPT = `You are an experienced startup investor and product thinker trained on Kunal Shah's Delta 4 framework.

Analyze the user's startup idea based on:
- Old behavior
- New behavior
- Efficiency improvement
- Emotional pull
- Habit change potential
- Switching cost
- Market readiness
- Affordability
- Brag-worthiness / UBP
- Whether users would go back to the old way

Tone:
- Honest, punchy, founder-friendly, and optimistic about plausible behavior change.
- Identify strengths first. Then explain what prevents an even higher score.
- Avoid generic startup advice.
- Call out fake convenience, discount-led behavior, AI-wrapper weakness, low switching pain, lack of brag-worthiness, and existing alternatives being good enough.
- Do not hype truly weak ideas, but do not sandbag promising ideas. Your default should be to find the strongest credible wedge.
- Use crisp founder-facing language that fits in a shareable screenshot.
- Make the result feel useful and postable on X: memorable takeaway, sharper upside, and a clear next move.
- Avoid roast energy. People should leave motivated, not dismissed.
- Prefer tweet-worthy sentences. Example: "The workflow is the innovation, not the feature."

Return only valid JSON in this exact format:

{
  "ideaSummary": "",
  "oldBehavior": {
    "description": "",
    "scoreOutOf10": 0,
    "why": ""
  },
  "newBehavior": {
    "description": "",
    "scoreOutOf10": 0,
    "why": ""
  },
  "deltaScore": 0,
  "verdict": "",
  "verdictLabel": "Delta 4 / Not Delta 4 / Borderline",
  "behaviorChange": "",
  "wouldUsersGoBack": "",
  "ubp": {
    "scoreOutOf10": 0,
    "analysis": ""
  },
  "risks": [
    ""
  ],
  "whatMakesItWeak": [
    ""
  ],
  "howToIncreaseDelta": [
    ""
  ],
  "oneLineTakeaway": ""
}

Output rules:
- oneLineTakeaway must be under 140 characters.
- risks, whatMakesItWeak, and howToIncreaseDelta must be short, specific, and non-generic.
- Each array should contain 3 to 5 sharp bullets.
- verdict should be 1 to 2 sentences.
- wouldUsersGoBack should be a direct answer, not a paragraph.

Scoring rules:
- Old behavior score should represent how good the existing solution already is.
- New behavior score should represent how much better the proposed idea is.
- Delta score = new behavior score - old behavior score.
- If deltaScore >= 4, verdictLabel should be "Delta 4".
- If deltaScore is 3 to 3.9, verdictLabel should be "Borderline".
- If deltaScore < 3, verdictLabel should be "Not Delta 4".
- Delta 4 is upper-middle, not impossible perfection.
- Target distribution: 15% score 2-3, 30% score 4-5, 35% score 6-7, 15% score 8, 5% score 9+.
- Most genuinely interesting startup ideas should score between 6 and 8.
- Only truly weak ideas should receive below 4.
- Only exceptional ideas should receive 9 or above.
- Reward strong insight, clear differentiation, behavior change, better UX, network effects, AI leverage, distribution advantage, and traction inferred from website quality.
- Avoid punishing ideas simply because they use AI.
- Give Not Delta 4 only when the idea is mostly discount-led, a thin wrapper with no workflow change, low-frequency, or the old behavior is already excellent.
- Discounts, cashback, and convenience-only ideas can still score well if the behavior change loop is strong.`;

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

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

function normalizeVerdict(result: any) {
  const oldScore = Number(result?.oldBehavior?.scoreOutOf10);
  const newScore = Number(result?.newBehavior?.scoreOutOf10);

  if (Number.isFinite(oldScore) && Number.isFinite(newScore)) {
    let adjustedNewScore = newScore;
    let deltaScore = newScore - oldScore;

    // Shareability calibration: promising ideas should cluster in the 6-8 range
    // unless the model clearly sees a weak/low-switching-pain product.
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
  }

  if (typeof result?.oneLineTakeaway === "string") {
    result.oneLineTakeaway = result.oneLineTakeaway.slice(0, 140);
  }

  return result;
}

function getOutputText(payload: any) {
  return (
    payload?.output_text ||
    payload?.steps?.at?.(-1)?.content?.find?.((item: any) => item?.type === "text")?.text ||
    ""
  );
}

async function callGemini({
  apiKey,
  input,
  strictRetry,
}: {
  apiKey: string;
  input: string;
  strictRetry: boolean;
}) {
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
        model: process.env.GEMINI_MODEL || "gemini-3.1-flash-lite",
        system_instruction: strictRetry
          ? `${SYSTEM_PROMPT}\n\nSTRICT RETRY: Your previous response was invalid. Return raw JSON only. No markdown, no prose, no code fence.`
          : SYSTEM_PROMPT,
        input,
        generation_config: {
          temperature: strictRetry ? 0.1 : 0.3,
          thinking_level: "low",
        },
      }),
    });

    if (!response.ok) {
      throw new Error("GEMINI_API_FAILED");
    }

    const geminiPayload = await response.json().catch(() => null);
    const text = getOutputText(geminiPayload);

    if (!text) {
      throw new Error("GEMINI_API_FAILED");
    }

    return parseJsonOnly(text);
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(request: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "Couldn't analyze right now. Please try again." },
        { status: 500 },
      );
    }

    const body = (await request.json()) as AnalyzePayload;
    const idea = cleanText(body.idea);

    if (idea.length < MIN_IDEA_LENGTH) {
      return NextResponse.json(
        {
          error: "Give us a little more context so the analysis is useful.",
          fields: ["idea"],
        },
        { status: 400 },
      );
    }

    const hasStructuredContext =
      cleanText(body.targetUser) ||
      cleanText(body.currentAlternative) ||
      cleanText(body.differentiator) ||
      cleanText(body.pricing);

    const userInput = hasStructuredContext
      ? `Analyze this startup/product idea using Delta 4.

Startup idea: ${idea}
Target user: ${cleanText(body.targetUser)}
Current alternative users use today: ${cleanText(body.currentAlternative) || "Infer from the idea"}
What the product does differently: ${cleanText(body.differentiator)}
Pricing / business model: ${cleanText(body.pricing) || "Not provided"}

Return JSON only.`
      : `Analyze this startup/product idea using Delta 4.

User entered only this idea:
${idea}

Infer the target user, old behavior/current alternative, new behavior, differentiation, pricing assumptions, and switching dynamics from the idea. If something is unclear, state the assumption in the analysis. Return JSON only.`;

    try {
      const firstResult = await callGemini({ apiKey, input: userInput, strictRetry: false });
      return NextResponse.json({ analysis: normalizeVerdict(firstResult) });
    } catch (firstError) {
      if (firstError instanceof Error && firstError.message === "INVALID_JSON") {
        try {
          const retryResult = await callGemini({ apiKey, input: userInput, strictRetry: true });
          return NextResponse.json({ analysis: normalizeVerdict(retryResult) });
        } catch {
          return NextResponse.json(
            { error: "The analysis engine got confused. Try simplifying your idea." },
            { status: 502 },
          );
        }
      }

      return NextResponse.json(
        { error: "Couldn't analyze right now. Please try again." },
        { status: 502 },
      );
    }
  } catch {
    return NextResponse.json(
      { error: "Couldn't analyze right now. Please try again." },
      { status: 500 },
    );
  }
}
