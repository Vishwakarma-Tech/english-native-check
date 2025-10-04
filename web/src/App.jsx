import { useState } from "react";

export default function App() {
  const [p1, setP1] = useState(
    "I enjoy spending my free time reading books and exploring new ideas. Reading helps me relax while also expanding my knowledge and imagination. I also like going for walks in nature, which clears my mind and gives me energy. These activities keep me balanced and motivated in my daily life."
  );
  const [p2, setP2] = useState(
    'The phrase “blessing in disguise” means something that seems bad or unlucky at first but later turns out to have a good result. For example, losing a job might feel terrible initially, but it could lead to a better career opportunity. It describes a hidden advantage that only becomes clear with time.'
  );
  const [p3, setP3] = useState(
    "We decided to meet in the evening because it was convenient for everyone. My friend suggested going to a new café nearby. I am looking forward to meeting her and catching up after a long time."
  );
  const [p4, setP4] = useState("If I had known, I would have prepared better and avoided the mistake.");

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b">
        <div className="mx-auto max-w-4xl px-4 py-6">
          <h1 className="text-2xl font-semibold">
            AI lab project by Vik Gadgil using <span className="underline">OpenRouter</span>
          </h1>
          <p className="text-slate-600 mt-2">
            Answer 4 questions to assess how close you are to a Native English Speaker.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8 space-y-8">
        {/* Part 1 */}
        <section className="bg-white rounded-2xl shadow p-6">
          <h2 className="text-lg font-semibold">Part 1 — short paragraph (3–4 sentences)</h2>
          <textarea
            className="mt-3 w-full rounded-lg border border-slate-300 p-3 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            rows={5}
            value={p1}
            onChange={(e) => setP1(e.target.value)}
            placeholder="Type your answer for part 1 — short paragraph (3–4 sentences)"
          />
        </section>

        {/* Part 2 */}
        <section className="bg-white rounded-2xl shadow p-6">
          <h2 className="text-lg font-semibold">Part 2 — explain the idiom “blessing in disguise”</h2>
          <textarea
            className="mt-3 w-full rounded-lg border border-slate-300 p-3 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            rows={5}
            value={p2}
            onChange={(e) => setP2(e.target.value)}
            placeholder="Type your answer for part 2 — explain the idiom 'blessing in disguise'"
          />
        </section>

        {/* Part 3 */}
        <section className="bg-white rounded-2xl shadow p-6">
          <h2 className="text-lg font-semibold">
            Part 3 — choose the natural options{" "}
            <span className="text-slate-500">
              (e.g., “in the evening; suggested going; looking forward to meeting”)
            </span>
          </h2>
          <textarea
            className="mt-3 w-full rounded-lg border border-slate-300 p-3 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            rows={4}
            value={p3}
            onChange={(e) => setP3(e.target.value)}
            placeholder="Type your answer for part 3 — choose the natural options"
          />
        </section>

        {/* Part 4 — exact two-blank sentence */}
        <section className="bg-white rounded-2xl shadow p-6">
          <h2 className="text-lg font-semibold">Part 4 — If I ____ known, I would have ______.</h2>
          <input
            className="mt-3 w-full rounded-lg border border-slate-300 p-3 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            value={p4}
            onChange={(e) => setP4(e.target.value)}
            placeholder="If I ____ known, I would have ______."
          />
        </section>

        {/* Submit */}
        <section className="flex justify-end">
          <button
            type="button"
            className="rounded-xl bg-indigo-600 px-5 py-3 text-white font-medium hover:bg-indigo-700 active:scale-[.99] transition"
            onClick={() => {
              console.log({ p1, p2, p3, p4 });
              alert("Saved locally (stub). Hook this to your API call.");
            }}
          >
            Submit
          </button>
        </section>
      </main>

      <footer className="mt-10 border-t">
        <div className="mx-auto max-w-4xl px-4 py-6 text-sm text-slate-500">
          © {new Date().getFullYear()} Vik Gadgil • English-Native-Check
        </div>
      </footer>
    </div>
  );
}
