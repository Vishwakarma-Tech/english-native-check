import { useState } from 'react';
import ky from 'ky';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8787';

const QUESTIONS = [
  "Describe your typical weekday in 3–5 sentences.",
  "Tell me about a surprising project outcome and why it was surprising.",
  "Make plans with a friend for this evening (2–4 sentences).",
  "If you had a free week, what would you do?"
];

export default function App() {
  const [answers, setAnswers] = useState(["","","",""]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const update = (i, v) => {
    const next = answers.slice();
    next[i] = v;
    setAnswers(next);
  };

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true); setError(""); setResult(null);
    try {
      const data = await ky.post(`${API_URL}/assess`, { json: { answers } }).json();
      setResult(data);
    } catch {
      setError("Assessment failed. Check API URL or CORS.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{maxWidth:760, margin:"2rem auto", fontFamily:"system-ui, sans-serif"}}>
      <h1>Native-like English Check</h1>
	<p style={{ fontSize: "0.9rem", color: "#666", marginTop: "-0.5rem" }}>			
           Created by Vik Gadgil – AI Lab Project – using OpenRouter LLM broker
	</p>
      <p>Answer four prompts. We’ll score native-likeness (0–10) and suggest improvements.</p>

      <form onSubmit={submit}>
        {QUESTIONS.map((q,i)=>(
          <div key={i} style={{margin:"1rem 0"}}>
            <label><strong>{q}</strong></label>
            <textarea
              rows={5}
              required
              style={{width:"100%", padding:"0.75rem"}}
              value={answers[i]}
              onChange={e=>update(i, e.target.value)}
            />
          </div>
        ))}
       <button
  disabled={loading}
  style={{
    padding: "0.6rem 1rem",
    backgroundColor: loading ? "#666" : "#333",  // dark gray/black
    color: "white",
    border: "none",
    borderRadius: "4px",
    cursor: loading ? "not-allowed" : "pointer"
  }}
>
  {loading ? "Scoring..." : "Get Score"}
</button>
      </form>

      {error && <p style={{color:"crimson"}}>{error}</p>}

      {result && (
        <div style={{marginTop:"1.5rem", padding:"1rem", border:"1px solid #ddd", borderRadius:8}}>
          <h2>Result: {result.score}/10 — {result.level}</h2>
          <p><strong>Why:</strong> {result.reasons}</p>
          <ol>
            {result.suggestions.map((s, idx) => <li key={idx}>{s}</li>)}
          </ol>
        </div>
      )}
    </div>
  );
}

