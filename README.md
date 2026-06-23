# Delta 4 Analyzer

A single-page Next.js tool that analyzes startup ideas through Kunal Shah's Delta 4 mental model.

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Add your Gemini API key to `.env.local`:

```bash
GEMINI_API_KEY=...
```

The API key is only read by the backend route at `/api/analyze`.
