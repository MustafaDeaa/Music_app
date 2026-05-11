# Music App

React/Vite app for analyzing a reference song, rewriting user lyrics or messages, and trying to generate audio through multiple providers.

## Run Locally

```powershell
npm install
npm run dev
```

Open:

```text
http://127.0.0.1:5173/
```

## Environment

Copy `.env.example` to `.env` and fill only the providers you want to use.

```env
GROQ_API_KEY=
SUNO_API_KEY=
RUNWARE_API_KEY=
FAL_KEY=
HF_API_KEY=
LOCAL_ACE_STEP_API_URL=
```

After changing `.env`, restart the Vite server.

## What May Not Work Yet

These are known development notes for future maintainers.

### Suno API

Suno can fail even with a valid key if the account has no credits. The current UI will report provider failure and continue to the next provider.

### Local ACE-Step

Local ACE-Step only works if the ACE-Step API server is running separately. The app expects the official ACE-Step 1.5 REST API, not the Gradio UI.

Expected local URL:

```env
LOCAL_ACE_STEP_API_URL=http://127.0.0.1:8001
```

Expected ACE-Step startup:

```powershell
uv run acestep-api
```

If ACE-Step is not running, the app will skip/fail that provider with a health-check error.

### fal.ai / Runware / Hugging Face

These providers need real API keys and may require account credit, billing, model access approval, or provider-specific quota. If a key is missing, the UI marks the provider as not enabled.

### Hugging Face Models

The Hugging Face fallback is best-effort. Some hosted inference models return JSON errors, queue messages, or unsupported audio formats depending on account permissions and model availability.

### Artist Style Safety

The lyric rewrite prompt intentionally avoids exact imitation of living artists. It uses high-level mood, language, pacing, and vocal direction instead of copying signature wording.

### Root README

There is a deleted `README.md` at the repository root in the current working tree. It was not included in the last upload. Decide later whether the repo should keep a root README or only this app README.

## Checks

```powershell
npm run lint
npm run build
```
