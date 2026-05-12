# Voice-Controlled Task Manager

A voice-first task manager that lets you create, read, update, and delete tasks entirely through natural speech. No edit buttons. No delete buttons. Just talk.

Built with **SvelteKit + TypeScript**, powered by **Groq** for LLM intent parsing, Whisper STT, and PlayAI TTS, and backed by **PostgreSQL**.

---

## Features

- Voice-based task creation (single & multiple in one command)
- Voice-based agenda reading with natural time phrases (today, tomorrow, this evening, etc.)
- Voice-based task update with context references (“change the previous one”, “move the second one”)
- Voice-based deletion with mandatory confirmation
- Conversation context memory (last listed, created, updated tasks + pending confirmations)
- Semantic task matching (e.g. “workout” ≈ “gym”)
- Interruption handling — speak over the assistant to redirect
- Graceful failure handling for STT/TTS/LLM/network errors

---

## Architecture

```
User voice
  ↓
MediaRecorder (browser)
  ↓
/api/stt  →  Groq Whisper           → transcript
  ↓
/api/agent/command
  ↓
Groq LLM (llama-3.3-70b)  → structured JSON action
  ↓
Task Engine (validate + matcher + time parser)
  ↓
PostgreSQL (tasks, conversation, context state)
  ↓
responseText
  ↓
/api/tts  →  Groq PlayAI TTS        → audio
  ↓
Audio playback in browser
```

The LLM **never** mutates storage directly. It only returns a structured JSON action which the task engine validates and executes.

---

## Tech Stack

| Layer        | Choice                                      |
| ------------ | ------------------------------------------- |
| Frontend     | SvelteKit 2 + TypeScript + Tailwind CSS     |
| LLM          | Groq · `llama-3.3-70b-versatile`            |
| STT          | Groq · `whisper-large-v3-turbo`             |
| TTS          | Groq · `playai-tts` (voice: `Fritz-PlayAI`) |
| Database     | PostgreSQL (any provider)                   |
| Time parsing | `chrono-node` + custom time-of-day handler  |

---

## Setup

### 1. Install

```bash
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env` and fill in:

```bash
cp .env.example .env
```

- `GROQ_API_KEY` — from <https://console.groq.com>
- `DATABASE_URL` — your Postgres connection string (e.g. from the PocketBase / Postgres instance you’ll provide)
- `DATABASE_SSL=true` if your provider requires SSL

### 3. Initialize the database

Apply the schema:

```bash
npm run db:init
```

Or run `schema.sql` manually:

```bash
psql "$DATABASE_URL" -f schema.sql
```

### 4. Run

```bash
npm run dev
```

Open <http://localhost:5173> in **Chrome desktop** (best browser support for `MediaRecorder` + microphone).

---

## Docker

In production the SvelteKit frontend and the WebSocket backend run inside a **single Node process on a single port**, so the image is deployable as-is on EasyPanel, Fly.io, Render, Railway, or any Docker host.

### Build

```bash
docker build -t voicetask .
```

### Run locally

You need a reachable Postgres and a Groq API key. The fastest way is to point at a managed Postgres (Neon, Supabase, Railway, etc.) and run:

```bash
docker run --rm -p 3000:3000 \
  -e GROQ_API_KEY=sk_your_key \
  -e DATABASE_URL='postgres://user:pass@host:5432/dbname' \
  -e DATABASE_SSL=true \
  voicetask
```

Or pass your local `.env` file:

```bash
docker run --rm -p 3000:3000 --env-file .env voicetask
```

Then open <http://localhost:3000> in Chrome.

> **First run only**: apply the schema once against your Postgres before starting the container:
>
> ```bash
> DATABASE_URL='postgres://...' npm run db:init
> # or
> psql "$DATABASE_URL" -f schema.sql
> ```

### Environment variables

| Variable           | Required | Default                       | Notes                                              |
| ------------------ | -------- | ----------------------------- | -------------------------------------------------- |
| `GROQ_API_KEY`     | yes      | —                             | From <https://console.groq.com>                    |
| `DATABASE_URL`     | yes      | —                             | Postgres connection string                         |
| `DATABASE_SSL`     | no       | `false`                       | Set `true` for managed providers (Neon, Supabase…) |
| `PORT`             | no       | `3000`                        | HTTP + WebSocket port the container listens on     |
| `GROQ_LLM_MODEL`   | no       | `llama-3.3-70b-versatile`     |                                                    |
| `GROQ_STT_MODEL`   | no       | `whisper-large-v3-turbo`      |                                                    |
| `GROQ_TTS_MODEL`   | no       | `canopylabs/orpheus-v1-english` |                                                  |
| `GROQ_TTS_VOICE`   | no       | `hannah`                      |                                                    |

### Deploy on EasyPanel

1. Push this repo to GitHub (the `Dockerfile` at the root is all EasyPanel needs).
2. In EasyPanel, create a new **App** → **Source: GitHub** → select this repo → **Build type: Dockerfile**.
3. Under **Environment**, set the variables above (at minimum `GROQ_API_KEY`, `DATABASE_URL`, and `DATABASE_SSL=true` if your Postgres requires it).
4. Under **Ports**, expose container port **3000** (HTTP). EasyPanel's reverse proxy forwards both HTTP and WebSocket upgrade requests, so `/ws` works out of the box — **no extra port is required**.
5. (One-time) From any machine with `psql` or `node` installed, run `npm run db:init` against the same `DATABASE_URL` to create the schema.
6. Deploy. Open the assigned domain in Chrome.

---

## Demo Script

1. **Create**: “Create a task for syncing with the product manager at 10 AM.”
2. **Create**: “Create a task for posting on LinkedIn at 5 PM.”
3. **Update**: “Change the LinkedIn task to 6 PM.”
4. **Context update**: “Actually change the previous one to 7 PM.”
5. **Read agenda**: “What are my evening tasks?”
6. **Ordinal context**: “Move the first one to tomorrow.”
7. **Delete with confirmation**: “Delete the LinkedIn task.” → “Yes.”
8. **Multiple creation**: “Create three tasks for tomorrow morning. Gym at 7 AM, team sync at 9 AM, and post on LinkedIn at 11 AM.”

---

## Project Layout

```
src/
  lib/
    server/
      agent/           # LLM prompt + JSON intent parser
      tasks/           # task store (Postgres), engine, matcher, time parser
      db.ts            # pg pool
      groq.ts          # Groq client + model config
    components/        # Svelte UI components (orb, list, transcript)
    voice/             # MediaRecorder + TTS client
    types.ts
  routes/
    +page.svelte       # main UI
    api/
      agent/command/   # POST: transcript → action → response
      stt/             # POST: audio blob → transcript
      tts/             # POST: text → WAV audio
      tasks/           # GET: list tasks + recent messages
schema.sql             # Postgres schema
scripts/init-db.mjs    # one-shot schema applier
```

---

## Known Limitations

- Best tested on Chrome desktop (MediaRecorder support varies on Safari/Firefox).
- Browser-based MediaRecorder produces WebM/Opus; Groq Whisper accepts this directly.
- Reminders are stored as scheduled times — background push notifications are not implemented.
- LLM output is JSON-mode constrained and validated, but rare edge cases may require clarification.
- Single-user MVP (a default user UUID is seeded in `users`).

---

## Future Improvements

- User authentication & multi-tenant isolation
- Push notifications for upcoming reminders
- Recurring tasks
- Calendar sync
- Embedding-based semantic task matching
- Multi-language voice
# Voice-Controlled-Task-Manager
