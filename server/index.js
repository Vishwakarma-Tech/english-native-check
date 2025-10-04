import dotenv from "dotenv";
dotenv.config();
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import OpenAI from "openai";
import { z } from "zod";

const app = express();
app.set("trust proxy", true);

/* ---- ENV ---- */
const BASE_URL = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = process.env.OPENROUTER_MODEL || "meta-llama/llama-3.1-8b-instruct:free";
const PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || "https://english-native-check.vercel.app";
const DEBUG_SECRET = process.env.DEBUG_SECRET || "";
// Comma-separated list of fallbacks (in order)
const FALLBACK_MODELS = (process.env.FALLBACK_MODELS || "qwen/qwen3-8b-instruct:free").split(",").map(s => s.trim()).filter(Boolean);

/* ---- CORS ---- */
const corsOrigins = (process.env.CORS_ALLOW_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: corsOrigins.length ? corsOrigins : "*",
    exposedHeaders: ["x-model"],
  })
);
app.use(express.json({ limit: "1mb" }));
app.use((req, res, next) => {
  // reveal which model we’ll try first (actual used model is in body _meta)
  res.setHeader("x-model", DEFAULT_MODEL);
  res.setHeader("Access-Control-Expose-Headers", "x-model");
  next();
});
app.use("/assess", rateLimit({ windowMs: 60_000, max: 20 }));

/* ---- OpenRouter Client ---- */
const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: BASE_URL,
  defaultHeaders: {
    "HTTP-Referer": PUBLIC_APP_URL,
    "X-Title": "English Native Check",
  },
});

/* ---- PROMPTS (tight JSON discipline) ---- */
const SYSTEM_PROMPT = [
  "You are a calibrated linguistics examiner.",
  "Return EXACTLY ONE JSON object. No markdown fences. No commentary before or after.",
  "Tailor feedback to the user’s actual answers; avoid boilerplate.",
].join(" ");

const STRICT_JSON_INSTR = `
You are evaluating a four-part English proficiency task. Return ONLY one JSON object (no fences):

{
 "score": number,                 // integer 0–10 overall, using the weights below
 "level": "Beginner"|"Intermediate"|"Advanced"|"Near-native"|"Native-like",
 "reasons": string,               // 2–4 sentences. Be SPECIFIC to the user's errors/strengths.
 "suggestions": string[]          // 3–6 concise, targeted actions tied to the user's responses
}

Tasks that the user answered (the answers follow AFTER this spec):
1) Part 1 — "Write a short paragraph."
2) Part 2 — "Explain the idiom 'blessing in disguise'."
3) Part 3 — "Use these fragments in a sentence: 'in the evening; suggested going; looking forward to meeting'."
4) Part 4 — "Fill in two blanks and reproduce the complete sentence: If I ___ known, I would have ___." (Expect: "had known" and a correct perfect conditional.)

Weights: Part1 40%, Part2 20%, Part3 20%, Part4 20%.

Scoring rubric (anchor):
0–2: heavy grammar/usage errors; unclear meaning
3–4: frequent errors; limited cohesion or idiomatic control
5–6: mostly correct; some issues with cohesion/idioms/style
7–8: strong control; minor style or idiom slips
9: near-native; rare slips
10: native-like

Important output rules:
- Output ONLY the JSON object, no extra text.
- reasons: MUST reference concrete issues present (e.g., tense error in Part 4, vague idiom explanation in Part 2, unnatural collocation in Part 3). Avoid generic phrases like "practice more".
- suggestions: MUST be specific and actionable (e.g., "Practice third conditional: 'If I had known, I would have ...'"). Avoid duplicates and vague advice.
- Keep wording tight and non-repetitive.
`;

/* ---- Validation ---- */
const AnswersSchema = z.object({
  answers: z.array(z.string().min(1)).length(4),
});

/* ---- Helpers ---- */
function extractJson(raw) {
  if (!raw || typeof raw !== "string") throw new Error("Empty response");
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) s = fence[1].trim();
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) s = s.slice(first, last + 1);
  return JSON.parse(s);
}

function deriveLevel(score) {
  const s = Math.round(Number(score) || 0);
  if (s >= 10) return "Native-like";
  if (s >= 9)  return "Near-native";
  if (s >= 7)  return "Advanced";
  if (s >= 5)  return "Intermediate";
  return "Beginner";
}

function normalizeResult(out) {
  const obj = Array.isArray(out) ? out[0] : out;
  const scoreNum = Math.max(0, Math.min(10, Math.round(Number(obj?.score ?? 0))));
  const suggestions = Array.isArray(obj?.suggestions) ? obj.suggestions : [];
  const cleaned = suggestions
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter((s) => s.length > 0);

  // De-dup and filter generic lines
  const deDuped = [];
  const seen = new Set();
  for (const s of cleaned) {
    const key = s.toLowerCase().replace(/\W+/g, " ").trim();
    if (key.length < 6) continue;
    if (/(practice more|improve vocabulary|work on grammar|be concise)/i.test(s)) continue;
    if (!seen.has(key)) { seen.add(key); deDuped.push(s); }
    if (deDuped.length >= 6) break;
  }

  return {
    score: scoreNum,
    level: deriveLevel(scoreNum),
    reasons: (obj?.reasons && String(obj.reasons).trim()) || "Results normalized.",
    suggestions: deDuped.length ? deDuped : [
      "Vary sentence openings and use cohesive devices (e.g., moreover, however).",
      "Explain idioms with meaning + one precise example.",
      "Combine provided fragments with natural connectors; avoid run-ons.",
      "Use third conditional correctly: 'If I had known, I would have ...'."
    ],
  };
}

async function callOnce({ model, system, user, useJsonFormat = true, maxTokens = 700 }) {
  // First try (optionally with response_format)
  try {
    const r = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
      temperature: 0,
      max_tokens: maxTokens,
      ...(useJsonFormat ? { response_format: { type: "json_object" } } : {})
    });
    return r.choices?.[0]?.message?.content ?? "";
  } catch (e) {
    // Bubble up error so the caller can decide retry/fallback behavior
    throw e;
  }
}

async function robustAsk({ preferredModel, userText }) {
  const modelsToTry = [preferredModel, ...FALLBACK_MODELS];
  const system = SYSTEM_PROMPT;
  const user = STRICT_JSON_INSTR + "\n\nUser responses:\n" + userText;

  let lastError;
  for (const m of modelsToTry) {
    // 1) Try with json_object
    try {
      const raw = await callOnce({ model: m, system, user, useJsonFormat: true, maxTokens: 700 });
      return { raw, usedModel: m };
    } catch (e1) {
      lastError = e1;
      // 2) Retry same model WITHOUT response_format and with smaller max_tokens
      try {
        const raw = await callOnce({ model: m, system, user, useJsonFormat: false, maxTokens: 550 });
        return { raw, usedModel: m };
      } catch (e2) {
        lastError = e2;
        // continue to next model
      }
    }
  }
  throw lastError || new Error("All model attempts failed");
}

/* ---- Routes ---- */
app.get("/", (_req, res) => res.send("OK"));
app.get("/meta", (req, res) => {
  // Optional model override for quick A/B (only with DEBUG_SECRET)
  const overrideAllowed = req.query.secret === DEBUG_SECRET && typeof req.query.model === "string";
  const model = overrideAllowed ? req.query.model : DEFAULT_MODEL;
  res.json({ model, baseURL: BASE_URL, fallback: FALLBACK_MODELS });
});

app.post("/assess", async (req, res) => {
  const debug = req.query.debug === "1" && req.query.secret === DEBUG_SECRET;
  // Optional MODEL override (debug only)
  const modelOverride = req.query.model && req.query.secret === DEBUG_SECRET ? String(req.query.model) : null;

  try {
    const parsed = AnswersSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Bad input" });

    if (req.query.mock === "1") {
      return res.json({
        score: 8,
        level: "Advanced",
        reasons: "Strong grammar; idiom accurate; fragments natural; minor stylistic issues.",
        suggestions: ["Vary transitions.", "Tighten phrasing.", "Use richer connectors."],
        _meta: { model: modelOverride || DEFAULT_MODEL }
      });
    }

    const [a1, a2, a3, a4] = parsed.data.answers;
    const userText =
      `Part 1:\n${a1}\n\n` +
      `Part 2:\n${a2}\n\n` +
      `Part 3:\n${a3}\n\n` +
      `Part 4:\n${a4}`;

    const { raw, usedModel } = await robustAsk({ preferredModel: modelOverride || DEFAULT_MODEL, userText });
    let out;
    try {
      out = extractJson(raw);
    } catch {
      // one minimal retry prompt for fence/noise
      const retryInstr = "Return JSON ONLY (no markdown): {\"score\":0-10,\"level\":\"...\",\"reasons\":\"...\",\"suggestions\":[\"...\"]}";
      const { raw: raw2, usedModel: used2 } = await robustAsk({ preferredModel: modelOverride || DEFAULT_MODEL, userText: retryInstr + "\n\n" + userText });
      if (debug) return res.status(500).json({ raw1: raw, raw2, usedModel: used2 });
      out = extractJson(raw2);
    }

    const norm = normalizeResult(out);
    res.json({ ...norm, _meta: { model: usedModel } });
  } catch (e) {
    // Map provider 400-ish to 503 for frontend clarity
    const msg = (e && e.message) ? String(e.message) : "Upstream provider error";
    return res.status(500).json({ error: msg, _meta: { model: DEFAULT_MODEL } });
  }
});

/* ---- Start ---- */
const port = process.env.PORT || 8787;
app.listen(port, () => console.log(`API running on ${port} (default model: ${DEFAULT_MODEL})`));
