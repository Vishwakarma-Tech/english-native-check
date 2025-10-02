// index.js — robust, normalized, with mock and JSON rescue
// How to run:
// 1) Put .env in THIS folder with OPENROUTER_* and PORT (see README above).
// 2) npm start

import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import OpenAI from 'openai';
import { z } from 'zod';

// ---------- App ----------
const app = express();
const corsOrigins =
  process.env.CORS_ALLOW_ORIGIN?.split(',').map(s => s.trim()).filter(Boolean) || '*';
app.use(cors({ origin: corsOrigins }));
app.use(express.json());
app.use('/assess', rateLimit({ windowMs: 60_000, max: 20 }));

// ---------- Validation ----------
const AnswersSchema = z.object({
  answers: z.array(z.string().min(1, 'answer cannot be empty')).length(4, 'need exactly 4 answers')
});

// ---------- OpenRouter client ----------
const BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
const MODEL = process.env.OPENROUTER_MODEL || 'mistralai/mistral-7b-instruct:free';
const client = new OpenAI({ apiKey: process.env.OPENROUTER_API_KEY, baseURL: BASE_URL });

// ---------- Prompts ----------
const SYSTEM_PROMPT = 'You are a calibrated linguistics examiner.';
const STRICT_JSON_INSTR = `
Return ONLY a JSON object with this exact schema and nothing else:

{
  "score": number,            // integer 0-10
  "level": "Beginner"|"Intermediate"|"Advanced"|"Near-native"|"Native-like",
  "reasons": string,          // 1-2 sentences
  "suggestions": string[]     // 3 concise tips
}

Scoring:
0-2 basic; 3-4 limited; 5-6 functional; 7-8 strong; 9 near-native; 10 native-like.
Penalize canned/memorized text. Consider grammar, vocabulary range, collocations, coherence, register, naturalness.
`;

// ---------- Health ----------
app.get('/', (_req, res) => res.send('OK'));

// ---------- Helpers ----------
function extractJson(raw) {
  if (!raw || typeof raw !== 'string') throw new Error('Empty response');
  let s = raw.trim();
  // fenced code block
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) s = fence[1].trim();
  // first {...}
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) s = s.slice(first, last + 1);
  return JSON.parse(s);
}

function normalizeResult(out) {
  const obj = Array.isArray(out) ? out[0] : out;        // pick first if multiple
  const scoreNum = Math.round(Number(obj?.score ?? 0)); // integerize
  return {
    score: Math.max(0, Math.min(10, scoreNum)),         // clamp 0..10
    level: obj?.level || 'Intermediate',
    reasons: obj?.reasons || 'Results normalized.',
    suggestions: Array.isArray(obj?.suggestions) && obj.suggestions.length
      ? obj.suggestions
      : ['Keep practicing.']
  };
}

// ---------- Route ----------
app.post('/assess', async (req, res) => {
  try {
    console.log('POST /assess', new Date().toISOString(), 'mock=', req.query.mock);

    // Validate input
    const parsed = AnswersSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Bad input', detail: parsed.error.issues });
    }

    // MOCK MODE — no provider call
    if (req.query.mock === '1') {
      return res.json({
        score: 7,
        level: 'Advanced',
        reasons: 'Mostly natural phrasing with minor non-native choices.',
        suggestions: [
          'Vary sentence openings to avoid repetition.',
          'Use idiomatic connectors (e.g., “that said”).',
          'Tighten article usage in complex sentences.'
        ]
      });
    }

    const userText = parsed.data.answers.map((a, i) => `Q${i + 1}:\n${a}`).join('\n\n');

    // Primary attempt (no response_format for compatibility)
    console.time('llm-call-1');
    const r1 = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: STRICT_JSON_INSTR + `\n\nEvaluate these four answers:\n\n${userText}` }
      ],
      temperature: 0.0,
      top_p: 0.1,
      max_tokens: 700
    });
    console.timeEnd('llm-call-1');

    let raw = r1.choices?.[0]?.message?.content ?? '';
    let out;
    try {
      out = extractJson(raw);
    } catch (e1) {
      console.warn('Parse failed once, retrying. Reason:', e1?.message);

      // Retry with even stricter instruction
      console.time('llm-call-2');
      const r2 = await client.chat.completions.create({
        model: MODEL,
        messages: [
          { role: 'system', content: 'Output STRICT JSON only. No preamble, no extra words.' },
          { role: 'user', content: `Schema: {"score":number,"level":"Beginner"|"Intermediate"|"Advanced"|"Near-native"|"Native-like","reasons":string,"suggestions":string[]}\n\nEvaluate:\n${userText}` }
        ],
        temperature: 0.0,
        top_p: 0.1,
        max_tokens: 700
      });
      console.timeEnd('llm-call-2');

      const raw2 = r2.choices?.[0]?.message?.content ?? '';
      out = extractJson(raw2);
    }

    // Normalize and validate final shape
    const normalized = normalizeResult(out);
    const ResultSchema = z.object({
      score: z.number().int().min(0).max(10),
      level: z.enum(['Beginner', 'Intermediate', 'Advanced', 'Near-native', 'Native-like']),
      reasons: z.string(),
      suggestions: z.array(z.string()).min(1)
    });
    const checked = ResultSchema.parse(normalized);

    return res.json(checked);

  } catch (e) {
    try {
      const status = e?.status || e?.response?.status || 500;
      let detail = e?.message || 'Unknown error';
      if (e?.response?.text) {
        const txt = await e.response.text();
        if (txt) detail = txt;
      }
      console.error('LLM error:', status, detail);
      return res.status(500).json({ error: 'Assessment failed', status, detail });
    } catch (nested) {
      console.error('Nested error:', nested);
      return res.status(500).json({ error: 'Assessment failed (no detail)' });
    }
  }
});

// ---------- Start ----------
const port = process.env.PORT || 8787;
app.listen(port, () => {
  console.log(`API running at http://localhost:${port}`);
  console.log(`Model: ${MODEL}`);
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`CORS allow: ${Array.isArray(corsOrigins) ? corsOrigins.join(', ') : corsOrigins}`);
});
