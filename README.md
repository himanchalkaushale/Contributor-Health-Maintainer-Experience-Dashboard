# OpenSourceHealth

> AI-powered contributor analytics dashboard for GitHub repository maintainers. Real-time insights, deep-link analytics, and Gemini-powered nudges to keep your open-source projects healthy.

[![Built with Gemini](https://img.shields.io/badge/Built%20with-Gemini-4285F4?logo=google)](https://ai.google.dev/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev/)
[![Python](https://img.shields.io/badge/Python-3.10+-3776AB?logo=python)](https://www.python.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## The Problem

Open-source maintainers face **notification fatigue**. With dozens of stuck PRs and hundreds of issues, they spend hours:

- Writing the same follow-up messages repeatedly
- Manually tracking which PRs need attention
- Guessing at project health trends
- Losing first-time contributors to unanswered issues

**OpenSourceHealth** solves this with AI-powered automation and a unified analytics layer built on a rolling 365-day activity window.

---

## Features

### AI-Powered Smart Nudges (Gemini)

One-click generation of polite, context-aware follow-up messages for stuck PRs. Gemini analyzes the PR context (age, review state, author) and drafts a maintainer-ready message you can copy straight to GitHub.

### Unified Contributor Analytics

A single `contribution_events` table powers every analytics view, recording PRs, reviews, issues, comments, and commits over a rolling 365-day window. This unlocks:

- **Activity Timeline** — weekly/monthly event buckets by type
- **Contributor Leaderboard** — PRs merged, reviews given, comments, commits, tenure
- **Reviewer Load** — per-reviewer count, median latency, share of total
- **Newcomer Funnel** — first-PR response time, merge rate, retention
- **Contributor Health** — new / returning / dormant / churned bucketing

### PR Review Health

A period-selectable dashboard (`days` ∈ {30, 90, 180, 365}) with:

- KPIs: time-to-merge, review cycle time, comment density (with prior-window deltas)
- Weekly trend series (Recharts)
- Wait-time distribution buckets
- Review-stage funnel (Unreviewed → In Review → Approved → Merged)
- Stale-PR alerts with GitHub deep-links to `/files` and `#reviews`
- Enriched attention queue with nudge fields

### Issues Analytics

- **Triage Load** — who responds fastest and most often
- **Workload Balance** — assigned-issue distribution + rebalance suggestions
- **Issue Trends** — weekly median response times with label categories
- **First-Timer Queue** — prioritized issues from new contributors needing response
- **Zombie Issues** — responded-then-abandoned issues
- **Category Breakdown** — open issues grouped by label (bug / enhancement / question)

### Real-Time Sync with Progress Tracking

- Async background processing for large repos (handles 2000+ items)
- Live progress bar with estimated time remaining
- Rolling-window sync (reviews, comments, and events collected incrementally)

---

## Quick Start

### Prerequisites

- Python 3.10+
- Node.js 18+
- GitHub Personal Access Token ([create one](https://github.com/settings/tokens))
- Google AI Studio API Key ([get one](https://aistudio.google.com/app/apikey)) — optional, enables AI nudges

### Installation

1. **Clone the repository**

```bash
git clone https://github.com/himanchalkaushale/Contributor-Health-Maintainer-Experience-Dashboard.git
cd Contributor-Health-Maintainer-Experience-Dashboard
```

2. **Backend setup**

```bash
cd backend
python -m venv .venv
# Windows: .\.venv\Scripts\activate   |   macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env: add GITHUB_TOKEN and GEMINI_API_KEY
```

3. **Frontend setup**

```bash
cd ../frontend
npm install
```

4. **Run the application**

Use the unified launcher (starts backend + frontend together):

```bash
python run.py
```

Or run each separately:

```bash
# Terminal 1 — Backend
cd backend && python -m uvicorn app.main:app --reload --port 8000

# Terminal 2 — Frontend
cd frontend && npm run dev
```

5. **Open your browser** at `http://localhost:5173`

### Schema note

The analytics feature adds new tables (`contribution_events`, `reviews`, `comments`, `labels`) and extends the `issues` table with assignee/responder/label columns. On startup the backend runs an **additive migration** (`app/migrations.py`) that `ALTER`s existing tables in place, so existing SQLite databases are upgraded without data loss.

If you want a fresh backfill of all events, delete the SQLite database and re-sync:

```bash
# from backend/
rm sql_app.db sql_app.db-shm sql_app.db-wal   # PowerShell: Remove-Item sql_app.db*
```

---

## Demo

### Adding a Repository

1. Enter `owner/repo` in the top header (e.g., `octocat/Hello-World`)
2. Click sync → watch real-time progress with time estimates
3. Explore the dashboard once sync completes

### Using Smart Nudge

1. Navigate to **Bottlenecks** or **PR Review Health**
2. Find a stuck PR in the attention queue
3. Click **Draft Nudge**
4. Gemini generates a ready-to-send message
5. Copy and paste into GitHub

### Deep-link navigation

Summary cards on the Overview page are clickable — they jump straight to the relevant filtered view (e.g., "Unanswered issues" → Issues page triage queue).

---

## Architecture

### Backend (FastAPI)

```
backend/app/
├── api/endpoints.py      # 20+ REST endpoints
├── services/
│   ├── github_client.py  # async GitHub API fetchers (PRs, reviews, comments, labels, commits)
│   ├── data_collector.py # phased sync: PRs → issues → commits, with event recording
│   ├── signal_engine.py  # 1700+ line analytics engine (18 compute_* functions)
│   └── gemini_service.py # Gemini Pro nudge generation
├── models/               # SQLAlchemy models (Repository, PR, Issue, Review, Comment, Label, ContributionEvent)
├── schemas/             # Pydantic response models
├── migrations.py        # additive SQLite startup migration
└── main.py              # FastAPI app + lifespan startup
```

- **Async GitHub API integration** — non-blocking data fetching with semaphore-controlled concurrency
- **SQLite with WAL mode** — concurrent reads during long syncs
- **Background task queue** — handles large repos without blocking the UI
- **Batched queries** — N+1 fixes via grouped lookups (`selectinload` / `joinedload` / `func.min`)

### Frontend (React + Vite)

```
frontend/src/
├── pages/               # Overview, PRReviewHealth, IssuesHealth, Contributors, PRBottlenecks, Bottlenecks
├── components/          # SummaryCard, TopHeader, charts/ (ReviewTrend, WaitDistribution, ReviewFunnel)
├── context/RepoContext  # centralized repo + sync state with live relative-time ticking
├── services/api.js      # typed analytics API client
└── lib/                 # utils (formatDuration, relativeTime) + scroll helpers
```

- **React 19** with React Compiler
- **Recharts 3** interactive visualizations
- **TailwindCSS 4** + **GSAP** premium UI with smooth animations
- **Lucide** icon system
- **Context API** centralized state management

### Key Technical Decisions

- **Unified event table** — one `contribution_events` table powers timeline, leaderboard, reviewer-load, and newcomer analytics (avoids scattered per-metric queries)
- **Rolling 365-day window** — `days` param clamped to 1–365 on all analytics endpoints to prevent unbounded full-history scans
- **Batched review lookups** — `_earliest_review_at_by_pr` / `_latest_review_state_by_pr` replace per-PR `ORDER BY` queries with grouped fetches
- **Additive migration** — `ALTER TABLE` on startup instead of destructive recreate

---

## API Reference

All endpoints are prefixed with `/api`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/repositories/sync` | Sync a repository (async background) |
| `GET` | `/repositories` | List synced repositories |
| `GET` | `/repositories/{id}/overview` | Overview KPIs + trend |
| `GET` | `/repositories/{id}/signals` | Health signals |
| `GET` | `/repositories/{id}/contributors-health` | Contributor buckets |
| `GET` | `/repositories/{id}/activity-timeline` | Event timeline (`?days=`) |
| `GET` | `/repositories/{id}/leaderboard` | Contributor leaderboard (`?days=`) |
| `GET` | `/repositories/{id}/reviewer-load` | Reviewer load (`?days=`) |
| `GET` | `/repositories/{id}/newcomer-funnel` | Newcomer retention (`?days=`) |
| `GET` | `/repositories/{id}/pr-bottlenecks` | Stuck PR table |
| `GET` | `/health/pr-review?repo=owner/name&days=90` | PR review health (selectable window) |
| `GET` | `/repositories/{id}/issues-health` | Issues summary |
| `GET` | `/repositories/{id}/issue-triage-load` | Triage load (`?days=`) |
| `GET` | `/repositories/{id}/issue-workload-balance` | Workload distribution |
| `GET` | `/repositories/{id}/issue-trends` | Response trends (`?days=`) |
| `GET` | `/repositories/{id}/first-timer-issue-queue` | First-timer priority queue |
| `GET` | `/repositories/{id}/zombie-issues` | Abandoned issues |
| `GET` | `/repositories/{id}/issue-category-breakdown` | Label categories |
| `POST` | `/nudge/generate` | Generate Gemini nudge for a PR |

Interactive docs available at `http://localhost:8000/docs` (Swagger UI).

---

## Deployment

### Option 1: Render.com (Recommended)

```bash
git push origin main
```

1. Go to [render.com](https://render.com)
2. New Blueprint → select your repo
3. Add environment variables (`GITHUB_TOKEN`, `GEMINI_API_KEY`)
4. Deploy

### Option 2: Railway.app

1. Go to [railway.app](https://railway.app)
2. Deploy from GitHub → select repo
3. Add environment variables
4. Done

See [deployment_guide.md](./deployment_guide.md) for detailed instructions.

---

## Tech Stack

**Backend** — FastAPI 0.115 · SQLAlchemy 2.0 · Google Generative AI (Gemini) · Requests · SQLite (WAL)

**Frontend** — React 19 · Vite 7 · Recharts 3 · TailwindCSS 4 · GSAP · Lucide · Axios

**Tooling** — ESLint 9 · React Compiler · PostCSS

---

## Contributing

Contributions are welcome!

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

Please run `npm --prefix frontend run lint` and the backend import check before submitting:

```bash
npm --prefix frontend run lint
cd backend && python -c "import app.main; print('IMPORT OK')"
```

---

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

## Author

**Himanchal Kaushale**
- GitHub: [@himanchalkaushale](https://github.com/himanchalkaushale)

---

## Acknowledgments

- Google Gemini Team for the AI capabilities
- FastAPI and React communities
- All open-source maintainers who inspired this project

---

<div align="center">
Made with care for the open-source community
</div>
