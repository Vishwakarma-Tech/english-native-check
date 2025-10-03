import { useEffect, useMemo, useRef, useState } from "react";

const API_BASE = import.meta.env.VITE_API_URL || "https://english-native-check.onrender.com";

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try { return await fetch(url, { ...options, signal: ac.signal, cache: "no-store" }); }
  finally { clearTimeout(t); }
}

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
    <div className="py-10">
      <div className="container">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold">English Native Check</h1>
          <p className="subtle">First run on the free tier may take a few seconds while the server wakes up.</p>
        </header>

        <main className="card">
          <form onSubmit={handleSubmit} className="space-y-4">
            {[
              "Part 1 — short paragraph (3–4 sentences)",
              "Part 2 — explain the idiom 'blessing in disguise'",
              "Part 3 — choose the natural options (e.g., 'in the evening; suggested going; looking forward to meeting')",
              "Part 4 — fill: If I ___ known, I would have…",
            ].map((label, i) => (
              <div key={i}>
                <label className="label">{label}</label>
                <textarea
                  value={answers[i]}
                  onChange={(e) => { const copy = answers.slice(); copy[i] = e.target.value; setAnswers(copy); }}
                  className="input"
                  rows={i === 0 ? 4 : 3}
                  placeholder={`Type your answer for ${label.toLowerCase()}`}
                />
              </div>
            ))}

            <div className="flex items-center justify-between gap-3">
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" checked={mocking} onChange={() => setMocking(v => !v)} />
                Use mock response (server-side)
              </label>
              <button type="submit" disabled={!canSubmit} className="btn" aria-busy={phase === "waking" || phase === "submitting"}>
                {phase === "submitting" ? "Submitting…" : "Check"}
              </button>
            </div>
          </form>

          {(phase === "waking" || phase === "submitting") && (
            <div className="mt-6 flex items-center gap-3">
              <span className="spinner" />
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

          <footer className="mt-8 text-xs text-gray-500 space-y-1">
            <div>API: <code className="code">{API_BASE}</code></div>
            <div>Model: <code className="code">{serverModel || "unknown"}</code></div>
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
          Model: <code className="code">{modelFromBody}</code>
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
