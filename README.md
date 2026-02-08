# 🏥 OpenSourceHealth

> AI-powered analytics dashboard for GitHub repository maintainers. Real-time insights + Gemini-powered nudges to keep your open-source projects healthy.

[![Built with Gemini](https://img.shields.io/badge/Built%20with-Gemini%20Pro-4285F4?logo=google)](https://ai.google.dev/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)](https://react.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## 🎯 The Problem

Open-source maintainers face **notification fatigue**. With 50+ stuck PRs and hundreds of issues, they spend hours:
- Writing the same follow-up messages repeatedly
- Manually tracking which PRs need attention
- Guessing at project health trends

**OpenSourceHealth** solves this with AI-powered automation and real-time analytics.

---

## ✨ Features

### 🤖 **AI-Powered Smart Nudges** (Gemini Pro)
One-click generation of polite, context-aware follow-up messages for stuck PRs.

```python
# Example: Gemini analyzes PR context and generates:
"Hi @contributor, thanks for the PR! We noticed the build failed on CI. 
Do you need any help debugging the test suite?"
```

**Impact**: Saves 2+ hours/week per repository.

### 📊 **Real-Time Sync with Progress Tracking**
- Async background processing for large repos (handles `supabase/supabase` with 2000+ items)
- Live progress bar with estimated time remaining
- Calculates sync speed (items/sec) for accurate estimates

### 📈 **Interactive Activity Trends**
Beautiful charts (powered by Recharts) showing:
- PR vs Issue velocity over time
- Contributor activity patterns
- Health trend analysis with AI-generated insights

### 🎯 **Actionable Dashboards**
- **Stuck PRs**: Prioritized table of PRs needing attention
- **Contributor Health**: Track new, returning, and churned contributors
- **Issue Triage**: Unanswered issues sorted by urgency
- **PR Review Health**: Identify bottlenecks in your review process

---

## 🚀 Quick Start

### Prerequisites
- Python 3.10+
- Node.js 18+
- GitHub Personal Access Token ([Create one](https://github.com/settings/tokens))
- Google AI Studio API Key ([Get one](https://aistudio.google.com/app/apikey))

### Installation

1. **Clone the repository**
```bash
git clone https://github.com/himanchalkaushale/Contributor-Health-Maintainer-Experience-Dashboard.git
cd Contributor-Health-Maintainer-Experience-Dashboard
```

2. **Backend Setup**
```bash
cd backend
pip install -r requirements.txt
cp .env.example .env
# Edit .env and add your GITHUB_TOKEN and GEMINI_API_KEY
```

3. **Frontend Setup**
```bash
cd ../frontend
npm install
```

4. **Run the Application**

Terminal 1 (Backend):
```bash
cd backend
python -m uvicorn app.main:app --reload --port 8000
```

Terminal 2 (Frontend):
```bash
cd frontend
npm run dev
```

5. **Open your browser**
```
http://localhost:5173
```

---

## 🎬 Demo

### Adding a Repository
1. Enter `owner/repo` in the top header (e.g., `octocat/Hello-World`)
2. Click sync → Watch real-time progress with time estimates
3. Explore the dashboard once sync completes

### Using Smart Nudge
1. Navigate to **Bottlenecks** page
2. Find a stuck PR in the table
3. Click **✨ Draft Nudge**
4. Gemini generates a ready-to-send message
5. Copy and paste into GitHub!

---

## 🏗️ Architecture

### Backend (FastAPI)
- **Async GitHub API Integration**: Non-blocking data fetching
- **SQLite with WAL Mode**: Concurrent reads during long syncs
- **Background Task Queue**: Handles large repos without blocking UI
- **Gemini Pro Integration**: Context-aware AI message generation

### Frontend (React + Vite)
- **Real-time Polling**: Live sync status updates every 2 seconds
- **Recharts**: Interactive data visualizations
- **TailwindCSS + GSAP**: Premium UI with smooth animations
- **Context API**: Centralized state management

### Key Technical Decisions
- **`requests` over `httpx`**: Solved SSL/environment issues in production
- **WAL Mode**: Prevents database locking during large syncs
- **Progress Estimation**: Real-time items/sec calculation for accurate ETAs

---

## 🌐 Deployment

### Option 1: Render.com (Recommended)
```bash
# Push to GitHub
git push origin main

# Deploy on Render
1. Go to render.com
2. New Blueprint → Select your repo
3. Add environment variables (GITHUB_TOKEN, GEMINI_API_KEY)
4. Deploy!
```

### Option 2: Railway.app
```bash
# One-click deploy
1. Go to railway.app
2. Deploy from GitHub → Select repo
3. Add environment variables
4. Done in 2 minutes!
```

See [deployment_guide.md](./deployment_guide.md) for detailed instructions.

---

## 🧪 Tech Stack

**Backend:**
- FastAPI 0.115
- SQLAlchemy 2.0
- Google Generative AI (Gemini Pro)
- Requests (GitHub API)

**Frontend:**
- React 18
- Vite
- Recharts
- TailwindCSS
- GSAP (animations)

**Database:**
- SQLite (with WAL mode for concurrency)

---

## 📊 Project Stats

- **20 files changed** in latest release
- **746 insertions** of production-ready code
- **Handles repos with 2000+ items** (tested on `supabase/supabase`)
- **Saves 2+ hours/week** per repository

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🏆 Built for Gemini 3 Hackathon

This project showcases **Gemini Pro's** ability to go beyond summarization and provide **actionable AI assistance** for real-world developer workflows.

**Key Innovation**: Context-aware prompt engineering that generates maintainer-ready communication, saving hours of manual work.

---

## 👨‍💻 Author

**Himanchal Kaushale**
- GitHub: [@himanchalkaushale](https://github.com/himanchalkaushale)

---

## 🙏 Acknowledgments

- Google Gemini Team for the amazing AI capabilities
- FastAPI and React communities
- All open-source maintainers who inspired this project

---

<div align="center">
Made with ❤️ for the open-source community
</div>
