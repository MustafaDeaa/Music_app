import { useState, useRef } from "react";

// يمر عبر Vite proxy → Groq (OpenAI-compatible)، يتفادى CORS ويخفي المفتاح في .env
const GROQ_MODEL = "llama-3.3-70b-versatile";

const chatCompletion = async (userContent, maxTokens = 1200) => {
  const response = await fetch("/api/llm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: "user", content: userContent }],
      max_tokens: maxTokens,
      temperature: 0.35,
    }),
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(raw || response.statusText);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON from API");
  }
  const text = data.choices?.[0]?.message?.content;
  if (!text || typeof text !== "string") {
    throw new Error("Empty model response");
  }
  return text;
};

const parseJsonFromLlm = (text) => {
  const clean = text.replace(/```json|```/g, "").trim();
  const jsonMatch = clean.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
};

const fallbackRewriteResult = (text) => ({
  rewritten_lyrics: text.replace(/```/g, "").trim(),
  explanation: "تم إنشاء النتيجة كنص مباشر لأن جواب الذكاء لم يرجع بصيغة JSON كاملة.",
  tips: "اقرأها بصوتك وعدّل طول السطور حسب اللحن والإيقاع.",
});

// ── Step 1: معلومات الأغنية (معرفة النموذج؛ ليس بحثاً حياً على الويب) ──
const normalizeSongQuery = (value) => {
  const raw = value.trim().replace(/\s+/g, " ");
  const cleaned = raw
    .replace(/\((official|audio|video|lyrics?|music video|visualizer|remaster(?:ed)?)\)/gi, "")
    .replace(/\[(official|audio|video|lyrics?|music video|visualizer|remaster(?:ed)?)\]/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  const parts = (cleaned || raw)
    .split(/\s+(?:-|–|—|by|BY|By)\s+/)
    .map(part => part.trim())
    .filter(Boolean);

  return {
    raw,
    cleaned: cleaned || raw,
    title: parts.length >= 2 ? parts[0] : "",
    artist: parts.length >= 2 ? parts.slice(1).join(" - ") : "",
  };
};

const buildSongSearchPrompt = ({ raw, cleaned, title, artist, relaxed = false }) => `You are a global music metadata expert, not only an Arabic music expert.
Identify songs from Arabic, English, indie, underground, and international catalogs using your reliable knowledge.

User input: "${raw}"
Cleaned input: "${cleaned}"
${title && artist ? `Parsed as:
- song title: "${title}"
- artist/band: "${artist}"

The user likely wrote the common "Title - Artist" format. Treat it as title first and artist second unless there is strong evidence it is reversed.` : ""}

Search rules:
- Do not reject a song just because it is non-Arabic, indie, or less mainstream.
- Accept punctuation, capitalization, spacing, and minor spelling variations.
- If both title and artist are supplied, use the pair together before deciding not found.
- ${relaxed ? "This is a fallback pass: be more tolerant of lesser-known releases, alternate artist spellings, and catalog tracks." : "Only return found=false when you genuinely cannot identify the song/artist pair."}
- Do not invent exact lyrics. For sample_lyrics, give an empty string or a very short recognizable cue of no more than 8 words.

Return JSON only, with no markdown and no extra text:
{
  "found": true,
  "singer": "artist or band name",
  "genre": "genre in Arabic",
  "mood": "one of: حزين, فرحان, رومانسي, حماسي",
  "energy": 7,
  "tempo": "بطيء أو متوسط أو سريع",
  "themes": "main themes in Arabic",
  "vocal_style": "vocal/performance style in Arabic",
  "language_style": "language or dialect in Arabic",
  "signature_phrases": "brief stylistic fingerprint in Arabic",
  "sample_lyrics": ""
}

If you still cannot identify it with reasonable confidence, return:
{ "found": false }`;

const searchSong = async (songName) => {
  const query = normalizeSongQuery(songName);
  const firstText = await chatCompletion(buildSongSearchPrompt(query), 1200);
  const firstParsed = parseJsonFromLlm(firstText);
  if (firstParsed && typeof firstParsed.found === "boolean" && firstParsed.found) {
    return firstParsed;
  }

  if (query.title && query.artist) {
    const fallbackText = await chatCompletion(
      buildSongSearchPrompt({
        ...query,
        raw: `${query.title} by ${query.artist}`,
        cleaned: `${query.title} by ${query.artist}`,
        relaxed: true,
      }),
      1200
    );
    const fallbackParsed = parseJsonFromLlm(fallbackText);
    if (fallbackParsed && typeof fallbackParsed.found === "boolean") {
      return fallbackParsed;
    }
  }

  if (!query.title && !query.artist) {
    const arabicFallback = await searchArabicSongFallback(songName);
    if (arabicFallback.found) {
      return arabicFallback;
    }
  }

  return firstParsed && typeof firstParsed.found === "boolean" ? firstParsed : { found: false };
};

const searchArabicSongFallback = async (songName) => {
  const text = await chatCompletion(
    `أنت خبير موسيقى عربي. استخدم معلوماتك الموثوقة عن الأغاني المعروفة.

الأغنية: "${songName}"

إذا عرفت الأغنية والمغني بثقة، أعطِ JSON فقط بدون أي نص إضافي أو backticks:
{
  "found": true,
  "singer": "اسم المغني",
  "genre": "النوع الموسيقي",
  "mood": "المزاج العام (حزين أو فرحان أو رومانسي أو حماسي)",
  "energy": 7,
  "tempo": "بطيء أو متوسط أو سريع",
  "themes": "المواضيع الرئيسية",
  "vocal_style": "أسلوب الصوت",
  "language_style": "فصحى أو عامية أو مزيج",
  "signature_phrases": "لمسة خاصة بالمغني في الكلمات",
  "sample_lyrics": "مقتطف معروف من كلمات الأغنية (3-4 أسطر) إن أمكن"
}

إذا لم تكن متأكداً أو الأغنية غير معروفة: { "found": false }`,
    1200
  );
  const parsed = parseJsonFromLlm(text);
  return parsed && typeof parsed.found === "boolean" ? parsed : { found: false };
};

// ── Step 2: تحليل من لينك + اسم (معرفة النموذج) ──
const analyzeFromUrl = async (url, songName) => {
  const text = await chatCompletion(
    `المستخدم أعطى رابطاً يخص أغنية والاسم التقريبي.
الرابط: ${url}
اسم الأغنية: ${songName}

استنتج من الرابط والاسم إن أمكن من معلوماتك. أعطِ JSON فقط بدون أي نص إضافي أو backticks:
{
  "found": true,
  "singer": "اسم المغني",
  "genre": "النوع الموسيقي",
  "mood": "المزاج العام (حزين أو فرحان أو رومانسي أو حماسي)",
  "energy": 7,
  "tempo": "بطيء أو متوسط أو سريع",
  "themes": "المواضيع الرئيسية",
  "vocal_style": "أسلوب الصوت",
  "language_style": "فصحى أو عامية أو مزيج",
  "signature_phrases": "لمسة خاصة بالمغني في الكلمات",
  "sample_lyrics": "مقتطف من كلمات الأغنية (3-4 أسطر) إن أمكن"
}

إذا تعذر: { "found": false }`,
    1200
  );
  const parsed = parseJsonFromLlm(text);
  return parsed && typeof parsed.found === "boolean" ? parsed : { found: false };
};

// ── Step 3: إعادة صياغة الكلمات ──
const rewriteLyrics = async (analysis, newLyrics, rewriteMode = "lyrics") => {
  const isMessageMode = rewriteMode === "message";
  const task = isMessageMode
    ? "Turn the user's message into original singable lyrics."
    : "Rewrite the user's draft lyrics into stronger original singable lyrics.";
  const userInputLabel = isMessageMode
    ? "User message the singer should communicate"
    : "User draft lyrics";
  const instruction = isMessageMode
    ? "Keep the user's core meaning, make it feel direct and emotional, and structure it as short lyrical lines with a natural hook or repeated phrase."
    : "Keep the user's meaning, improve flow, rhyme, phrasing, and musicality.";

  const text = await chatCompletion(
    `You are a professional songwriter.

Task: ${task}

Reference artist: ${analysis.singer}
Vocal/performance traits: ${analysis.vocal_style}
Mood: ${analysis.mood}
Energy: ${analysis.energy}/10
Language style: ${analysis.language_style}
Stylistic notes: ${analysis.signature_phrases}

Important safety and quality rules:
- Write NEW original lyrics only.
- Do not copy lyrics from any existing song.
- Do not claim this is exactly the artist's real writing.
- Use broad, high-level inspiration from the reference artist's mood, pacing, vocal energy, and language feel.
- Avoid direct imitation of a living artist's unique signature wording.

${userInputLabel}:
"""${newLyrics}"""

${instruction}

Return valid JSON only, with no markdown and no text outside the JSON:
{
  "rewritten_lyrics": "the final lyrics in Arabic or the user's language, with line breaks",
  "explanation": "short Arabic explanation of how the mood and performance traits were applied",
  "tips": "short Arabic performance tips"
}`,
    1800
  );
  const parsed = parseJsonFromLlm(text);
  if (parsed?.rewritten_lyrics) {
    return parsed;
  }
  if (text.trim()) {
    return fallbackRewriteResult(text);
  }
  throw new Error("Empty rewrite response");
};

// ── Mood → color palette ──
const moodColors = {
  "حزين":    { bg: "#1a1a2e", accent: "#7b68ee", glow: "#7b68ee40" },
  "فرحان":   { bg: "#1a2a1a", accent: "#50c878", glow: "#50c87840" },
  "رومانسي": { bg: "#2a1a1a", accent: "#ff6b9d", glow: "#ff6b9d40" },
  "حماسي":   { bg: "#2a1a0a", accent: "#ff8c00", glow: "#ff8c0040" },
  default:   { bg: "#0f0f1a", accent: "#00d4ff", glow: "#00d4ff40" },
};

const Spinner = () => (
  <span style={{
    width: "16px", height: "16px",
    border: "2px solid #fff3", borderTop: "2px solid #fff",
    borderRadius: "50%", display: "inline-block",
    animation: "spin 0.8s linear infinite",
  }} />
);

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const audioProviderFlags = {
  suno: import.meta.env.VITE_HAS_SUNO_API_KEY === "true",
  fal: import.meta.env.VITE_HAS_FAL_KEY === "true",
  runware: import.meta.env.VITE_HAS_RUNWARE_API_KEY === "true",
  huggingFace: import.meta.env.VITE_HAS_HF_API_KEY === "true",
  localAce: import.meta.env.VITE_HAS_LOCAL_ACE_STEP_API_URL === "true",
};

const trimForSuno = (value, max) => value.replace(/\s+/g, " ").trim().slice(0, max);

const createAudioPrompt = ({ lyrics, analysis, songName }) => [
  `Title: ${songName || "Original song"}`,
  `Style: ${analysis.genre || "modern pop"}, ${analysis.mood || "emotional"}, ${analysis.tempo || "medium tempo"}`,
  `Vocal direction: ${analysis.vocal_style || "expressive vocals"}`,
  `Language style: ${analysis.language_style || "natural lyrics"}`,
  "Use the following original lyrics:",
  lyrics,
].filter(Boolean).join("\n");

const normalizeAudioTracks = (tracks, provider, fallbackTitle) => tracks
  .map((track, index) => ({
    id: track.id || track.audioUUID || `${provider}-${index}`,
    provider,
    title: track.title || fallbackTitle || `نسخة ${index + 1}`,
    audioUrl: track.audioUrl || track.audioURL || track.streamAudioUrl || track.url || track.audio,
    duration: track.duration,
  }))
  .filter(track => track.audioUrl);

const requestSunoJson = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const raw = await response.text();
  let data;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    throw new Error(raw || "Invalid Suno response");
  }
  if (!response.ok || data?.code !== 200) {
    throw new Error(data?.msg || data?.data?.errorMessage || response.statusText);
  }
  return data;
};

const generateWithSuno = async ({ lyrics, analysis, songName }) => {
  const style = trimForSuno(
    [
      analysis.genre,
      analysis.mood,
      analysis.tempo,
      analysis.vocal_style,
      "original vocals",
      "modern production",
    ].filter(Boolean).join(", "),
    1000
  );
  const title = trimForSuno(songName || `Original ${analysis.singer || "Song"}`, 80);

  const createData = await requestSunoJson("/api/suno/generate", {
    method: "POST",
    body: JSON.stringify({
      customMode: true,
      instrumental: false,
      model: "V5",
      prompt: lyrics.slice(0, 5000),
      style,
      title,
      callBackUrl: "https://example.com/suno-callback",
    }),
  });

  const taskId = createData?.data?.taskId;
  if (!taskId) {
    throw new Error("Suno did not return a task id");
  }

  for (let attempt = 0; attempt < 24; attempt += 1) {
    await sleep(attempt === 0 ? 2500 : 5000);
    const details = await requestSunoJson(`/api/suno/generate/record-info?taskId=${encodeURIComponent(taskId)}`);
    const status = details?.data?.status;
    const tracks = details?.data?.response?.sunoData || [];

    if (tracks.length > 0 && (status === "FIRST_SUCCESS" || status === "SUCCESS")) {
      return { provider: "Suno API", taskId, status, tracks: normalizeAudioTracks(tracks, "Suno API", title) };
    }
    if (["CREATE_TASK_FAILED", "GENERATE_AUDIO_FAILED", "SENSITIVE_WORD_ERROR"].includes(status)) {
      throw new Error(details?.data?.errorMessage || `Suno failed with status ${status}`);
    }
  }

  return { provider: "Suno API", taskId, status: "PENDING", tracks: [] };
};

const requestHuggingFaceAudio = async (url, prompt, provider) => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      inputs: prompt,
      parameters: { duration: 30 },
      options: { wait_for_model: true },
    }),
  });
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok) {
    const message = contentType.includes("application/json")
      ? (await response.json())?.error
      : await response.text();
    throw new Error(message || `${provider} failed`);
  }
  if (contentType.includes("application/json")) {
    const data = await response.json();
    throw new Error(data?.error || `${provider} did not return audio`);
  }
  const blob = await response.blob();
  return URL.createObjectURL(blob);
};

const generateWithHfMusicGen = async ({ lyrics, analysis, songName }) => {
  const prompt = createAudioPrompt({ lyrics, analysis, songName });
  const audioUrl = await requestHuggingFaceAudio("/api/hf-musicgen", prompt, "MusicGen");
  return {
    provider: "MusicGen / Hugging Face",
    status: "SUCCESS",
    tracks: [{ id: "hf-musicgen-1", provider: "MusicGen / Hugging Face", title: songName || "MusicGen", audioUrl }],
  };
};

const generateWithStableAudio = async ({ lyrics, analysis, songName }) => {
  const prompt = createAudioPrompt({ lyrics, analysis, songName });
  const audioUrl = await requestHuggingFaceAudio("/api/hf-stable-audio", prompt, "Stable Audio Open");
  return {
    provider: "Stable Audio Open / Hugging Face",
    status: "SUCCESS",
    tracks: [{ id: "hf-stable-audio-1", provider: "Stable Audio Open / Hugging Face", title: songName || "Stable Audio", audioUrl }],
  };
};

const requestFalJson = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.detail || data?.message || data?.error || response.statusText);
  }
  return data;
};

const extractFalAudioUrl = (value) => (
  value?.audio?.url ||
  value?.data?.audio?.url ||
  value?.output?.audio?.url ||
  value?.result?.audio?.url
);

const generateWithFalAce = async ({ lyrics, analysis, songName }) => {
  const tags = trimForSuno(
    [analysis.genre, analysis.mood, analysis.tempo, analysis.vocal_style]
      .filter(Boolean)
      .join(", "),
    500
  );
  const submit = await requestFalJson("/api/fal/fal-ai/ace-step", {
    method: "POST",
    body: JSON.stringify({
      tags: tags || "pop, emotional, modern",
      lyrics,
      duration: 60,
      number_of_steps: 27,
    }),
  });
  const requestId = submit.request_id || submit.requestId;
  const immediateAudioUrl = extractFalAudioUrl(submit);
  if (!requestId && immediateAudioUrl) {
    return {
      provider: "fal.ai ACE-Step",
      status: "SUCCESS",
      tracks: [{
        id: "fal-ace-step-1",
        provider: "fal.ai ACE-Step",
        title: songName || "ACE-Step",
        audioUrl: immediateAudioUrl,
      }],
    };
  }
  if (!requestId) {
    throw new Error("fal.ai did not return a request id");
  }

  for (let attempt = 0; attempt < 36; attempt += 1) {
    await sleep(attempt === 0 ? 2500 : 5000);
    const status = await requestFalJson(`/api/fal/fal-ai/ace-step/requests/${encodeURIComponent(requestId)}/status`);
    if (status.status === "COMPLETED") {
      const result = await requestFalJson(`/api/fal/fal-ai/ace-step/requests/${encodeURIComponent(requestId)}`);
      const audioUrl = extractFalAudioUrl(result);
      if (!audioUrl) {
        throw new Error("fal.ai result did not include audio");
      }
      return {
        provider: "fal.ai ACE-Step",
        taskId: requestId,
        status: "SUCCESS",
        tracks: [{ id: requestId, provider: "fal.ai ACE-Step", title: songName || "ACE-Step", audioUrl }],
      };
    }
    if (["FAILED", "ERROR"].includes(status.status)) {
      throw new Error(status.error || "fal.ai generation failed");
    }
  }

  return { provider: "fal.ai ACE-Step", taskId: requestId, status: "PENDING", tracks: [] };
};

const requestRunwareJson = async (body) => {
  const response = await fetch("/api/runware", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.errors?.length) {
    throw new Error(data?.errors?.[0]?.message || response.statusText || "Runware failed");
  }
  return data;
};

const generateWithRunwareAce = async ({ lyrics, analysis, songName }) => {
  const taskUUID = crypto.randomUUID();
  const prompt = trimForSuno(createAudioPrompt({ lyrics, analysis, songName }), 1800);
  const data = await requestRunwareJson([{
    taskType: "audioInference",
    taskUUID,
    model: "runware:ace-step@v1.5-base",
    positivePrompt: prompt,
    duration: 30,
    outputType: "URL",
    outputFormat: "MP3",
    deliveryMethod: "sync",
    numberResults: 1,
  }]);
  const tracks = normalizeAudioTracks(data?.data || [], "Runware ACE-Step", songName);
  if (!tracks.length) {
    throw new Error("Runware did not return an audio URL");
  }
  return { provider: "Runware ACE-Step", taskId: taskUUID, status: "SUCCESS", tracks };
};

const generateWithLocalAce = async ({ lyrics, analysis, songName }) => {
  const prompt = createAudioPrompt({ lyrics, analysis, songName });
  const healthResponse = await fetch("/api/local-ace/health").catch(() => null);
  if (!healthResponse?.ok) {
    throw new Error("ACE-Step المحلي غير شغال. شغّل uv run acestep-api وتأكد أن LOCAL_ACE_STEP_API_URL يشير إلى http://127.0.0.1:8001");
  }
  const createResponse = await fetch("/api/local-ace/release_task", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      lyrics,
      prompt,
      audio_duration: 60,
      vocal_language: "ar",
      audio_format: "mp3",
      thinking: true,
      use_format: true,
      inference_steps: 8,
      batch_size: 1,
    }),
  });
  const createData = await createResponse.json().catch(() => null);
  if (!createResponse.ok || createData?.code !== 200) {
    throw new Error(createData?.error || createData?.detail || "Local ACE-Step server is not available");
  }
  const taskId = createData?.data?.task_id;
  if (!taskId) {
    throw new Error("Local ACE-Step did not return a task id");
  }

  for (let attempt = 0; attempt < 36; attempt += 1) {
    await sleep(attempt === 0 ? 2500 : 5000);
    const queryResponse = await fetch("/api/local-ace/query_result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task_id_list: [taskId] }),
    });
    const queryData = await queryResponse.json().catch(() => null);
    if (!queryResponse.ok || queryData?.code !== 200) {
      throw new Error(queryData?.error || queryData?.detail || "Local ACE-Step query failed");
    }
    const item = queryData?.data?.[0];
    if (item?.status === 1) {
      const parsed = typeof item.result === "string" ? JSON.parse(item.result || "[]") : item.result;
      const tracks = (parsed || []).map((track, index) => ({
        id: `${taskId}-${index}`,
        provider: "Local ACE-Step",
        title: songName || "ACE-Step",
        audioUrl: track.file?.startsWith("http") ? track.file : `/api/local-ace${track.file}`,
      })).filter(track => track.audioUrl);
      if (!tracks.length) {
        throw new Error("Local ACE-Step completed but did not return audio files");
      }
      return { provider: "Local ACE-Step", taskId, status: "SUCCESS", tracks };
    }
    if (item?.status === 2) {
      throw new Error("Local ACE-Step generation failed");
    }
  }

  return { provider: "Local ACE-Step", taskId, status: "PENDING", tracks: [] };
};

const audioProviders = [
  {
    name: "Suno API",
    enabled: audioProviderFlags.suno,
    missing: "SUNO_API_KEY غير موجود",
    run: generateWithSuno,
  },
  {
    name: "fal.ai ACE-Step API",
    enabled: audioProviderFlags.fal,
    missing: "FAL_KEY غير موجود",
    run: generateWithFalAce,
  },
  {
    name: "Runware ACE-Step API",
    enabled: audioProviderFlags.runware,
    missing: "RUNWARE_API_KEY غير موجود",
    run: generateWithRunwareAce,
  },
  {
    name: "MusicGen / Hugging Face",
    enabled: audioProviderFlags.huggingFace,
    missing: "HF_API_KEY غير موجود",
    run: generateWithHfMusicGen,
  },
  {
    name: "Stable Audio Open / Hugging Face",
    enabled: audioProviderFlags.huggingFace,
    missing: "HF_API_KEY غير موجود",
    run: generateWithStableAudio,
  },
  {
    name: "Local ACE-Step",
    enabled: audioProviderFlags.localAce,
    missing: "LOCAL_ACE_STEP_API_URL غير موجود أو السيرفر المحلي غير مشغّل",
    run: generateWithLocalAce,
  },
];

const generateSongAudio = async (input, onAttempt) => {
  const errors = [];
  for (const provider of audioProviders) {
    if (!provider.enabled) {
      onAttempt?.({ provider: provider.name, status: "skipped", message: provider.missing });
      continue;
    }
    onAttempt?.({ provider: provider.name, status: "running" });
    try {
      const result = await provider.run(input);
      onAttempt?.({ provider: provider.name, status: result.tracks?.length ? "success" : "pending" });
      if (result.tracks?.length || result.status === "PENDING") {
        return result;
      }
    } catch (err) {
      const message = err.message || "فشل غير معروف";
      errors.push(`${provider.name}: ${message}`);
      onAttempt?.({ provider: provider.name, status: "failed", message });
    }
  }
  if (!errors.length) {
    throw new Error("ماكو أي مزوّد صوت مفعّل. أضف مفتاح واحد على الأقل في ملف .env ثم أعد تشغيل السيرفر.");
  }
  throw new Error(errors.join(" | "));
};

export default function SongAIApp() {
  // steps: input | searching | need_link | analyzing_link | analyzed | rewriting | result
  const [step, setStep]         = useState("input");
  const [songName, setSongName] = useState("");
  const [linkInput, setLinkInput] = useState("");
  const [newLyrics, setNewLyrics] = useState("");
  const [rewriteMode, setRewriteMode] = useState("lyrics");
  const [analysis, setAnalysis] = useState(null);
  const [result, setResult]     = useState(null);
  const [audioStatus, setAudioStatus] = useState("idle");
  const [audioTaskId, setAudioTaskId] = useState("");
  const [audioTracks, setAudioTracks] = useState([]);
  const [audioAttempts, setAudioAttempts] = useState([]);
  const [error, setError]       = useState("");
  const inputRef = useRef(null);

  const colors = analysis?.mood
    ? moodColors[analysis.mood] || moodColors.default
    : moodColors.default;

  const energyBars = analysis
    ? Array.from({ length: 10 }, (_, i) => i < Number(analysis.energy))
    : [];

  // ── Handlers ──
  const handleSearch = async () => {
    if (!songName.trim()) return;
    setStep("searching");
    setError("");
    try {
      const data = await searchSong(songName);
      if (data.found) {
        setAnalysis(data);
        setStep("analyzed");
      } else {
        setStep("need_link");
      }
    } catch {
      setError("حدث خطأ في البحث. حاول مجدداً.");
      setStep("input");
    }
  };

  const handleLinkAnalyze = async () => {
    if (!linkInput.trim()) return;
    setStep("analyzing_link");
    setError("");
    try {
      const data = await analyzeFromUrl(linkInput.trim(), songName);
      if (data.found) {
        setAnalysis(data);
        setStep("analyzed");
      } else {
        setError("ما قدرت أحلل الأغنية من اللينك. جرب لينك ثاني.");
        setStep("need_link");
      }
    } catch {
      setError("حدث خطأ في تحليل اللينك. حاول مجدداً.");
      setStep("need_link");
    }
  };

  const handleRewrite = async () => {
    if (!newLyrics.trim()) return;
    setStep("rewriting");
    setError("");
    try {
      const data = await rewriteLyrics(analysis, newLyrics, rewriteMode);
      setResult(data);
      setAudioStatus("idle");
      setAudioTaskId("");
      setAudioTracks([]);
      setAudioAttempts([]);
      setStep("result");
    } catch {
      setError("حدث خطأ في إعادة الكتابة. حاول مجدداً.");
      setStep("analyzed");
    }
  };

  const handleGenerateAudio = async () => {
    if (!result?.rewritten_lyrics || audioStatus === "generating") return;
    setError("");
    setAudioStatus("generating");
    setAudioTaskId("");
    setAudioTracks([]);
    setAudioAttempts([]);
    try {
      const audio = await generateSongAudio({
        lyrics: result.rewritten_lyrics,
        analysis,
        songName,
      }, attempt => {
        setAudioAttempts(previous => {
          const existing = previous.filter(item => item.provider !== attempt.provider);
          return [...existing, attempt];
        });
      });
      setAudioTaskId(audio.taskId);
      setAudioTracks(audio.tracks);
      setAudioStatus(audio.tracks.length ? "ready" : "pending");
    } catch (err) {
      setError(`ما قدرت أخلق الأغنية الصوتية: ${err.message || "تأكد من SUNO_API_KEY وحاول مجدداً."}`);
      setAudioStatus("idle");
    }
  };

  const reset = () => {
    setStep("input"); setSongName(""); setLinkInput("");
    setNewLyrics(""); setRewriteMode("lyrics"); setAnalysis(null); setResult(null);
    setAudioStatus("idle"); setAudioTaskId(""); setAudioTracks([]); setAudioAttempts([]); setError("");
  };

  // ── Shared style helpers ──
  const card = (extra = {}) => ({
    background: "#ffffff08",
    border: `1px solid ${colors.accent}35`,
    borderRadius: "20px",
    padding: "28px",
    ...extra,
  });

  const primaryBtn = (disabled = false, extra = {}) => ({
    flex: 1, padding: "15px",
    background: disabled
      ? `${colors.accent}40`
      : `linear-gradient(135deg, ${colors.accent}, ${colors.accent}cc)`,
    border: "none", borderRadius: "12px", color: "#fff",
    fontSize: "16px", fontWeight: "700",
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: "inherit",
    boxShadow: disabled ? "none" : `0 4px 18px ${colors.glow}`,
    ...extra,
  });

  const ghostBtn = () => ({
    padding: "15px 20px", background: "#ffffff12",
    border: "1px solid #ffffff25", borderRadius: "12px",
    color: "#ffffff70", fontSize: "14px",
    cursor: "pointer", fontFamily: "inherit",
  });

  const textInput = (extra = {}) => ({
    width: "100%", padding: "14px 18px", fontSize: "15px",
    background: "#ffffff0e", border: `1px solid ${colors.accent}40`,
    borderRadius: "12px", color: "#fff", outline: "none",
    boxSizing: "border-box", fontFamily: "inherit", direction: "rtl",
    ...extra,
  });

  const rewriteModeCopy = rewriteMode === "message"
    ? {
        label: "الكلام اللي تريد المغني يحجيه",
        placeholder: "اكتب الكلام أو الرسالة هنا...\nمثال: مشتاقلك بس ما أريد أرجع أضعف، خلي صوتي ثابت حتى لو كلبي موجوع",
        button: "حوّل كلامي لأغنية بأسلوب المغني",
      }
    : {
        label: "الكلمات الجديدة اللي تريد تعدل عليها",
        placeholder: "اكتب الكلمات الجديدة هنا...\nمثال: أنت رفيقي في كل الأيام، ما غبت عني ولا لحظة",
        button: "عدّل الكلمات بأسلوب المغني",
      };

  return (
    <div style={{
      minHeight: "100vh", background: colors.bg,
      fontFamily: "'Cairo','Tajawal',sans-serif",
      direction: "rtl", color: "#fff", margin: 0, padding: 0,
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@300;400;600;700;900&display=swap" rel="stylesheet" />
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>

      <div style={{ maxWidth: "660px", margin: "0 auto", padding: "40px 20px" }}>

        {/* ── Header ── */}
        <div style={{ textAlign: "center", marginBottom: "44px" }}>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: "10px",
            background: `${colors.accent}15`, border: `1px solid ${colors.accent}35`,
            borderRadius: "50px", padding: "7px 18px", marginBottom: "22px",
          }}>
            <div style={{ display: "flex", gap: "3px", alignItems: "center" }}>
              {[...Array(5)].map((_, i) => (
                <div key={i} style={{
                  width: "3px", height: `${8 + i * 4}px`,
                  background: colors.accent, borderRadius: "2px",
                }} />
              ))}
            </div>
            <span style={{ color: colors.accent, fontSize: "13px", fontWeight: "600" }}>
              مدعوم بالذكاء الاصطناعي
            </span>
          </div>
          <h1 style={{
            fontSize: "clamp(26px,6vw,40px)", fontWeight: "900",
            background: `linear-gradient(135deg,#fff 0%,${colors.accent} 100%)`,
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            margin: "0 0 10px", lineHeight: 1.2,
          }}>محلل ومعدّل الأغاني</h1>
          <p style={{ color: "#ffffff65", fontSize: "15px", margin: 0 }}>
            ادخل اسم الأغنية، نحلّل الأسلوب من المعرفة المتاحة، وعدّل الكلمات بأسلوب المغني
          </p>
        </div>

        {/* ── Error banner ── */}
        {error && (
          <div style={{
            background: "#ff4d4d18", border: "1px solid #ff4d4d45",
            borderRadius: "12px", padding: "14px 18px", marginBottom: "22px",
            color: "#ff9090", fontSize: "14px", textAlign: "center",
          }}>{error}</div>
        )}

        {/* ══ STEP: input / searching ══ */}
        {(step === "input" || step === "searching") && (
          <div style={card()}>
            <label style={{ display: "block", color: "#ffffff85", fontSize: "14px", marginBottom: "10px", fontWeight: "600" }}>
              🎵 اسم الأغنية والمغني
            </label>
            <input
              ref={inputRef}
              value={songName}
              onChange={e => setSongName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && step === "input" && handleSearch()}
              placeholder="مثال: أنا وليلى - ماجد المهندس"
              disabled={step === "searching"}
              style={textInput()}
            />
            <button
              onClick={handleSearch}
              disabled={!songName.trim() || step === "searching"}
              style={{ ...primaryBtn(!songName.trim() || step === "searching"), marginTop: "18px", width: "100%" }}
            >
              {step === "searching" ? (
                <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "10px" }}>
                  <Spinner /> جاري التحليل...
                </span>
              ) : "🔍 بحث وتحليل"}
            </button>
          </div>
        )}

        {/* ══ STEP: need_link / analyzing_link ══ */}
        {(step === "need_link" || step === "analyzing_link") && (
          <div>
            <div style={{
              background: "#ff8c0012", border: "1px solid #ff8c0038",
              borderRadius: "16px", padding: "20px 22px", marginBottom: "20px",
              display: "flex", gap: "14px", alignItems: "flex-start",
            }}>
              <span style={{ fontSize: "22px", flexShrink: 0 }}>🔎</span>
              <div>
                <div style={{ fontWeight: "700", fontSize: "15px", marginBottom: "5px" }}>
                  ما تعرّفنا على الأغنية من الاسم
                </div>
                <div style={{ color: "#ffffff65", fontSize: "13px", lineHeight: 1.7 }}>
                  "{songName}" ما انطابق واضح مع أغنية معروفة من الاسم فقط، أو المعلومات ناقصة.
                  جرّب لينك من يوتيوب أو سبوتيفاي أو أي موقع لتحسين التعرف.
                </div>
              </div>
            </div>

            <div style={card()}>
              <label style={{ display: "block", color: "#ffffff85", fontSize: "14px", marginBottom: "10px", fontWeight: "600" }}>
                🔗 لينك الأغنية
              </label>
              <input
                value={linkInput}
                onChange={e => setLinkInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && step === "need_link" && handleLinkAnalyze()}
                placeholder="https://www.youtube.com/watch?v=..."
                disabled={step === "analyzing_link"}
                style={textInput({ direction: "ltr", textAlign: "left" })}
              />
              <div style={{ display: "flex", gap: "10px", marginTop: "16px" }}>
                <button
                  onClick={handleLinkAnalyze}
                  disabled={!linkInput.trim() || step === "analyzing_link"}
                  style={primaryBtn(!linkInput.trim() || step === "analyzing_link")}
                >
                  {step === "analyzing_link" ? (
                    <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "10px" }}>
                      <Spinner /> جاري التحليل من اللينك...
                    </span>
                  ) : "📥 حلّل من اللينك"}
                </button>
                <button onClick={reset} style={ghostBtn()}>رجوع</button>
              </div>
            </div>
          </div>
        )}

        {/* ══ STEP: analyzed / rewriting ══ */}
        {(step === "analyzed" || step === "rewriting") && analysis && (
          <div>
            <div style={card({ marginBottom: "20px" })}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
                <h2 style={{ margin: 0, fontSize: "19px", fontWeight: "700" }}>🎤 {analysis.singer}</h2>
                <span style={{
                  background: `${colors.accent}20`, color: colors.accent,
                  padding: "5px 14px", borderRadius: "20px", fontSize: "13px", fontWeight: "600",
                }}>{analysis.mood}</span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "18px" }}>
                {[
                  { label: "النوع",        value: analysis.genre },
                  { label: "الإيقاع",      value: analysis.tempo },
                  { label: "أسلوب الصوت",  value: analysis.vocal_style },
                  { label: "اللغة",         value: analysis.language_style },
                ].map(item => (
                  <div key={item.label} style={{ background: "#ffffff08", borderRadius: "10px", padding: "11px 14px" }}>
                    <div style={{ color: "#ffffff40", fontSize: "11px", marginBottom: "3px" }}>{item.label}</div>
                    <div style={{ fontSize: "13px", fontWeight: "600" }}>{item.value}</div>
                  </div>
                ))}
              </div>

              <div style={{ marginBottom: "18px" }}>
                <div style={{ color: "#ffffff50", fontSize: "12px", marginBottom: "7px" }}>مستوى الطاقة</div>
                <div style={{ display: "flex", gap: "4px", alignItems: "flex-end" }}>
                  {energyBars.map((active, i) => (
                    <div key={i} style={{
                      flex: 1, height: `${10 + i * 3}px`,
                      background: active ? colors.accent : "#ffffff12",
                      borderRadius: "3px",
                    }} />
                  ))}
                </div>
              </div>

              {analysis.sample_lyrics && (
                <div style={{
                  background: `${colors.accent}0d`, border: `1px solid ${colors.accent}20`,
                  borderRadius: "12px", padding: "14px",
                }}>
                  <div style={{ color: "#ffffff40", fontSize: "11px", marginBottom: "6px" }}>🎶 مقتطف من الأغنية</div>
                  <div style={{ color: "#ffffff80", fontSize: "13px", lineHeight: 1.9, fontStyle: "italic", whiteSpace: "pre-wrap" }}>
                    {analysis.sample_lyrics}
                  </div>
                </div>
              )}

              {analysis.themes && (
                <div style={{ marginTop: "14px", color: "#ffffff55", fontSize: "13px", lineHeight: 1.7 }}>
                  <strong style={{ color: "#ffffff75" }}>المواضيع: </strong>{analysis.themes}
                </div>
              )}
            </div>

            <div style={card()}>
              <div style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "8px",
                background: "#00000022",
                border: "1px solid #ffffff16",
                borderRadius: "12px",
                padding: "6px",
                marginBottom: "16px",
              }}>
                {[
                  { value: "lyrics", label: "تعديل كلمات" },
                  { value: "message", label: "كلام للمغني" },
                ].map(option => {
                  const active = rewriteMode === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setRewriteMode(option.value)}
                      disabled={step === "rewriting"}
                      style={{
                        padding: "11px 10px",
                        border: "none",
                        borderRadius: "9px",
                        background: active ? colors.accent : "transparent",
                        color: active ? "#fff" : "#ffffff70",
                        fontSize: "14px",
                        fontWeight: "700",
                        cursor: step === "rewriting" ? "not-allowed" : "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
              <label style={{ display: "block", color: "#ffffff85", fontSize: "14px", marginBottom: "10px", fontWeight: "600" }}>
                {rewriteModeCopy.label}
              </label>
              <textarea
                value={newLyrics}
                onChange={e => setNewLyrics(e.target.value)}
                placeholder={rewriteModeCopy.placeholder}
                rows={5}
                disabled={step === "rewriting"}
                style={{ ...textInput(), resize: "vertical", lineHeight: 1.9 }}
              />
              <div style={{ display: "flex", gap: "10px", marginTop: "16px" }}>
                <button
                  onClick={handleRewrite}
                  disabled={!newLyrics.trim() || step === "rewriting"}
                  style={primaryBtn(!newLyrics.trim() || step === "rewriting")}
                >
                  {step === "rewriting" ? (
                    <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "10px" }}>
                      <Spinner /> جاري التعديل...
                    </span>
                  ) : rewriteModeCopy.button}
                </button>
                <button onClick={reset} style={ghostBtn()}>أغنية جديدة</button>
              </div>
            </div>
          </div>
        )}

        {/* ══ STEP: result ══ */}
        {step === "result" && result && (
          <div>
            <div style={{
              background: `${colors.accent}0e`, border: `1px solid ${colors.accent}45`,
              borderRadius: "20px", padding: "26px", marginBottom: "18px",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "18px" }}>
                <div style={{
                  width: "36px", height: "36px", background: colors.accent,
                  borderRadius: "50%", display: "flex", alignItems: "center",
                  justifyContent: "center", fontSize: "16px", flexShrink: 0,
                }}>✓</div>
                <h2 style={{ margin: 0, fontSize: "18px" }}>الكلمات الجاهزة للتلحين</h2>
              </div>

              <div style={{
                background: "#00000028", borderRadius: "12px", padding: "18px",
                fontSize: "15px", lineHeight: 2.2, color: "#fff",
                borderRight: `3px solid ${colors.accent}`, marginBottom: "18px",
                whiteSpace: "pre-wrap",
              }}>
                {result.rewritten_lyrics}
              </div>

              <div style={{ background: "#ffffff08", borderRadius: "12px", padding: "14px", marginBottom: "12px" }}>
                <div style={{ color: colors.accent, fontSize: "12px", fontWeight: "700", marginBottom: "6px" }}>💡 كيف طُبّق الأسلوب</div>
                <div style={{ color: "#ffffff70", fontSize: "13px", lineHeight: 1.8 }}>{result.explanation}</div>
              </div>

              <div style={{ background: "#ffffff08", borderRadius: "12px", padding: "14px" }}>
                <div style={{ color: colors.accent, fontSize: "12px", fontWeight: "700", marginBottom: "6px" }}>🎙️ نصائح للأداء</div>
                <div style={{ color: "#ffffff70", fontSize: "13px", lineHeight: 1.8 }}>{result.tips}</div>
              </div>

              <div style={{ marginTop: "16px", background: "#00000022", borderRadius: "12px", padding: "14px", border: "1px solid #ffffff16" }}>
                <button
                  onClick={handleGenerateAudio}
                  disabled={audioStatus === "generating"}
                  style={{ ...primaryBtn(audioStatus === "generating"), width: "100%", marginBottom: audioStatus === "idle" ? 0 : "14px" }}
                >
                  {audioStatus === "generating" ? (
                    <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "10px" }}>
                      <Spinner /> جاري خلق الأغنية الصوتية...
                    </span>
                  ) : "اصنع أغنية صوتية تلقائياً"}
                </button>

                {audioAttempts.length > 0 && (
                  <div style={{ display: "grid", gap: "8px", marginBottom: "14px" }}>
                    {audioAttempts.map(attempt => {
                      const statusColor = attempt.status === "success"
                        ? "#50c878"
                        : attempt.status === "failed"
                          ? "#ff9090"
                          : colors.accent;
                      return (
                        <div key={attempt.provider} style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: "10px",
                          background: "#ffffff08",
                          borderRadius: "9px",
                          padding: "9px 11px",
                          color: "#ffffff75",
                          fontSize: "12px",
                        }}>
                          <span>{attempt.provider}</span>
                          <span style={{ color: statusColor, textAlign: "left" }}>
                            {attempt.status === "running" && "جاري التجربة"}
                            {attempt.status === "success" && "نجح"}
                            {attempt.status === "pending" && "قيد المعالجة"}
                            {attempt.status === "skipped" && `غير مفعّل: ${attempt.message}`}
                            {attempt.status === "failed" && `فشل: ${attempt.message}`}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {audioStatus === "pending" && (
                  <div style={{ color: "#ffffff70", fontSize: "13px", lineHeight: 1.8 }}>
                    انطلبت الأغنية، بس بعدها قيد المعالجة. Task ID: {audioTaskId}
                  </div>
                )}

                {audioTracks.length > 0 && (
                  <div style={{ display: "grid", gap: "12px" }}>
                    {audioTracks.map((track, index) => {
                      const audioUrl = track.audioUrl || track.streamAudioUrl;
                      return (
                        <div key={track.id || `${audioTaskId}-${index}`} style={{ background: "#ffffff08", borderRadius: "10px", padding: "12px" }}>
                          <div style={{ color: "#ffffff85", fontSize: "13px", fontWeight: "700", marginBottom: "8px" }}>
                            نسخة {index + 1}: {track.title || songName || "أغنية جديدة"}
                            {track.provider && (
                              <span style={{ color: colors.accent, fontSize: "11px", marginRight: "8px" }}>
                                {track.provider}
                              </span>
                            )}
                          </div>
                          {audioUrl ? (
                            <audio controls src={audioUrl} style={{ width: "100%" }} />
                          ) : (
                            <div style={{ color: "#ffffff55", fontSize: "13px" }}>الصوت بعده ما صار جاهز.</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: "flex", gap: "10px" }}>
              <button
                onClick={() => { setStep("analyzed"); setResult(null); setNewLyrics(""); }}
                style={primaryBtn()}
              >🔄 عدّل كلمات أخرى</button>
              <button onClick={reset} style={ghostBtn()}>أغنية جديدة</button>
            </div>
          </div>
        )}

        <div style={{ textAlign: "center", marginTop: "44px", color: "#ffffff22", fontSize: "11px" }}>
          مدعوم بـ Groq (Llama) • شغّل المشروع بـ npm run dev حتى يعمل البروكسي
        </div>
      </div>
    </div>
  );
}
