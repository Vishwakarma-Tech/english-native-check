// server/index.js
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import OpenAI from "openai";
import { z } from "zod";

const app = express();

// ----- ENV -----
const BASE_URL = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
const MODEL = process.env.OPENROUTER_MODEL || "meta-llama/llama-4-maverick:free";
const PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || "https://english-native-check.vercel.app";
const DEBUG_SECRET = process.env.DEBUG_SECRET || "";

// ----- CORE MIDDLEWARE -----
app.set("trust proxy", true);

const corsOrigins = (process.env.CORS_ALLOW_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: corsOrigins.length ? corsOrigins : "*",
    exposedHeaders: ["x-model"], // let browser JS read this header
  })
);

app.use(express.json({ limit: "1mb" }));

// Stamp model on every response (handy for the UI)
app.use((_, res, next) => {
  res.setHeader("x-model", MODEL);
  res.setHeader("Access-Control-Expose-Headers", "x-model");
  next();
});

// Limit only the heavy route
const limiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip || "unknown",
});
app.use("/assess", limiter);

// ----- OPENROUTER CLIENT -----
const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: BASE_URL,
  defaultHeaders: {
    "HTTP-Referer": PUBLIC_APP_URL,
    "X-Title": "English Native Check",
  },
});

// ----- PROMPTS (explicit Part 4 sentence with two blanks) -----
const SYSTEM_PROMPT = "You are a calibrated linguistics examiner. Output STRICT JSON only.";
const STRICT_JSON_INSTR = `
You are evaluating a four-part English proficiency task. Return ONLY one JSON object with this schema:

{
  "score": number,
  "level": "Beginner"|"Intermediate"|"Advanced"|"Near-native"|"Native-like",
  "reasons": string,
  "suggestions": string[]
}

Task prompts (what the candidate saw):
- Part 1 — "Write a short paragraph." (Assess coherence, grammar, vocabulary, collocations, flow; penalize robotic text.)
- Part 2 — "Explain the idiom 'blessing in disguise'." (Meaning: something initially negative/hidden that leads to a positive outcome.)
- Part 3 — "Use these fragments in a sentence: 'in the evening; suggested going; looking forward to meeting'." (Assess natural integration and grammar.)
- Part 4 — "Fill in two blanks and reproduce the complete sentence: If I ___ known, I would have ___." 
  Target form: third conditional — correct completion should be:
  Blanks → "had" and a past participle (e.g., "had known") / "would have" + past participle (e.g., "would have told").
  Require the candidate to also write the full corrected sentence.

Weights (round overall to nearest integer):
- Part 1 Writing 40%
- Part 2 Idiom 20%
- Part 3 Naturalness/Word Choice 20%
- Part 4 Grammar (3rd conditional) 20%

Guidelines:
- Return ONE JSON object only, no markdown/preamble.
- "reasons": brief notes across parts.
- "suggestions": 3–5 actionable tips targeted to the weakest areas.
`;

// ----- HEALTH + META -----
app.get("/", (_req, res) => res.send("OK"));
app.head("/", (_req, res) => res.status(204).end());
app.get("/meta", (_req, res) => res.json({ model: MODEL, baseURL: BASE_URL }));

// ----- HELPERS -----
const AnswersSchema = z.object({
  answers: z.array(z.string().min(1, "answer cannot be empty")).length(4, "need exactly 4 answers"),
});

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

// ----- MAIN ROUTE -----
app.post("/assess", async (req, res) => {
  const debug = req.query.debug === "1" && req.query.secret === DEBUG_SECRET;

  try {
    const parsed = AnswersSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "Bad input", detail: parsed.error.issues, _meta: { model: MODEL } });
    }

    // Mock
    if (req.query.mock === "1") {
      return res.json({
        score: 7,
        level: "Advanced",
        reasons: "Clear paragraph; idiom explained; fragments integrated acceptably; minor issues with conditional form.",
        suggestions: [
          "Vary sentence openings and clause structures.",
          "Tighten punctuation and article usage.",
          "Reinforce third conditional form ('had + past participle' / 'would have + past participle').",
        ],
        _meta: { model: MODEL },
      });
    }

    const [a1, a2, a3, a4] = parsed.data.answers;
    const userText = [
      `Part 1 — Candidate answer:\n${a1}`,
      `Part 2 — Candidate answer:\n${a2}`,
      `Part 3 — Candidate answer:\n${a3}`,
      `Part 4 — Candidate answer (prompt was: "If I ___ known, I would have ___."): \n${a4}`,
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
      // Attempt 2
      let raw2 = await askOnce({
        system: "Output STRICT JSON only. No preamble.",
        user: `Schema: {"score":number,"level":"Beginner"|"Intermediate"|"Advanced"|"Near-native"|"Native-like","reasons":string,"suggestions":string[]}\n\nEvaluate:\n${userText}`,
      });

      if (debug) {
        return res.status(500).json({
          error: "Parse failed twice",
          raw1: String(raw1).slice(0, 600),
          raw2: String(raw2).slice(0, 600),
          _meta: { model: MODEL },
        });
      }

      out = extractJson(raw2);
    }

    const normalized = normalizeResult(out);
    return res.json({ ...normalized, _meta: { model: MODEL } });
  } catch (e) {
    const status = e?.status || e?.response?.status || 500;
    const detail = e?.message || "Unknown error";
    return res.status(status).json({ error: "Assessment failed", detail, _meta: { model: MODEL } });
  }
});

// ----- START -----
const port = process.env.PORT || 8787;
app.listen(port, () => {
  console.log(`API running on port ${port}`);
  console.log(`Model: ${MODEL}`);
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Public app URL: ${PUBLIC_APP_URL}`);
  console.log(`CORS allow: ${corsOrigins.length ? corsOrigins.join(", ") : "*"}`);
});
