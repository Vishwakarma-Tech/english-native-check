import { useEffect, useMemo, useRef, useState } from "react";

const API_BASE = import.meta.env.VITE_API_URL || "https://english-native-check.onrender.com";

/* fetch with timeout */
async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try { return await fetch(url, { ...options, signal: ac.signal, cache: "no-store" }); }
  finally { clearTimeout(t); }
}

/* wake server first (handles Render cold starts) */
async function wakeServer({ healthUrl, maxAttempts = 6, startBackoffMs = 500, timeoutMs = 12000 }) {
  let backoff = startBackoffMs;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const r = await fetchWithTimeout(healthUrl, { method: "HEAD", mode: "cors" }, timeoutMs);
      if (r.ok || (r.status >= 200 && r.status < 400)) return;
      const r2 = await fetchWithTimeout(healthUrl, { method: "GET", mode: "cors" }, timeoutMs);
      if (r2.ok || (r2.status >= 200 && r2.status < 400)) return;
    } catch {}
    await new Promise(res => setTimeout(res, backoff));
    backoff = Math.min(backoff * 2, 7000);
  }
  throw new Error("Server did not wake in time");
}

export default function App() {
  const [answers, setAnswers] = useState(["", "", "", ""]);
  const [phase, setPhase] = useState("idle"); // idle | prewarming | waking | submitting | done | error
  const [seconds, setSeconds] = useState(0);
  const [result, setResult] = useState(null);
  const [errMsg, setErrMsg] = useState("");
  const [mocking, setMocking] = useState(false);
  const [serverModel, setServerModel] = useState("");

  const tickerRef = useRef(null);
  const startTicker = () => { stopTicker(); setSeconds(0); tickerRef.current = setInterval(() => setSeconds(s => s + 1), 1000); };
  const stopTicker  = () => { if (tickerRef.current) { clearInterval(tickerRef.current); tickerRef.current = null; } };

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setPhase("prewarming");
        try {
          const m = await fetchWithTimeout(`${API_BASE}/meta`, { method: "GET", mode: "cors" }, 8000);
          if (m?.ok) {
            const j = await m.json();
            if (mounted && j?.model) setServerModel(j.model);
          }
        } catch {}
        await wakeServer({ healthUrl: `${API_BASE}/`, maxAttempts: 3, startBackoffMs: 300, timeoutMs: 8000 });
      } catch {} finally {
        if (mounted) setPhase("idle");
      }
    })();
    return () => { mounted = false; stopTicker(); };
  }, []);

  const canSubmit = useMemo(
    () => answers.every(a => a.trim().length > 0) && phase !== "waking" && phase !== "submitting",
    [answers, phase]
  );

  async function handleSubmit(e) {
    e.preventDefault();
    setErrMsg(""); setResult(null);
    try {
      setPhase("waking"); startTicker();
      await wakeServer({ healthUrl: `${API_BASE}/` });

      setPhase("submitting");
      const res = await fetchWithTimeout(
        `${API_BASE}/assess${mocking ? "?mock=1" : ""}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answers }), mode: "cors" },
        30000
      );

      const headerModel = res.headers?.get("x-model");
      if (headerModel && !serverModel) setServerModel(headerModel);

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`API ${res.status}: ${text}`);
      }
      const data = await res.json();

      const bodyModel = data?._meta?.model;
      if (bodyModel) setServerModel(bodyModel);
      else if (headerModel && !serverModel) setServerModel(headerModel);

      setResult(data);
      setPhase("done");
    } catch (err) {
      setErrMsg(err?.message || "Submission failed");
      setPhase("error");
    } finally { stopTicker(); }
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        {/* HEADER */}
        <header className="mb-6">
          <h1 className="text-3xl font-semibold tracking-tight">English Native Check</h1>
          <p className="text-sm text-gray-600 mt-1">
            AI Lab project by <span className="font-medium">Vik Gadgil</span>, powered by{" "}
            <span className="font-medium">OpenRouter</span> (multi-model aggregator).
          </p>
          <p className="text-sm text-gray-700 mt-2">
            Answer 4 questions to assess how close you are to a{" "}
            <span className="font-medium">Native English Speaker</span>.
          </p>
          <p className="text-xs text-gray-500 mt-2">
            First run on the free tier may take a few seconds while the server wakes up.
          </p>
        </header>

        {/* CARD */}
        <main className="bg-white rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.06)] p-6">
          <form onSubmit={handleSubmit} className="space-y-5">
            {[
              "Part 1 — Write a short paragraph.",
              "Part 2 — Explain the idiom 'blessing in disguise'.",
              "Part 3 — Use these fragments in a sentence: 'in the evening; suggested going; looking forward to meeting'.",
              "Part 4 — Fill in two blanks and reproduce the complete sentence.",
            ].map((label, i) => (
              <div key={i} className="space-y-2">
                <label className="block text-sm font-medium">{label}</label>

                {/* Extra helper text ONLY for Part 4 with the exact two-blanks sentence */}
                {i === 3 && (
                  <p className="text-xs text-gray-600">
                    Use exactly this sentence template:{" "}
                    <code className="bg-gray-100 px-1 py-0.5 rounded">If I ___ known, I would have ___.</code>
                    {" "}Fill the two blanks and then write the complete corrected sentence.
                  </p>
                )}

                <textarea
                  value={answers[i]}
                  onChange={(e) => { const copy = answers.slice(); copy[i] = e.target.value; setAnswers(copy); }}
                  className="w-full border rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-black/60"
                  rows={i === 0 ? 4 : 3}
                  placeholder={
                    i === 0 ? "Write 3–4 sentences on any topic."
                    : i === 1 ? "Explain the meaning and give a brief example."
                    : i === 2 ? "Combine: in the evening; suggested going; looking forward to meeting."
                    : "Fill the two blanks and reproduce the full sentence (3rd conditional)."
                  }
                />
              </div>
            ))}

            <div className="flex items-center justify-between gap-3">
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" checked={mocking} onChange={() => setMocking(v => !v)} />
                Use mock response (server-side)
              </label>
              <button
                type="submit"
                disabled={!canSubmit}
                className="inline-flex items-center justify-center px-4 py-2 rounded-lg text-white bg-black hover:bg-black/90 disabled:bg-gray-400 disabled:cursor-not-allowed"
                aria-busy={phase === "waking" || phase === "submitting"}
              >
                {phase === "submitting" ? "Submitting…" : "Check"}
              </button>
            </div>
          </form>

          {(phase === "waking" || phase === "submitting") && (
            <div className="mt-6 flex items-center gap-3">
              <span
                aria-label="Loading"
                role="status"
                className="inline-block w-5 h-5 border-2 border-gray-300 border-t-black rounded-full animate-spin"
                style={{ borderRightColor: "transparent", borderBottomColor: "transparent" }}
              />
              <p className="text-sm">
                {phase === "waking" ? <>Waking up server… <span className="tabular-nums">{seconds}s</span></> : "Submitting…"}
              </p>
            </div>
          )}

          {phase === "error" && (
            <div className="mt-6 p-3 rounded-lg bg-red-50 text-red-700 text-sm break-words">
              <strong>Error:</strong> {errMsg}
            </div>
          )}

          {phase === "done" && result && (
            <div className="mt-6">
              <h2 className="text-lg font-semibold mb-2">Result</h2>
              <ResultCard data={result} />
            </div>
          )}

          {/* FOOTER INFO */}
          <footer className="mt-8 text-xs text-gray-500 space-y-1">
            <div>API: <code className="bg-gray-100 px-1 py-0.5 rounded">{API_BASE}</code></div>
            <div>Model: <code className="bg-gray-100 px-1 py-0.5 rounded">{serverModel || "unknown"}</code></div>
            <div className="mt-6 text-center text-xs text-gray-500 border-t pt-4">
              Made with <span className="font-medium">React + Vite</span> (frontend) and{" "}
              <span className="font-medium">Node.js + Express</span> (backend).<br />
              Deployed on <span className="font-medium">Vercel</span> & <span className="font-medium">Render</span>.
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}

function ResultCard({ data }) {
  const { score, level, reasons, suggestions, _meta } = data || {};
  const modelFromBody = _meta?.model;
  return (
    <div className="rounded-xl border p-4 bg-gray-50">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm text-gray-600">Score</div>
          <div className="text-2xl font-semibold">{Number.isFinite(score) ? score : "—"}/10</div>
        </div>
        <div className="text-right">
          <div className="text-sm text-gray-600">Level</div>
          <div className="text-lg font-medium">{level || "—"}</div>
        </div>
      </div>

      {modelFromBody && (
        <div className="mt-2 text-xs text-gray-600">
          Model: <code className="bg-gray-100 px-1 py-0.5 rounded">{modelFromBody}</code>
        </div>
      )}

      <div className="mt-4">
        <div className="text-sm font-medium">Why</div>
        <p className="text-sm text-gray-800 whitespace-pre-wrap">{reasons || "—"}</p>
      </div>

      <div className="mt-4">
        <div className="text-sm font-medium mb-1">Suggestions</div>
        {Array.isArray(suggestions) && suggestions.length ? (
          <ul className="list-disc pl-5 text-sm text-gray-800 space-y-1">
            {suggestions.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        ) : (
          <p className="text-sm text-gray-800">—</p>
        )}
      </div>
    </div>
  );
}
