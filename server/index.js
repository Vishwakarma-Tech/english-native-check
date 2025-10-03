// server/index.js
//
// Node.js Express API for English-Native-Check
// Features:
// - Health check endpoint (for wake-up pings)
// - /assess with mock + debug mode
// - Trust proxy (Render requirement)
// - CORS setup
// - Rate limiting
// - LLM call (OpenRouter via openai client)
// - Strict JSON parsing / normalization

import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import OpenAI from "openai";
import { z } from "zod";

const app = express();

// Trust Render proxy so req.ip works with rate limiting
app.set("trust proxy", true);

// CORS allowlist from env
const corsOrigins = (process.env.CORS_ALLOW_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
app.use(cors({ origin: corsOrigins.length ? corsOrigins : "*" }));

// JSON parsing
app.use(express.json({ limit: "1mb" }));

// Rate limit only the heavy route
const limiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip || "unknown",
});
app.use("/assess", limiter);

// Schema for input
const AnswersSchema = z.object({
  answers: z
    .array(z.string().min(1, "answer cannot be empty"))
    .length(4, "need exactly 4 answers"),
});

// Env
const BASE_URL = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
const MODEL = process.env.OPENROUTER_MODEL || "meta-llama/llama-4-maverick:free";
const PUBLIC_APP_URL =
  process.env.PUBLIC_APP_URL || "https://english-native-check.vercel.app";
const DEBUG_SECRET = process.env.DEBUG_SECRET || "";

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: BASE_URL,
  defaultHeaders: {
    "HTTP-Referer": PUBLIC_APP_URL,
    "X-Title": "English Native Check",
  },
});

// Prompts
const SYSTEM_PROMPT = "You are a calibrated linguistics examiner. Output STRICT JSON only.";
const STRICT_JSON_INSTR = `
You are evaluating a four-part English proficiency test. Return ONLY one JSON object with this schema:

{
  "score": number,
  "level": "Beginner"|"Intermediate"|"Advanced"|"Near-native"|"Native-like",
  "reasons": string,
  "suggestions": string[]
}

Guidelines:
- Return ONE JSON object only, no markdown/preamble.
- "reasons": brief notes across parts.
- "suggestions": 3–5 actionable tips.
`;

// --- Health check (used by frontend to wake server) ---
app.get("/", (_req, res) => res.send("OK"));
app.head("/", (_req, res) => res.status(204).end());

// Helpers
function extractJson(raw) {
  if (!raw || typeof raw !== "string") throw new Error("Empty response");
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) s = fence[1].trim();
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) s = s.slice(first, last + 1);
  return JSON.parse(s);
}

function normalizeResult(out) {
  const obj = Array.isArray(out) ? out[0] : out;
  const scoreNum = Math.round(Number(obj?.score ?? 0));
  return {
    score: Math.max(0, Math.min(10, scoreNum)),
    level: obj?.level || "Intermediate",
    reasons: obj?.reasons || "Results normalized.",
    suggestions:
      Array.isArray(obj?.suggestions) && obj.suggestions.length
        ? obj.suggestions
        : [
            "Practice collocations and article usage.",
            "Review conditionals (3rd).",
            "Reinforce gerund/infinitive patterns.",
          ],
  };
}

async function askOnce({ system, user, max_tokens = 600 }) {
  const r = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.0,
    top_p: 1.0,
    max_tokens,
  });
  return r.choices?.[0]?.message?.content ?? "";
}

// --- Main assess route ---
app.post("/assess", async (req, res) => {
  const debug = req.query.debug === "1" && req.query.secret === DEBUG_SECRET;

  try {
    const parsed = AnswersSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Bad input", detail: parsed.error.issues });
    }

    // Mock mode
    if (req.query.mock === "1") {
      return res.json({
        score: 7,
        level: "Advanced",
        reasons: "Strong writing, correct idiom meaning, minor word choice issues.",
        suggestions: [
          "Vary sentence openings.",
          "Practice gerund vs infinitive.",
          "Reinforce 3rd conditional.",
        ],
      });
    }

    const [a1, a2, a3, a4] = parsed.data.answers;
    const userText = [
      `Part 1 — Candidate answer:\n${a1}`,
      `Part 2 — Candidate answer:\n${a2}`,
      `Part 3 — Candidate answer:\n${a3}`,
      `Part 4 — Candidate answer:\n${a4}`,
    ].join("\n\n");

    // Attempt 1
    let raw1 = await askOnce({
      system: SYSTEM_PROMPT,
      user: STRICT_JSON_INSTR + `\n\nEvaluate the answers:\n${userText}`,
    });

    let out;
    try {
      out = extractJson(raw1);
    } catch {
      // Attempt 2 fallback
      let raw2 = await askOnce({
        system: "Output STRICT JSON only. No preamble.",
        user: `Schema: {"score":number,"level":"Beginner"|"Intermediate"|"Advanced"|"Near-native"|"Native-like","reasons":string,"suggestions":string[]}\n\nEvaluate:\n${userText}`,
      });

      if (debug) {
        return res.status(500).json({
          error: "Parse failed twice",
          raw1: String(raw1).slice(0, 600),
          raw2: String(raw2).slice(0, 600),
        });
      }

      out = extractJson(raw2);
    }

    const normalized = normalizeResult(out);
    return res.json(normalized);
  } catch (e) {
    const status = e?.status || e?.response?.status || 500;
    const detail = e?.message || "Unknown error";
    return res.status(status).json({ error: "Assessment failed", detail });
  }
});

// --- Start server ---
const port = process.env.PORT || 8787;
app.listen(port, () => {
  console.log(`API running on port ${port}`);
  console.log(`Model: ${MODEL}`);
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Public app URL: ${PUBLIC_APP_URL}`);
  console.log(
    `CORS allow: ${corsOrigins.length ? corsOrigins.join(", ") : "*"}`
  );
});
