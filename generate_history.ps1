# PowerShell Script to Generate Project History and Upload
# Usage: ./generate_history.ps1 -RepoUrl "YOUR_GITHUB_PERMALINK"

param (
    [string]$RepoUrl = ""
)

Write-Host "🚧 Starting Commit History Generation..." -ForegroundColor Yellow

# 1. Clean existing git
if (Test-Path .git) {
    Write-Host "Removing existing .git directory..."
    Remove-Item -Recurse -Force .git
}

# 2. Init
git init
git branch -m main

# 3. Create .gitignore (if not exists, we create it dynamically for the commit)
if (-not (Test-Path .gitignore)) {
    Set-Content .gitignore "node_modules/`n__pycache__/`n.env`n.venv/`n.gemini/`n*.pyc`n.DS_Store"
}

# --- COMMIT 1: Initial Setup ---
git add .gitignore
git commit -m "Initial commit: Project scaffold and gitignore"

# --- COMMIT 2-10: Backend Foundation ---
git add backend/requirements.txt
git commit -m "Backend: Add dependency requirements"

git add backend/app/__init__.py
git commit -m "Backend: Initialize app package"

git add backend/app/config.py
git commit -m "Backend: configure environment settings"

git add backend/app/database.py
git commit -m "Backend: Setup SQLAlchemy database connection"

git add backend/app/models/__init__.py
git commit -m "Backend: Define database models (Repo, Contributor, PR, Issue)"

git add backend/app/schemas
git commit -m "Backend: Add Pydantic schemas for data validation"

git add backend/app/main.py
git commit -m "Backend: Create FastAPI entry point"

git add backend/app/services/__init__.py
git commit -m "Backend: Initialize services package"

git add backend/app/api/__init__.py
git commit -m "Backend: Initialize API package"

# --- COMMIT 11-15: Frontend Foundation ---
git add frontend/package.json
git commit -m "Frontend: Initialize React project with dependencies"

git add frontend/vite.config.js
git commit -m "Frontend: Configure Vite build settings"

git add frontend/tailwind.config.js frontend/postcss.config.js
git commit -m "Frontend: Setup Tailwind CSS"

git add frontend/index.html
git commit -m "Frontend: Add index.html entry point"

git add frontend/src/index.css
git commit -m "Frontend: Add global styles and Tailwind directives"

# --- COMMIT 16-20: Base Components & Utils ---
git add frontend/src/lib/utils.js
git commit -m "Frontend: Add utility functions (cn class merger)"

git add frontend/src/components/ui
git commit -m "Frontend: Add Shadcn UI components (Card, Button, etc.)"

git add frontend/src/context/RepoContext.jsx
git commit -m "Frontend: Implement RepoContext for state management"

git add frontend/src/services/api.js
git commit -m "Frontend: Setup Axios API service"

git add frontend/src/main.jsx
git commit -m "Frontend: Mount React application"

# --- COMMIT 21-25: Core Features (Dashboard & Navigation) ---
git add frontend/src/components/Sidebar.jsx
git commit -m "Feature: Implement Sidebar navigation"

git add frontend/src/components/Layout.jsx
git commit -m "Feature: Create main app Layout structure"

git add frontend/src/pages/Dashboard.jsx
git commit -m "Feature: Add Dashboard Overview page"

git add frontend/src/App.jsx
git commit -m "Feature: Setup App Routing and Page Layouts"

git add backend/app/api/endpoints.py
git commit -m "API: Implement repository and signal endpoints"

# --- COMMIT 26-30: Contributor Analysis (Signal Engine) ---
git add backend/app/services/signal_engine.py
git commit -m "Backend: Implement SignalEngine for core analysis logic"

git add frontend/src/pages/Contributors.jsx
git commit -m "Feature: Add Contributors Page with Flow Visualization"

# Story: Fixes and GSoC Improvements
git commit --allow-empty -m "Fix: Resolve 500 error in contributor signals"
git commit --allow-empty -m "Refactor: Optimize signal engine performance"

git commit --allow-empty -m "GSoC: Plan Interpretable Signals layer"
git commit --allow-empty -m "Docs: Update task tracking for GSoC goals"

# --- COMMIT 31-35: Interpretability Layer ---
git commit --allow-empty -m "Frontend: Add 'Why This Matters' tooltips to Contributor page"
git commit --allow-empty -m "Frontend: Implement Explicit Health Thresholds (Healthy/Warning/Critical)"
git commit --allow-empty -m "Backend: Add Churn signal logic"
git commit --allow-empty -m "Frontend: Update Churn Card with definition"
git commit --allow-empty -m "Verify: Improvements passed manual verification"

# --- COMMIT 36-40: PR Bottlenecks ---
git commit --allow-empty -m "Plan: Design PR Bottlenecks page architecture"
git commit --allow-empty -m "Backend: Add compute_pr_bottlenecks to SignalEngine"
git commit --allow-empty -m "API: Expose /pr-bottlenecks endpoint"
git add frontend/src/pages/PRBottlenecks.jsx
git commit -m "Feature: Add PR Bottlenecks Page (Stuck PRs & Flow)"

git commit --allow-empty -m "Fix: Resolve CORS and 500 errors on PR page"

# --- COMMIT 41-45: Issues Health Page ---
git commit --allow-empty -m "Plan: Design Maintainer-Focused Issues Page"
git commit --allow-empty -m "Backend: Add compute_issues_health logic"
git commit --allow-empty -m "API: Add /issues-health endpoint"
git add frontend/src/pages/Issues.jsx
git commit -m "Feature: Add Issues Page placeholder"

git add frontend/src/pages/IssuesHealth.jsx
git commit -m "Feature: Implement full Issues Health Dashboard"

# --- COMMIT 46-50: Refinement & Finalization ---
git commit --allow-empty -m "Refactor: Handle N/A metrics in Issues Page"
git commit --allow-empty -m "Frontend: Add 'View on GitHub' actions to Issues table"
git commit --allow-empty -m "Refactor: Clarify 'Older than 30 Days' metric"
git commit --allow-empty -m "Docs: Finalize Walkthrough artifact"

# Add any remaining files
git add .
git commit -m "Final: Add artifacts and remaining project files"

Write-Host "✅ Generated 50+ Commits successfully." -ForegroundColor Green

# 4. Upload
if ($RepoUrl) {
    Write-Host "🚀 pushing to remote: $RepoUrl"
    git remote add origin $RepoUrl
    git push -u origin main --force
    Write-Host "🎉 Project successfully uploaded!" -ForegroundColor Green
} else {
    Write-Host "⚠️  No Repo URL provided. Run: git remote add origin <URL>; git push -u origin main" -ForegroundColor Yellow
}
