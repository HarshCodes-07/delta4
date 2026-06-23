"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

const APP_URL = "https://delta4.vercel.app";
const KUNAL_SHAH_IMAGE = "/images/kunalshah.jpeg";

type DeltaAnalysis = {
  oldBehavior: { description: string; scoreOutOf10: number; why: string };
  newBehavior: { description: string; scoreOutOf10: number; why: string };
  deltaScore: number;
  verdict: string;
  verdictLabel: "Delta 4" | "Not Delta 4" | "Borderline" | string;
  behaviorChange: string;
  wouldUsersGoBack: string;
  ubp: { scoreOutOf10: number; analysis: string };
  risks: string[];
  whatMakesItWeak: string[];
  howToIncreaseDelta: string[];
  oneLineTakeaway: string;
};

type AnalyzePayload = {
  idea: string;
  targetUser?: string;
  currentAlternative?: string;
  differentiator?: string;
  pricing?: string;
};

type ScrapeResult = {
  fields: {
    idea: string;
    targetUser: string;
    currentAlternative: string;
    differentiator: string;
    pricing: string;
  };
  confidence?: string;
};

type CardData = {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
  footer?: string;
  score?: string;
};

const sampleInputs = [
  "https://linear.app",
  "AI companion for startup founders",
];

const loadingMessages = [
  "Reading your startup...",
  "Understanding the current behaviour...",
  "Finding the switching cost...",
  "Estimating behavioural change...",
  "Looking for network effects...",
  "Evaluating brag-worthiness...",
  "Thinking like Kunal Shah...",
  "Calculating Delta...",
];

function verdictText(label: string) {
  if (label === "Delta 4") return "Excellent";
  if (label === "Borderline") return "Promising";
  return "Early";
}

function normalizePossibleUrl(rawInput: string) {
  const trimmed = rawInput.trim();
  const maybeUrl =
    /^https?:\/\//i.test(trimmed) ||
    /^www\./i.test(trimmed) ||
    (/^[a-z0-9-]+(\.[a-z0-9-]+)+\/?/i.test(trimmed) && !trimmed.includes(" "));

  if (!maybeUrl) return null;

  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function buildThread(analysis: DeltaAnalysis) {
  return `I just ran my startup through the Delta 4 Analyzer.

Score:

${analysis.deltaScore}/10

Here's why 👇

1.

Current behaviour:
${analysis.oldBehavior.description}

2.

New behaviour:
${analysis.newBehavior.description}

3.

Biggest strength:
${analysis.behaviorChange}

4.

What would make it a 10/10:
${analysis.howToIncreaseDelta[0] || "Make switching effortless and the new habit impossible to ignore."}

Analyze yours:

${APP_URL}`;
}

function buildCopyText(analysis: DeltaAnalysis) {
  return `My startup scored ${analysis.deltaScore}/10 on Delta 4.

Old behavior: ${analysis.oldBehavior.scoreOutOf10}/10
New behavior: ${analysis.newBehavior.scoreOutOf10}/10
Verdict: ${analysis.verdictLabel}

Takeaway: ${analysis.oneLineTakeaway}

Analyze yours: ${APP_URL}`;
}

function buildCards(analysis: DeltaAnalysis): CardData[] {
  return [
    {
      id: "score",
      eyebrow: "DELTA SCORE",
      title: verdictText(analysis.verdictLabel),
      score: String(analysis.deltaScore),
      body: analysis.oneLineTakeaway || "This has the shape of behavior change.",
      footer: "Inspired by Kunal Shah's Delta 4 Framework",
    },
    {
      id: "behavior",
      eyebrow: "OLD VS NEW BEHAVIOUR",
      title: `${analysis.oldBehavior.scoreOutOf10}/10 → ${analysis.newBehavior.scoreOutOf10}/10`,
      body: `${analysis.oldBehavior.description} → ${analysis.newBehavior.description}`,
      footer: "The gap is the product.",
    },
    {
      id: "works",
      eyebrow: "WHY THIS WORKS",
      title: "The switching story",
      body: analysis.behaviorChange || analysis.verdict,
      footer: analysis.wouldUsersGoBack,
    },
    {
      id: "opportunity",
      eyebrow: "BIGGEST OPPORTUNITY",
      title: "Make it a habit",
      body:
        analysis.howToIncreaseDelta[0] ||
        "Make switching feel instant, repeated, and socially obvious.",
      footer: "Good startup. Better habit loop.",
    },
    {
      id: "risks",
      eyebrow: "RISKS",
      title: "What could cap the score",
      body: analysis.risks[0] || "The old workflow may still feel good enough.",
      footer: analysis.risks[1] || "Reduce switching friction.",
    },
    {
      id: "ten",
      eyebrow: "HOW TO REACH 10/10",
      title: "Push the Delta",
      body:
        analysis.howToIncreaseDelta[1] ||
        analysis.howToIncreaseDelta[0] ||
        "Own the workflow, not just the feature.",
      footer: "The workflow is the innovation.",
    },
  ];
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
  const [input, setInput] = useState("");
  const [analysis, setAnalysis] = useState<DeltaAnalysis | null>(null);
  const [lastPayload, setLastPayload] = useState<AnalyzePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingIndex, setLoadingIndex] = useState(0);
  const [error, setError] = useState("");
  const [copyLabel, setCopyLabel] = useState("Copy Result");
  const [threadLabel, setThreadLabel] = useState("Generate Thread");
  const [sourceNote, setSourceNote] = useState("");
  const [showDeltaModal, setShowDeltaModal] = useState(false);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const detectedUrl = normalizePossibleUrl(input);
  const cards = analysis ? buildCards(analysis) : [];

  useEffect(() => {
    if (!loading) {
      setLoadingIndex(0);
      return;
    }

    const interval = window.setInterval(() => {
      setLoadingIndex((current) => (current + 1) % loadingMessages.length);
    }, 1400);

    return () => window.clearInterval(interval);
  }, [loading]);

  async function renderCard(cardId: string) {
    const element = cardRefs.current[cardId];
    if (!element) return null;

    const html2canvas = (await import("html2canvas")).default;
    return html2canvas(element, {
      backgroundColor: "#080808",
      scale: 2,
      useCORS: true,
    });
  }

  async function downloadCard(cardId: string) {
    const canvas = await renderCard(cardId);
    if (!canvas) return;

    const link = document.createElement("a");
    link.download = `delta4-${cardId}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  async function copyCardImage(cardId: string) {
    const canvas = await renderCard(cardId);
    if (!canvas || !navigator.clipboard || !("ClipboardItem" in window)) return;

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) return;

    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
  }

  async function runAnalysis(payload: AnalyzePayload, mode: "analysis" | "website" = "analysis") {
    if (payload.idea.trim().length < 12) {
      setError("Give us a little more context so the analysis is useful.");
      return false;
    }

    setLoading(true);
    setAnalysis(null);
    setError("");
    window.setTimeout(() => {
      document.getElementById("result")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 45_000);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(body?.error || "Couldn't analyze right now. Please try again.");
      }

      setLastPayload(payload);
      setAnalysis(body.analysis);
      window.setTimeout(() => {
        document.getElementById("result")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
      return true;
    } catch (submitError) {
      setError(
        submitError instanceof DOMException && submitError.name === "AbortError"
          ? "Couldn't analyze right now. Please try again."
          : submitError instanceof Error
            ? submitError.message
            : "Couldn't analyze right now. Please try again.",
      );
      return false;
    } finally {
      window.clearTimeout(timeout);
      setLoading(false);
    }
  }

  async function analyzeWebsite(url: string) {
    setLoading(true);
    setAnalysis(null);
    setError("");
    setSourceNote("");
    window.setTimeout(() => {
      document.getElementById("result")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 55_000);

    try {
      const response = await fetch("/api/scrape", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(body?.error || "Couldn't understand this website clearly. Try describing the idea.");
      }

      const scrape = body as ScrapeResult;
      const payload = {
        idea: scrape.fields.idea,
        targetUser: scrape.fields.targetUser,
        currentAlternative: scrape.fields.currentAlternative,
        differentiator: scrape.fields.differentiator,
        pricing: scrape.fields.pricing,
      };

      setInput(scrape.fields.idea || url);
      setSourceNote(
        `Extracted from website${scrape.confidence ? ` (${scrape.confidence} confidence)` : ""}.`,
      );

      window.clearTimeout(timeout);
      setLoading(false);
      await runAnalysis(payload, "website");
    } catch (scrapeError) {
      setError(
        scrapeError instanceof DOMException && scrapeError.name === "AbortError"
          ? "The website took too long to respond. Try describing the idea instead."
          : scrapeError instanceof Error
            ? scrapeError.message
            : "Couldn't understand this website clearly. Try describing the idea.",
      );
      setLoading(false);
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;

    const trimmed = input.trim();
    setError("");
    setSourceNote("");

    if (!trimmed) {
      setError("Paste a website URL or describe your startup idea.");
      return;
    }

    const url = normalizePossibleUrl(trimmed);
    if (url) {
      await analyzeWebsite(url);
      return;
    }

    await runAnalysis({ idea: trimmed });
  }

  async function copyResult() {
    if (!analysis) return;

    await navigator.clipboard.writeText(buildCopyText(analysis));
    setCopyLabel("Copied");
    window.setTimeout(() => setCopyLabel("Copy Result"), 1800);
  }

  async function copyThread() {
    if (!analysis) return;

    await navigator.clipboard.writeText(buildThread(analysis));
    setThreadLabel("Thread Copied");
    window.setTimeout(() => setThreadLabel("Generate Thread"), 1800);
  }

  function shareOnX(card?: CardData) {
    if (!analysis) return;

    const text = card
      ? `Delta Score: ${analysis.deltaScore}/10\n\n${card.eyebrow}\n${card.title}\n\n${card.body}\n\nAnalyze yours: ${APP_URL}`
      : buildThread(analysis);

    window.open(
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`,
      "_blank",
      "noopener,noreferrer",
    );
  }

  function resetForAnother() {
    setAnalysis(null);
    setError("");
    setSourceNote("");
    document.getElementById("analyzer")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const showConfetti = !!analysis && analysis.deltaScore > 8;

  return (
    <main className="shell">
      {showConfetti ? (
        <div className="confetti" aria-hidden="true">
          {Array.from({ length: 18 }).map((_, index) => (
            <span key={index} style={{ "--i": index } as React.CSSProperties} />
          ))}
        </div>
      ) : null}

      <nav className="nav" aria-label="Primary">
        <div className="brand" aria-label="Delta 4 Analyzer">
          <span>DELTA_4</span>
          <span>ANALYZER</span>
        </div>
        <div className="navActions">
          <button type="button" className="navCta" onClick={() => setShowDeltaModal(true)}>
            ? Know about Delta 4
          </button>
          
        </div>
      </nav>

      <section className="hero centeredHero">
        <div className="heroInspiration">
          <img
            src={KUNAL_SHAH_IMAGE}
            alt="Kunal Shah"
            className="kunalAvatar kunalAvatarLg"
            width={72}
            height={72}
          />
          <p className="eyebrow">Inspired by Kunal Shah&apos;s Delta 4 framework</p>
        </div>
        <h1>Will your startup create Delta 4?</h1>
        <p className="subtitle">
          A mental model from Kunal Shah to evaluate whether your startup creates
          irreversible behaviour change — not just a slightly better product.
        </p>
        <button type="button" className="learnButton" onClick={() => setShowDeltaModal(true)}>
          ? Know about Delta 4
        </button>
      </section>

      <section className="inputWrap" id="analyzer">
        <form className="inputCard" onSubmit={handleSubmit}>
          <div className="inputModes">
            <div>
              <span>🌐 Analyze Website</span>
              <small>Paste your startup URL</small>
            </div>
            <b>OR</b>
            <div>
              <span>💡 Describe Your Idea</span>
              <small>Write your startup idea manually</small>
            </div>
          </div>

          <textarea
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
              setError("");
              setSourceNote("");
            }}
            placeholder="https://example.com&#10;&#10;or&#10;&#10;AI tool that helps founders negotiate term sheets before they speak to counsel."
            rows={8}
            aria-invalid={!!error && !analysis}
          />

          {sourceNote ? <p className="extractedNotice">[+] {sourceNote}</p> : null}

          <div className="sampleChips" aria-label="Sample inputs">
            {sampleInputs.map((sample) => (
              <button
                type="button"
                key={sample}
                onClick={() => {
                  setInput(sample);
                  setError("");
                  setSourceNote("");
                }}
              >
                {sample}
              </button>
            ))}
          </div>

          {error ? <p className="errorMessage">[-] {error}</p> : null}

          <button type="submit" disabled={loading} className="analyzeButton">
            {loading ? loadingMessages[loadingIndex] : "Analyze"}
          </button>
        </form>
      </section>

      <section className="resultArea" id="result" aria-live="polite">
        {!analysis && !loading ? (
          <div className="emptyState">
            <span>[result]</span>
            <h2>Your screenshot-ready cards will appear here.</h2>
            <p>Score, behavior shift, biggest upside, and a ready-to-post thread.</p>
          </div>
        ) : null}

        {loading ? (
          <div className="loadingState skeletonPanel">
            <img
              src={KUNAL_SHAH_IMAGE}
              alt=""
              aria-hidden="true"
              className={`kunalAvatar ${loadingMessages[loadingIndex].includes("Kunal Shah") ? "kunalAvatarPulse" : ""}`}
              width={48}
              height={48}
            />
            <span>[calculating_delta]</span>
            <p>{loadingMessages[loadingIndex]}</p>
            <div className="loadingBar" />
          </div>
        ) : null}

        {analysis ? (
          <div className="analysis">
            <div className="topActions">
              <button type="button" onClick={copyResult}>
                {copyLabel}
              </button>
              <button type="button" onClick={copyThread}>
                {threadLabel}
              </button>
              <button type="button" onClick={() => shareOnX()}>
                Share Thread on X
              </button>
              <button type="button" className="secondaryButton" onClick={resetForAnother}>
                Analyze another
              </button>
            </div>

            <div className="cardGrid">
              {cards.map((card) => (
                <article key={card.id} className="shareCardShell">
                  <div
                    className={`postCard ${card.id === "score" ? "heroPostCard" : ""}`}
                    ref={(element) => {
                      cardRefs.current[card.id] = element;
                    }}
                  >
                    <div className="postCardBrand">
                      <span>{card.eyebrow}</span>
                      <span>delta4.vercel.app</span>
                    </div>

                    {card.score ? <strong className="postScore">{card.score}</strong> : null}
                    <h2>{card.title}</h2>
                    <p>{card.body}</p>
                    {card.footer ? (
                      <small className={card.id === "score" ? "postCardAttribution" : ""}>
                        {card.id === "score" ? (
                          <>
                            <img
                              src={KUNAL_SHAH_IMAGE}
                              alt=""
                              aria-hidden="true"
                              className="kunalAvatar kunalAvatarSm"
                              width={24}
                              height={24}
                            />
                            <span>{card.footer}</span>
                          </>
                        ) : (
                          card.footer
                        )}
                      </small>
                    ) : null}
                  </div>

                  <div className="cardActions">
                    <button type="button" onClick={() => downloadCard(card.id)}>
                      Download PNG
                    </button>
                    <button type="button" onClick={() => copyCardImage(card.id)}>
                      Copy Image
                    </button>
                    <button type="button" onClick={() => shareOnX(card)}>
                      Share to X
                    </button>
                  </div>
                </article>
              ))}
            </div>

            <div className="reportGrid">
              <ListBlock title="Risks" items={analysis.risks} />
              <ListBlock title="How to reach 10/10" items={analysis.howToIncreaseDelta} />
            </div>
          </div>
        ) : null}
      </section>

      {showDeltaModal ? (
        <div className="modalOverlay" role="presentation" onClick={() => setShowDeltaModal(false)}>
          <section
            className="deltaModal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delta-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modalTop">
              <span>[framework]</span>
              <button type="button" onClick={() => setShowDeltaModal(false)}>
                Close
              </button>
            </div>
            <h2 id="delta-modal-title">What is Delta 4?</h2>
            <p>
              Delta 4 is a mental model popularized by Kunal Shah for judging whether a
              new product experience is meaningfully better than the old behavior.
            </p>
            <div className="formulaExplainer">
              Delta = New experience score - Old experience score
            </div>
            <p>
              If the difference is large enough, users do not merely try the product.
              They change behavior. The old way starts feeling slow, clunky, expensive,
              embarrassing, or outdated.
            </p>
            <div className="modalGrid">
              <article>
                <h3>Why 4 matters</h3>
                <p>
                  A small improvement creates curiosity. A Delta 4 improvement creates
                  a new default: users struggle to go back.
                </p>
              </article>
              <article>
                <h3>What raises Delta</h3>
                <p>
                  Speed, lower effort, emotional pull, habit frequency, status,
                  network effects, and low switching friction.
                </p>
              </article>
              <article>
                <h3>What lowers Delta</h3>
                <p>
                  Thin wrappers, discount-only behavior, unclear users, rare usage,
                  and alternatives that are already good enough.
                </p>
              </article>
              <article>
                <h3>How to use the score</h3>
                <p>
                  Treat it as a product lens. Make the new behavior easier, more
                  repeatable, and harder to abandon.
                </p>
              </article>
            </div>
            <p className="modalDisclaimer">
              Unofficial explanation. Inspired by Kunal Shah&apos;s public Delta 4
              mental model. Not affiliated with Kunal Shah or CRED.
            </p>
          </section>
        </div>
      ) : null}

      <footer>
        <div className="footerAttribution">
          <img
            src={KUNAL_SHAH_IMAGE}
            alt="Kunal Shah"
            className="kunalAvatar"
            width={40}
            height={40}
          />
          <p>
            Unofficial tool inspired by Kunal Shah&apos;s public Delta 4 mental model.
            Not affiliated with Kunal Shah or CRED.
          </p>
        </div>
      </footer>
    </main>
  );
}
