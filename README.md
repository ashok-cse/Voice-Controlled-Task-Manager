# Voice-Controlled Task Manager

A voice-first task manager: create, read, update, complete, and delete tasks through natural speech—plus recurring stretches over days/weeks when asked. Built with **SvelteKit + TypeScript**, **Groq** (LLM + Whisper STT + TTS), **PostgreSQL**, and a **WebSocket** backend.

---

## Features

- Voice pipeline: browser **MediaRecorder** → Groq **Whisper** → transcript → Groq **LLM** (structured JSON intent) → task engine → Groq **TTS** → playback (with **barge-in**).
- Full task lifecycle by voice: **create** (single or multi-task utterances), **read** with filters (today / tomorrow / week / time-of-day), **update**, **complete**, **delete** (always **confirmation** first).
- **Session auth**: email/password **signup/login**, opaque session tokens over the same WebSocket; tasks are scoped **per user**.
- **Conversation memory**: last listed / created / updated task IDs, pending confirmations, multi-turn slot filling for incomplete creates.
- **Natural times**: **chrono-node** + custom phrases + **Luxon**; the browser sends **`Intl` timezone** so spoken times match the UI (no server-vs-local clock drift).
- **Semantic-ish matching**: fuzzy title match (`pg_trgm`), ordinals (“the second one”), context (“previous”, “that”).
- **Recurring tasks**: `CREATE_TASK` / `REPEAT_TASK` with `repeat.count` × `day` or `week` (materialized rows).

---

## Submission checklist (typical brief ↔ this repo)

_Use this section against your course PDF; rename bullets if your rubric uses different wording._

| Requirement area | How it is met |
| ---------------- | ------------- |
| Voice input / STT | Audio sent over **`ws`** message type **`stt`** → Groq Whisper (`backend/wsHandlers.ts`, `src/lib/voice/voiceClient.ts`). |
| NLP / intent | Groq chat completions **JSON mode** → validated action (`backend/agent/parseIntent.ts`, `agentPrompt.ts`). |
| Voice output / TTS | **`tts`** WebSocket message → Groq speech API → WAV playback in browser. |
| Persistence | **PostgreSQL**: users, sessions, tasks, conversation messages, conversation state (`schema.sql`, `backend/tasks/taskStore.ts`, `backend/db.ts`). |
| CRUD & queries | Task engine executes intents (`backend/tasks/taskEngine.ts`): create/read/update/complete/delete + filters + repeat. |
| Time & schedules | Parsedwall-clock expressions resolved in the **client’s IANA timezone** (`backend/tasks/timeParser.ts`, `backend/userTime.ts`, payload `timeZone` from `src/routes/+page.svelte`). |
| Architecture | **Single binary** in production: SvelteKit **adapter-node** handler + **`ws`** on one HTTP server (`backend/server.ts`). |
| Deployability | **`Dockerfile`**, env-driven config, documented ports and **`DATABASE_SSL`**. |
| Auth / multi-user | Signup/login/logout/`auth:me` over WebSocket (`backend/auth.ts`, `AuthGate.svelte`). Legacy **`default-user`** UUID remains seeded for older data (`schema.sql`). |

---

## Architecture

```
Browser (SvelteKit)
  MediaRecorder → audio blob
       ↓
  WebSocket /ws  →  message type "stt"  →  Groq Whisper  →  transcript
       ↓
  WebSocket /ws  →  "agent:command" { transcript, timeZone }
       ↓
  Groq LLM (JSON action)  →  executeAction + Postgres
       ↓
  responseText + tasks
       ↓
  WebSocket /ws  →  "tts"  →  Groq TTS  →  WAV → speakers
```

The **LLM never writes to the database directly**. It returns a structured **`AgentAction`**; the task engine validates, confirms deletes, and executes SQL.

**Development**: Vite dev server (default **5173**) proxies **`/ws`** to the Node backend (**`BACKEND_PORT`**, default **8787**). **Production**: `npm run build` then `npm run start` serves HTTP + **`/ws`** on **`PORT`** (default **3000**).

---

## Tech stack

| Layer | Choice |
| ----- | ------ |
| Frontend | SvelteKit 2 · Svelte 5 · TypeScript · Tailwind CSS |
| Transport | **`ws`** WebSocket (`/ws`), not REST `/api/*` routes |
| LLM | Groq · env **`GROQ_LLM_MODEL`** (default `llama-3.3-70b-versatile`) |
| STT | Groq · **`GROQ_STT_MODEL`** (default `whisper-large-v3-turbo`) |
| TTS | Groq · **`GROQ_TTS_MODEL`** / **`GROQ_TTS_VOICE`** (defaults: Orpheus English · `hannah`) |
| Database | PostgreSQL · **`pg`** |
| Dates | **`chrono-node`** · **`luxon`** · client **`Intl`** timezone |

---

## Setup

### 1. Install

```bash
npm install
```

### 2. Environment

```bash
cp .env.example .env
```

Set **`GROQ_API_KEY`** (from [Groq Console](https://console.groq.com)), **`DATABASE_URL`**, and **`DATABASE_SSL=true`** if your host requires TLS.

### 3. Database schema

```bash
npm run db:init
```

Or: `psql "$DATABASE_URL" -f schema.sql`

### 4. Run (dev)

```bash
npm run dev
```

Open **http://localhost:5173** in **Chrome** (recommended for MediaRecorder + microphone).

---

## Docker

The image listens on **`PORT`** (default **3000**) for HTTP and **`/ws`** on the same port—fine behind Railway, Fly.io, Render, EasyPanel, etc., as long as WebSocket upgrades are allowed.

Build and run (schema must already exist on Postgres):

```bash
docker build -t voicetask .
docker run --rm -p 3000:3000 --env-file .env voicetask
```

Example inline env:

```bash
docker run --rm -p 3000:3000 \
  -e GROQ_API_KEY=your_groq_api_key \
  -e DATABASE_URL='postgres://user:pass@host:5432/dbname' \
  -e DATABASE_SSL=true \
  voicetask
```

Then open **http://localhost:3000**.

### Environment variables

| Variable | Required | Default | Notes |
| -------- | -------- | ------- | ----- |
| **`GROQ_API_KEY`** | yes | — | Groq Cloud API key |
| **`DATABASE_URL`** | yes | — | Postgres URL |
| **`DATABASE_SSL`** | no | `false` | `true` for Neon, Supabase, Railway, etc. |
| **`PORT`** | no | `3000` | HTTP + **`/ws`** |
| **`GROQ_LLM_MODEL`** | no | `llama-3.3-70b-versatile` | |
| **`GROQ_STT_MODEL`** | no | `whisper-large-v3-turbo` | |
| **`GROQ_TTS_MODEL`** | no | `canopylabs/orpheus-v1-english` | |
| **`GROQ_TTS_VOICE`** | no | `hannah` | |

---

## Demo script

1. Sign up / log in via the gate.
2. **Create**: “Create a task for syncing with the product manager at 10 AM.”
3. **Multi-create**: “Create three tasks for tomorrow morning. Gym at 7, team sync at 9, LinkedIn post at 11.”
4. **Read**: “How many pending tasks do I have?” / “What’s on my list tomorrow?”
5. **Update**: “Change the LinkedIn task to 6 PM.” → “Actually change the previous one to 7 PM.”
6. **Complete**: “Mark the gym task done.”
7. **Delete**: “Delete the LinkedIn task.” → confirm **Yes**.
8. **Repeat**: “Repeat the gym task every day for a week.”

---

## Project layout

```
backend/
  server.ts           # HTTP + WebSocket server (imports built SvelteKit handler when present)
  wsHandlers.ts       # auth:*, tasks:list, agent:command, stt, tts
  auth.ts             # signup / login / sessions
  db.ts               # Postgres pool
  groq.ts             # Groq client + model env vars
  userTime.ts         # client timezone normalization + speech formatting
  agent/              # LLM prompt + parseIntent
  tasks/              # taskEngine, taskStore, taskMatcher, timeParser
schema.sql
scripts/init-db.mjs
src/
  routes/
    +page.svelte      # main app (hands-free loop, sends timeZone with commands)
    +layout.svelte
  lib/
    auth.ts
    types.ts
    components/       # AuthGate, VoiceOrb, TaskList, Transcript
    voice/            # wsClient.ts, voiceClient.ts (STT/TTS/recorder)
Dockerfile
```

---

## Known limitations

- **Browser**: Chrome desktop is the main tested target; Safari/Firefox microphone codecs may differ.
- **Notifications**: Scheduled times are stored; **no push reminders** or OS alarms.
- **LLM**: JSON-mode parsing can still occasionally need clarification (**UNKNOWN** path).
- **Timezone**: Stored instants are UTC; wording and filters assume the browser-reported **`Intl`** zone per session.

---

## Future improvements

- Push / email reminders near **`scheduled_at`**
- True RRULE-style recurrence (beyond materialized day/week strips)
- Calendar export (ICS) or external calendar sync
- Stronger embedding-based semantic match across titles
- Multi-language STT/TTS and prompts
