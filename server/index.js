// index.js — robust API with Render proxy support, 4-part rubric, OpenRouter headers,
// compatible params, strict JSON parsing/normalization, mock mode, and helpful logs.
//
// Required env (Render):
// OPENROUTER_API_KEY=sk-or-...
// OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
// OPENROUTER_MODEL=z-ai/glm-4.5-air:free
// PUBLIC_APP_URL=https://<your-vercel-app>.vercel.app
// CORS_ALLOW_ORIGIN=https://<your-vercel-app>.vercel.app,http://127.0.0.1:5174
// PORT=8787

import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import OpenAI from 'openai';
import { z } from 'zod';

const app = express();

// --- IMPORTANT: behind Render proxy, trust it so req.ip works and rate limiter is happy
app.set('trust proxy', true); // or 1

// --- CORS
const rawCors = process.env.CORS_ALLOW_ORIGIN || '';
const corsOrigins = rawCors
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
app.use(cors({ origin: corsOrigins.length ? corsOrigins : '*' }));

app.use(express.json({ limit: '1mb' }));

// --- Rate limit (safe headers + key; avoids the X-Forwarded-For warning)
const limiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req /*, res*/) => req.ip || 'unknown'
});
app.use('/assess', limiter);

// --- Validation
const AnswersSchema = z.object({
  answers: z.array(z.string().min(1, 'answer cannot be empty')).length(4, 'need exactly 4 answers')
});

// --- OpenRouter client
const BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
const MODEL = process.env.OPENROUTER_MODEL || 'z-ai/glm-4.5-air:free';
const PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || 'https://english-native-check.vercel.app';

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: BASE_URL,
  defaultHeaders: {
    // Recommended by OpenRouter to improve routing/allowance on free tiers
    'HTTP-Referer': PUBLIC_APP_URL,
    'X-Title': 'English Native Check'
  }
});

// --- Prompts (4-part rubric)
const SYSTEM_PROMPT = 'You are a calibrated linguistics examiner. Output STRICT JSON only.';
const STRICT_JSON_INSTR = `
You are evaluating a four-part English proficiency test. Return ONLY one JSON object with this exact schema and nothing else:

{
  "score": number,            // integer 0-10
  "level": "Beginner"|"Intermediate"|"Advanced"|"Near-native"|"Native-like",
  "reasons": string,          // 2-4 concise sentences; mention each part briefly
  "suggestions": string[]     // 3-5 concise, actionable tips
}

Test structure and rubric (overall score = weighted sum; round to nearest integer):
- Part 1: Short Writing (40%)
  Prompt: "If you suddenly had a free week with no responsibilities, how would you spend it?"
  Judge: coherence, grammar, vocabulary range, natural collocations, flow, register. Penalize robotic or memorized text.
- Part 2: Idiom Meaning (20%)
  Idiom: "That project was a blessing in disguise."
  Judge: whether the user explains that something initially negative/hidden actually led to a positive outcome.
- Part 3: Word Choice (20%)
  Items (choose the more natural option):
   • "Let’s meet in the evening / on the evening." → natural: "in the evening"
   • "She suggested to go / going for a walk."     → natural: "going"
   • "I’m looking forward to meet / to meeting you."→ natural: "to meeting"
  Judge: accuracy of selected forms and awareness of idiomatic usage.
- Part 4: Subtle Grammar (20%)
  Fill-in: "If I ___ known about the traffic, I would have left earlier."
  Natural completion: "had" → "If I had known…"
  Judge: correct tense/form; penalize incorrect or awkward alternatives.

Output guidelines:
- Produce ONE overall integer score 0–10 using the weights above.
- "reasons": summarize strengths/weaknesses across the four parts (one clause per part is fine).
- "suggestions": concrete next steps (e.g., collocations, articles, conditionals, gerund/infinitive practice).
- Do NOT echo the full answers or include any preamble or markdown. Strict JSON only.
`;

// --- Health
app.get('/', (_req, res) => res.send('OK'));

// --- Helpers
function extractJson(raw) {
  if (!raw || typeof raw !== 'string') throw new Error('Empty response');
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) s = fence[1].trim();
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) s = s.slice(first, last + 1);
  return JSON.parse(s);
}

function normalizeResult(out) {
  const obj = Array.isArray(out) ? out[0] : out;
  const scoreNum = Math.round(Number(obj?.score ?? 0));
  return {
    score: Math.max(0, Math.min(10, scoreNum)),
    level: obj?.level || 'Intermediate',
    reasons: obj?.reasons || 'Results normalized.',
    suggestions: Array.isArray(obj?.suggestions) && obj.suggestions.length
      ? obj.suggestions
      : ['Practice collocations and article usage.', 'Review conditionals (3rd).', 'Reinforce gerund/infinitive patterns.']
  };
}

async function askOnce({ system, user, max_tokens = 700 }) {
  // Broadly compatible params (some free providers 400 on response_format)
  const r = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    temperature: 0.0,
    top_p: 1.0,
    max_tokens
  });
  return r.choices?.[0]?.message?.content ?? '';
}

// --- Route
app.post('/assess', async (req, res) => {
  try {
    console.log('POST /assess', new Date().toISOString(), 'mock=', req.query.mock);

    const parsed = AnswersSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Bad input', detail: parsed.error.issues });
    }

    // Mock path (no provider call)
    if (req.query.mock === '1') {
      return res.json({
        score: 7,
        level: 'Advanced',
        reasons: 'Strong writing (P1), correct idiom meaning (P2); minor issues in word choice (P3) and conditional form (P4).',
        suggestions: [
          'Vary sentence openings to avoid repetition.',
          'Practice gerund vs. infinitive after common verbs (e.g., suggest + gerund).',
          'Reinforce 3rd conditional forms ("If I had known…").',
          'Review common time expressions ("in the evening").'
        ]
      });
    }

    const [a1, a2, a3, a4] = parsed.data.answers;
    const userText = [
      `Part 1 — Candidate answer:\n${a1}`,
      `Part 2 — Candidate answer:\n${a2}`,
      `Part 3 — Candidate answer:\n${a3}`,
      `Part 4 — Candidate answer:\n${a4}`
    ].join('\n\n');

    // Attempt 1
    console.time('llm-call-1');
    const raw1 = await askOnce({
      system: SYSTEM_PROMPT,
      user: STRICT_JSON_INSTR + `\n\nEvaluate the following four parts and output exactly one JSON object:\n\n${userText}`
    });
    console.timeEnd('llm-call-1');

    let out;
    try {
      out = extractJson(raw1);
    } catch (e1) {
      console.warn('Parse failed once. First 200 chars of raw1:', String(raw1).slice(0, 200));

      // Attempt 2
      console.time('llm-call-2');
      const raw2 = await askOnce({
        system: 'Output STRICT JSON only. No preamble, no extra text, no markdown.',
        user: `Schema: {"score":number,"level":"Beginner"|"Intermediate"|"Advanced"|"Near-native"|"Native-like","reasons":string,"suggestions":string[]}\n\nEvaluate these four parts:\n${userText}\n\nReturn ONE JSON object only.`
      });
      console.timeEnd('llm-call-2');

      try {
        out = extractJson(raw2);
      } catch (e2) {
        console.error('Parse failed twice. First 200 chars of raw2:', String(raw2).slice(0, 200));
        return res.status(500).json({ error: 'Assessment failed', detail: 'Model did not return JSON' });
      }
    }

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

// --- Start
const port = process.env.PORT || 8787;
app.listen(port, () => {
  console.log(`API running at http://localhost:${port}`);
  console.log(`Model: ${MODEL}`);
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Public app URL: ${PUBLIC_APP_URL}`);
  console.log(`CORS allow: ${corsOrigins.length ? corsOrigins.join(', ') : '*'}`);
});
