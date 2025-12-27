# Contributor Health & Maintainer Experience Dashboard

A signal-driven dashboard for open-source maintainers to identify early warning signs of contributor friction. Built for GSoC 2025.

![Dashboard Preview](https://via.placeholder.com/800x400?text=Dashboard+Preview)

## Features

- **Signal-Driven**: Focuses on actionable health signals, not raw metrics.
- **Privacy-First**: Self-hosted, local database, no external analyics services.
- **Real-time**: Syncs directly with GitHub API.

### Implemented Signals

1. **Stale Pull Requests**: PRs waiting for review > 7 days (Warning) or > 14 days (Critical).
2. **Unanswered Issues**: Issues with no maintainer response > 7 days.
3. **Repository Activity**: Overview of open PR and Issue volume.

## Tech Stack

- **Backend**: Python 3.11+, FastAPI, SQLAlchemy, SQLite
- **Frontend**: React (Vite), JavaScript, Tailwind CSS, GSAP, Recharts
- **API**: GitHub REST API

## Setup Instructions

### Prerequisites
- Python 3.11+
- Node.js 18+
- GitHub Personal Access Token (Classic or Fine-grained)

### 1. Backend Setup

```bash
cd backend
python -m venv venv
# Windows:
.\venv\Scripts\activate
# Mac/Linux:
source venv/bin/activate

pip install -r requirements.txt
```

**Configuration**:
Copy `.env.example` to `.env` and add your GitHub token:
```bash
GITHUB_TOKEN=ghp_your_token_here
```

**Run Server**:
```bash
# From backend directory
python -m uvicorn app.main:app --reload --port 8000
```
API will be available at `http://localhost:8000/api`.
Docs at `http://localhost:8000/docs`.

### 2. Frontend Setup

```bash
cd frontend
npm install
npm run dev
```
Dashboard will be available at `http://localhost:5173`.

## Architecture

```
GitHub API -> Data Collector -> SQLite DB -> Signal Engine -> FastAPI -> React UI
```

The system uses a **Signal-Driven Architecture**:
1. **Data Collector**: Fetches raw data from GitHub and stores it normalized in SQLite.
2. **Signal Engine**: Analyzes the stored data to compute health signals with severity (Healthy/Warning/Critical).
3. **Frontend**: Simply renders the computed signals without complex business logic.

## Usage

1. Open the dashboard at `http://localhost:5173`.
2. Enter a repository owner and name (e.g., `facebook/react`) to sync.
3. View the health signals and identify bottlenecks.
