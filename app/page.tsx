"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type DeltaAnalysis = {
  ideaSummary: string;
  oldBehavior: {
    description: string;
    scoreOutOf10: number;
    why: string;
  };
  newBehavior: {
    description: string;
    scoreOutOf10: number;
    why: string;
  };
  deltaScore: number;
  verdict: string;
  verdictLabel: "Delta 4" | "Not Delta 4" | "Borderline" | string;
  behaviorChange: string;
  wouldUsersGoBack: string;
  ubp: {
    scoreOutOf10: number;
    analysis: string;
  };
  risks: string[];
  whatMakesItWeak: string[];
  howToIncreaseDelta: string[];
  oneLineTakeaway: string;
};

type FormState = {
  idea: string;
  targetUser: string;
  currentAlternative: string;
  differentiator: string;
  pricing: string;
};

const initialForm: FormState = {
  idea: "",
  targetUser: "",
  currentAlternative: "",
  differentiator: "",
  pricing: "",
};

const requiredFields: Array<keyof FormState> = [
  "idea",
  "targetUser",
  "currentAlternative",
  "differentiator",
];

const fieldLabels: Record<keyof FormState, string> = {
  idea: "Startup idea",
  targetUser: "Target user",
  currentAlternative: "Current alternative users use today",
  differentiator: "What your product does differently",
  pricing: "Optional: pricing / business model",
};

const sampleIdeas = [
  "AI lawyer for term sheets",
  "Math game platform for kids",
  "Personal AI memory for laptop",
  "Discount coupon marketplace",
];

const loadingMessages = [
  "Comparing old behavior vs new behavior...",
  "Checking if users would actually switch...",
  "Looking for fake Delta created by discounts...",
  "Testing brag-worthiness...",
];

function verdictClass(label: string) {
  if (label === "Delta 4") return "verdictDelta";
  if (label === "Borderline") return "verdictBorderline";
  return "verdictNot";
}

function verdictText(label: string) {
  if (label === "Delta 4") return "DELTA 4";
  if (label === "Borderline") return "BORDERLINE";
  return "NOT DELTA 4";
}

function getShareUrl() {
  if (typeof window === "undefined") return "";
  return window.location.href.split("#")[0];
}

function buildCopyText(analysis: DeltaAnalysis, url: string) {
  return `My idea scored ${analysis.deltaScore}/10 on Delta 4.

Old behavior: ${analysis.oldBehavior.scoreOutOf10}/10
New behavior: ${analysis.newBehavior.scoreOutOf10}/10
Verdict: ${analysis.verdictLabel}

Takeaway: ${analysis.oneLineTakeaway}

Analyze yours: ${url}`;
}

function ListBlock({ title, items }: { title: string; items: string[] }) {
  const cleanItems = items.filter(Boolean);

  if (cleanItems.length === 0) return null;

  return (
    <section className="resultSection">
      <h3>{title}</h3>
      <ul className="sharpList">
        {cleanItems.map((item, index) => (
          <li key={`${title}-${index}`}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

export default function Home() {
  const [form, setForm] = useState<FormState>(initialForm);
  const [analysis, setAnalysis] = useState<DeltaAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [touched, setTouched] = useState(false);
  const [invalidFields, setInvalidFields] = useState<Array<keyof FormState>>([]);
  const [loadingIndex, setLoadingIndex] = useState(0);
  const [copyLabel, setCopyLabel] = useState("Copy Result");
  const [downloadLabel, setDownloadLabel] = useState("Download Screenshot");
  const resultCardRef = useRef<HTMLDivElement>(null);

  const missingFields = useMemo(
    () => requiredFields.filter((field) => !form[field].trim()),
    [form],
  );

  useEffect(() => {
    if (!loading) {
      setLoadingIndex(0);
      return;
    }

    const interval = window.setInterval(() => {
      setLoadingIndex((current) => (current + 1) % loadingMessages.length);
    }, 1600);

    return () => window.clearInterval(interval);
  }, [loading]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (loading) return;

    setTouched(true);
    setError("");
    setInvalidFields([]);

    if (missingFields.length > 0) {
      setInvalidFields(missingFields);
      setError("Fill the required fields before analyzing.");
      return;
    }

    const shortFields = requiredFields.filter((field) => form[field].trim().length < 10);

    if (shortFields.length > 0) {
      setInvalidFields(shortFields);
      setError("Give us a little more context so the analysis is useful.");
      return;
    }

    setLoading(true);
    setAnalysis(null);

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 45_000);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(form),
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        setInvalidFields(payload?.fields || []);
        console.log(payload)
        throw new Error(payload?.error || "Couldn't analyze right now. Please try again.");
      }

      setAnalysis(payload.analysis);
      window.setTimeout(() => {
        document.getElementById("result")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    } catch (submitError) {
      setError(
        submitError instanceof DOMException && submitError.name === "AbortError"
          ? "Couldn't analyze right now. Please try again."
          : submitError instanceof Error
            ? submitError.message
            : "Couldn't analyze right now. Please try again.",
      );
    } finally {
      window.clearTimeout(timeout);
      setLoading(false);
    }
  }

  function updateField(field: keyof FormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setInvalidFields((current) => current.filter((item) => item !== field));
  }

  function applySampleIdea(idea: string) {
    setForm((current) => ({ ...current, idea }));
    setInvalidFields((current) => current.filter((item) => item !== "idea"));
  }

  async function copyResult() {
    if (!analysis) return;

    await navigator.clipboard.writeText(buildCopyText(analysis, getShareUrl()));
    setCopyLabel("Copied");
    window.setTimeout(() => setCopyLabel("Copy Result"), 1800);
  }

  async function downloadScreenshot() {
    if (!resultCardRef.current) return;

    setDownloadLabel("Rendering...");

    try {
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(resultCardRef.current, {
        backgroundColor: "#080808",
        scale: 2,
        useCORS: true,
      });
      const link = document.createElement("a");
      link.download = "delta4-analysis.png";
      link.href = canvas.toDataURL("image/png");
      link.click();
    } finally {
      setDownloadLabel("Download Screenshot");
    }
  }

  function shareOnX() {
    if (!analysis) return;

    const text = `My startup idea just got a Delta ${analysis.deltaScore} verdict.

${analysis.oneLineTakeaway}

Try yours: ${getShareUrl()}`;
    const shareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
    window.open(shareUrl, "_blank", "noopener,noreferrer");
  }

  function analyzeAnotherIdea() {
    setAnalysis(null);
    setError("");
    setTouched(false);
    setInvalidFields([]);
    document.getElementById("analyzer")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const cardBullets = analysis
    ? [
        {
          label: analysis.deltaScore >= 3 ? "Why it works" : "Why it struggles",
          text:
            analysis.deltaScore >= 3
              ? analysis.behaviorChange
              : analysis.whatMakesItWeak[0] || analysis.verdict,
        },
        {
          label: "Biggest risk",
          text: analysis.risks[0] || "Existing alternatives may already be good enough.",
        },
        {
          label: "Increase Delta",
          text: analysis.howToIncreaseDelta[0] || "Raise switching pain and make the new behavior visibly better.",
        },
      ]
    : [];

  return (
    <main className="shell">
      <nav className="nav" aria-label="Primary">
        <div className="brand" aria-label="Delta 4 Analyzer">
          <span>DELTA 4</span>
          <span>ANALYZER</span>
        </div>
        <a href="#analyzer" className="navCta">
          Run teardown
        </a>
      </nav>

      <section className="hero">
        <div className="heroCopy">
          <p className="eyebrow">Inspired by Kunal Shah&apos;s Delta 4 Framework</p>
          <h1>Is your startup a Delta 4 idea?</h1>
          <p className="subtitle">
            Find out if your product is truly behavior-changing or just another
            slightly-better startup idea.
          </p>
        </div>

        <div className="formulaCard" aria-label="Delta 4 formula">
          <div className="formulaHeader">
            <span>DELTA MATH</span>
            <span>OLD VS NEW</span>
          </div>
          <div className="formulaLine">Delta = New UX - Old UX</div>
          <p>
            If the gap is not painful, visible, and emotionally sticky, users drift
            back to the old behavior.
          </p>
        </div>
      </section>

      <section className="toolGrid" id="analyzer">
        <form className="formPanel" onSubmit={handleSubmit}>
          <div className="sectionHeader">
            <span>STARTUP INPUT</span>
            <h2>Founder teardown</h2>
            <p>Be specific. Weak inputs get weak analysis.</p>
          </div>

          <div className="sampleChips" aria-label="Sample ideas">
            {sampleIdeas.map((idea) => (
              <button type="button" key={idea} onClick={() => applySampleIdea(idea)}>
                {idea}
              </button>
            ))}
          </div>

          <label>
            <span>{fieldLabels.idea}</span>
            <textarea
              value={form.idea}
              onChange={(event) => updateField("idea", event.target.value)}
              placeholder="Example: AI co-pilot that helps D2C founders plan weekly retention experiments."
              rows={4}
              aria-invalid={touched && (missingFields.includes("idea") || invalidFields.includes("idea"))}
            />
            {invalidFields.includes("idea") ? <small>Give this field more useful detail.</small> : null}
          </label>

          <label>
            <span>{fieldLabels.targetUser}</span>
            <input
              value={form.targetUser}
              onChange={(event) => updateField("targetUser", event.target.value)}
              placeholder="Example: Seed-stage D2C founders"
              aria-invalid={
                touched && (missingFields.includes("targetUser") || invalidFields.includes("targetUser"))
              }
            />
            {invalidFields.includes("targetUser") ? <small>Be clear about the exact user.</small> : null}
          </label>

          <label>
            <span>{fieldLabels.currentAlternative}</span>
            <textarea
              value={form.currentAlternative}
              onChange={(event) => updateField("currentAlternative", event.target.value)}
              placeholder="Example: Agencies, spreadsheets, generic analytics dashboards, founder intuition."
              rows={3}
              aria-invalid={
                touched &&
                (missingFields.includes("currentAlternative") ||
                  invalidFields.includes("currentAlternative"))
              }
            />
            {invalidFields.includes("currentAlternative") ? (
              <small>Name what users actually do today.</small>
            ) : null}
          </label>

          <label>
            <span>{fieldLabels.differentiator}</span>
            <textarea
              value={form.differentiator}
              onChange={(event) => updateField("differentiator", event.target.value)}
              placeholder="Example: It turns live customer data into ranked experiments and writes the launch plan."
              rows={3}
              aria-invalid={
                touched &&
                (missingFields.includes("differentiator") || invalidFields.includes("differentiator"))
              }
            />
            {invalidFields.includes("differentiator") ? (
              <small>Say what changes behavior, not just what is convenient.</small>
            ) : null}
          </label>

          <label>
            <span>{fieldLabels.pricing}</span>
            <input
              value={form.pricing}
              onChange={(event) => updateField("pricing", event.target.value)}
              placeholder="Example: $199/month SaaS"
            />
          </label>

          {error ? <p className="errorMessage">{error}</p> : null}

          <button type="submit" disabled={loading}>
            {loading ? loadingMessages[loadingIndex] : "Analyze Delta 4"}
          </button>
        </form>

        <aside className="resultPanel" id="result" aria-live="polite">
          {!analysis && !loading ? (
            <div className="emptyState">
              <span>RESULT PREVIEW</span>
              <h2>Your share card will appear here.</h2>
              <p>
                The final result is designed to be screenshotable: score, verdict,
                switching truth, and the sharpest next move.
              </p>
            </div>
          ) : null}

          {loading ? (
            <div className="loadingState">
              <span>ANALYZING</span>
              <p>{loadingMessages[loadingIndex]}</p>
              <div className="loadingBar" />
            </div>
          ) : null}

          {analysis ? (
            <div className="analysis">
              <div
                className={`shareCard ${verdictClass(analysis.verdictLabel)}`}
                ref={resultCardRef}
              >
                <div className="shareCardTop">
                  <span>DELTA 4 ANALYZER</span>
                  <strong>{verdictText(analysis.verdictLabel)}</strong>
                </div>

                <div className="scoreCenter">
                  <span>DELTA SCORE</span>
                  <strong>{analysis.deltaScore}</strong>
                  <p>{analysis.oneLineTakeaway}</p>
                </div>

                <div className="scoreSplit">
                  <div>
                    <span>Old behavior</span>
                    <strong>{analysis.oldBehavior.scoreOutOf10}/10</strong>
                  </div>
                  <div>
                    <span>New behavior</span>
                    <strong>{analysis.newBehavior.scoreOutOf10}/10</strong>
                  </div>
                </div>

                <div className="goBack">
                  <span>Would users go back?</span>
                  <p>{analysis.wouldUsersGoBack}</p>
                </div>

                <ul className="cardBullets">
                  {cardBullets.map((bullet) => (
                    <li key={bullet.label}>
                      <span>{bullet.label}</span>
                      <p>{bullet.text}</p>
                    </li>
                  ))}
                </ul>

                <div className="shareCardFooter">
                  <span>delta4.analyzer</span>
                  <span>Inspired by Kunal Shah&apos;s Delta 4 framework</span>
                </div>
              </div>

              <div className="actionRow">
                <button type="button" onClick={copyResult}>
                  {copyLabel}
                </button>
                <button type="button" onClick={downloadScreenshot}>
                  {downloadLabel}
                </button>
                <button type="button" onClick={shareOnX}>
                  Share on X
                </button>
                <button type="button" className="secondaryButton" onClick={analyzeAnotherIdea}>
                  Analyze another idea
                </button>
              </div>

              <section className="resultSection">
                <h3>Verdict</h3>
                <p>{analysis.verdict}</p>
              </section>

              <section className="comparisonGrid">
                <article>
                  <span>OLD</span>
                  <h3>Old behavior</h3>
                  <strong>{analysis.oldBehavior.scoreOutOf10}/10</strong>
                  <p>{analysis.oldBehavior.description}</p>
                  <small>{analysis.oldBehavior.why}</small>
                </article>
                <article>
                  <span>NEW</span>
                  <h3>New behavior</h3>
                  <strong>{analysis.newBehavior.scoreOutOf10}/10</strong>
                  <p>{analysis.newBehavior.description}</p>
                  <small>{analysis.newBehavior.why}</small>
                </article>
              </section>

              <section className="resultSection">
                <h3>UBP / brag-worthiness</h3>
                <p>
                  <strong>{analysis.ubp.scoreOutOf10}/10</strong> {analysis.ubp.analysis}
                </p>
              </section>

              <ListBlock title="Risks" items={analysis.risks} />
              <ListBlock title="What makes it weak" items={analysis.whatMakesItWeak} />
              <ListBlock title="How to increase Delta" items={analysis.howToIncreaseDelta} />
            </div>
          ) : null}
        </aside>
      </section>

      <footer>
        Unofficial tool. Inspired by Kunal Shah&apos;s public Delta 4 mental model.
        Not affiliated with Kunal Shah or CRED.
      </footer>
    </main>
  );
}
