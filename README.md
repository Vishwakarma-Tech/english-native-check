# English Native Check (AI Lab Project)

Created by Vik Gadgil – AI Lab project using the OpenRouter LLM broker.
This app asks 4 open-ended questions, submits the answers to an LLM, and returns a score (0–10) with feedback on how close the user sounds to a native English speaker.

---

## 🏗️ Architecture

Frontend: React (Vite) → deployed on Vercel
Backend: Node.js + Express → deployed on Render
LLM Broker: OpenRouter.ai (free-tier models, OpenAI-compatible API)

Flow:
Browser (React) → Backend API (Express) → OpenRouter → LLM model → JSON response → UI display

---

## ⚙️ Platform & Tool Choices

- OpenRouter (LLM broker)  
  One API to many models (LLaMA, Gemma, Mistral, DeepSeek, etc.), with free usage tiers.  
  Why: Flexibility without code rewrites, OpenAI-compatible SDK.

- Node.js + Express (Backend)  
  Small REST API to normalize model output into consistent JSON.  
  Why: Fast to build, deploy anywhere, huge ecosystem.

- Zod (Validation)  
  Strict schema checks for request/response.  
  Why: Avoids sending bad data to LLM, enforces contract.

- Render (Backend Hosting)  
  Simple GitHub integration, free tier for APIs, easy env var management.  
  Why: Minimal setup to get a public API URL.

- React + Vite (Frontend)  
  Modern, fast development, hot reload.  
  Why: Perfect for quick forms and dynamic UI.

- Vercel (Frontend Hosting)  
  One-click GitHub deploys, free global CDN, auto-previews.  
  Why: Dead simple to go live and share.

- CORS & Env Vars  
  Safe browser-to-API communication, model switching, staging vs prod configs.  
  Why: Keeps secrets out of the frontend and makes deployments portable.

- ky (frontend HTTP client)  
  Tiny, promise-based wrapper around fetch with nice ergonomics.  
  Alternatives: Native fetch (no dependency), Axios (heavier).

- express-rate-limit (backend)  
  Prevents spam and abuse.  
  Why: Basic protection for a public endpoint.

---

## 🚀 Getting Started (Local)

1. Clone the repo  
   git clone https://github.com/Vishwakarma-Tech/english-native-check.git  
   cd english-native-check  

2. Backend (server/)  
   cd server  
   npm install  

   Create .env:  
   OPENROUTER_API_KEY=sk-or-...  
   OPENROUTER_BASE_URL=https://openrouter.ai/api/v1  
   OPENROUTER_MODEL=z-ai/glm-4.5-air:free  
   PORT=8787  

   Run:  
   npm start  

   API available at: http://localhost:8787/assess  

3. Frontend (web/)  
   cd ../web  
   npm install  

   Create .env.local:  
   VITE_API_URL=http://localhost:8787  

   Run dev server:  
   npm run dev  

   Open: http://127.0.0.1:5174/

---

## 🌐 Deployment

- Backend → Render  
  Add env vars in Render:  
  OPENROUTER_API_KEY  
  OPENROUTER_BASE_URL=https://openrouter.ai/api/v1  
  OPENROUTER_MODEL=z-ai/glm-4.5-air:free  
  CORS_ALLOW_ORIGIN=http://127.0.0.1:5174,https://<your-vercel-app>.vercel.app  

  Deploy → API at https://<your-app>.onrender.com  

- Frontend → Vercel  
  Root dir = web  
  Env var in Vercel:  
  VITE_API_URL=https://<your-api>.onrender.com

---

## 📊 Current Status

- ✅ MVP end-to-end working  
- ✅ API calls LLM and normalizes output  
- ✅ Frontend deployed, takes input and shows results  
- 🚧 Next: styling, error handling, user auth, analytics, persistence  

---

## 📈 Complexity

This project is an MVP demo (~3.5/10 complexity).  
It demonstrates the full stack: Git → Render → Vercel → OpenRouter → React UI.  

---

## ✨ Attribution

Created by Vik Gadgil  
AI Lab Project · Powered by OpenRouter
