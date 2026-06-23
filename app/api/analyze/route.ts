import { NextResponse } from "next/server";

type AnalyzePayload = {
  idea?: string;
  targetUser?: string;
  currentAlternative?: string;
  differentiator?: string;
  pricing?: string;
};

const requiredFields: Array<keyof AnalyzePayload> = [
  "idea",
  "targetUser",
  "currentAlternative",
  "differentiator",
];

const MIN_FIELD_LENGTH = 10;
const GEMINI_TIMEOUT_MS = 35_000;

const SYSTEM_PROMPT = `You are a sharp founder-facing startup analyst trained on Kunal Shah's Delta 4 framework.

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
- Honest, punchy, slightly harsh.
- Avoid generic startup advice.
- Call out fake convenience, discount-led behavior, AI-wrapper weakness, low switching pain, lack of brag-worthiness, and existing alternatives being good enough.
- Do not hype weak ideas.
- Use crisp founder-facing language that fits in a shareable screenshot.

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
- Do not give Delta 4 easily.
- Discounts, cashback, AI-wrapper features, and convenience-only ideas should usually score lower unless behavior change is very strong.`;

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
    const deltaScore = Number((newScore - oldScore).toFixed(1));
    result.deltaScore = deltaScore;
    result.verdictLabel =
      deltaScore >= 4 ? "Delta 4" : deltaScore >= 3 ? "Borderline" : "Not Delta 4";
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
        model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
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
    const missingFields = requiredFields.filter((field) => !cleanText(body[field]));

    if (missingFields.length > 0) {
      return NextResponse.json(
        { error: "Fill the required fields before analyzing.", fields: missingFields },
        { status: 400 },
      );
    }

    const shortFields = requiredFields.filter(
      (field) => cleanText(body[field]).length < MIN_FIELD_LENGTH,
    );

    if (shortFields.length > 0) {
      return NextResponse.json(
        {
          error: "Give us a little more context so the analysis is useful.",
          fields: shortFields,
        },
        { status: 400 },
      );
    }

    const userInput = `Analyze this startup/product idea using Delta 4.

Startup idea: ${cleanText(body.idea)}
Target user: ${cleanText(body.targetUser)}
Current alternative users use today: ${cleanText(body.currentAlternative)}
What the product does differently: ${cleanText(body.differentiator)}
Pricing / business model: ${cleanText(body.pricing) || "Not provided"}

Return JSON only.`;

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
