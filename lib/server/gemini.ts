export function getOutputText(payload: any) {
  return (
    payload?.output_text ||
    payload?.steps?.at?.(-1)?.content?.find?.((item: any) => item?.type === "text")?.text ||
    ""
  );
}

export function parseJsonOnly(text: string) {
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

export async function callGeminiJson({
  apiKey,
  systemInstruction,
  input,
  timeoutMs,
  temperature,
}: {
  apiKey: string;
  systemInstruction: string;
  input: string;
  timeoutMs: number;
  temperature: number;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

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
        system_instruction: systemInstruction,
        input,
        generation_config: {
          temperature,
          thinking_level: "low",
        },
      }),
    });

    if (!response.ok) throw new Error("GEMINI_API_FAILED");

    const payload = await response.json().catch(() => null);
    const text = getOutputText(payload);
    if (!text) throw new Error("GEMINI_API_FAILED");

    return parseJsonOnly(text);
  } finally {
    clearTimeout(timeout);
  }
}
