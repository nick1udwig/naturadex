# NaturaDex

A cute, anime-inspired “pokedex for nature.” Capture a scene, send it to Claude for classification, and collect/share your field entries.

## Features

- 📸 Camera / upload capture
- 🧠 Claude Opus 4.5 image classification
- 🗂️ Collection with tags + details
- 🔗 Share single entries via link
- 🌍 Public/private dex toggle
- 🗑️ Soft delete with 1‑hour restore window

## Tech Stack

- **Backend:** Rust + Axum + SQLx (Postgres)
- **Frontend:** Vite + React + TypeScript
- **Storage:** Images on disk, metadata in Postgres

## Project Structure

```
backend/    Rust API server
frontend/   React app
```

## Requirements

- Rust (stable)
- Node.js 18+ (Node 20+ recommended)
- Postgres
- Anthropic API key

## Setup

### 1) Backend

```bash
cd backend
cp .env.example .env
```

Edit `.env` with your values:

```
DATABASE_URL=postgres://USER:PASSWORD@127.0.0.1:5432/naturadex
ANTHROPIC_API_KEY=sk-...
ANTHROPIC_MODEL=claude-opus-4-5
STORAGE_DIR=storage
```

Create the database (example):

```bash
createdb naturadex
```

Run the server (migrations run automatically):

```bash
cargo run
```

The API listens on `http://127.0.0.1:4000`.

### 2) Frontend

```bash
cd frontend
npm install
npm run dev
```

The app runs at `http://127.0.0.1:5173` (or the next available port).

## Usage

1. Open the app in your browser.
2. Choose **Open Camera**, **Upload Image**, or **Demo Scan**.
3. Click **Analyze Scene** to classify via Claude.
4. View the entry card, tags, and confidence.
5. Use **Share Entry** to generate a shareable link.
6. Toggle **Dex visibility** to public/private.
7. Browse **Collection** for all captured entries.

## Public & Share Links

- **Shared entry:** `/share/:token`
- **Public collection:** `/public` (only available if dex is public)

## Soft Delete / Restore

When an entry is deleted, it stays recoverable for **1 hour**. After that, both metadata and the image file are removed.

## API Endpoints (Backend)

- `GET /api/health`
- `GET /api/settings` / `PUT /api/settings`
- `GET /api/entries` / `POST /api/entries`
- `GET /api/entries/:id`
- `POST /api/entries/:id/delete`
- `POST /api/entries/:id/restore`
- `POST /api/entries/:id/share`
- `GET /api/share/:token`
- `GET /api/public/entries`
- `GET /media/...` (served images)

## Troubleshooting

- **Frontend can’t reach backend:** ensure backend is running on port 4000.
- **Proxy errors (ECONNREFUSED):** frontend dev proxy points to `127.0.0.1:4000`.
- **Node version warnings:** Vite 5 works on Node 18; Node 20+ is recommended.
- **Anthropic errors:** confirm `ANTHROPIC_API_KEY` is set and valid.

## Roadmap

- Auth + user accounts
- Subscriptions / usage limits
- Team collections + sharing

---

Have fun collecting your wild worlds 🌿✨
