import sys
import os
from datetime import datetime, timedelta

# Add backend directory to sys.path
sys.path.append(os.path.join(os.getcwd(), 'backend'))

# Mock env var for config
os.environ["GITHUB_TOKEN"] = "mock_token"
os.environ["DATABASE_URL"] = f"sqlite:///{os.path.join(os.getcwd(), 'backend', 'sql_app.db')}"

from app.database import SessionLocal
from app.models import Repository, PullRequest, Contributor

def inspect_first_time_stuck_prs(repo_id=1):
    db = SessionLocal()
    try:
        print(f"--- Developer-Only Inspection: First-Time Contributors Stuck (Repo ID: {repo_id}) ---")
        
        repo = db.query(Repository).get(repo_id)
        if not repo:
            print("Repository not found.")
            return

        # 1. Identify First-Time Authors (First PR Date)
        all_prs = db.query(PullRequest).filter(PullRequest.repository_id == repo_id).all()
        author_first_pr_date = {} # {login: datetime}
        
        for pr in all_prs:
            if not pr.author: continue
            login = pr.author.login
            # Ensure filtering matches: exclude issues if strictly PRs (model is PullRequest, so yes)
            if login not in author_first_pr_date or pr.created_at < author_first_pr_date[login]:
                author_first_pr_date[login] = pr.created_at

        # 2. Filter for Stuck First-Time PRs
        # Criteria: Open, > 7 days old, IS the author's first PR
        
        now = datetime.utcnow()
        seven_days_ago = now - timedelta(days=7)
        
        stuck_prs = []
        
        for pr in all_prs:
            if not pr.author: continue
            login = pr.author.login
            
            # Is this the author's first PR?
            if pr.created_at == author_first_pr_date.get(login):
                # Is it stuck? (Open and older than 7 days)
                # Note: "Waiting > 7 days" usually implies no maintainer response, 
                # but the prompt metric "New Contributors Stuck" usually simplifies to "Status: Open & Age > 7d" 
                # or checks review status. The prompt SQL says: created_at < NOW - 7 days AND state = 'open'.
                if pr.state == 'open' and pr.created_at < seven_days_ago:
                    days_waiting = (now - pr.created_at).days
                    github_url = f"https://github.com/{repo.owner}/{repo.name}/pull/{pr.number}"
                    
                    stuck_prs.append({
                        "number": pr.number,
                        "title": pr.title,
                        "author": login,
                        "days_waiting": days_waiting,
                        "url": github_url
                    })
        
        # 3. Sort and Print
        stuck_prs.sort(key=lambda x: x['days_waiting'], reverse=True)
        
        print(f"\nFound {len(stuck_prs)} stuck first-time PRs:\n")
        print(f"{'PR #':<8} {'Author':<15} {'Days':<8} {'URL'}")
        print("-" * 80)
        
        for p in stuck_prs:
            print(f"{p['number']:<8} {p['author']:<15} {p['days_waiting']:<8} {p['url']}")
            
        print("-" * 80)
        print("End of Inspection.")

    except Exception as e:
        print(f"Error during inspection: {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    inspect_first_time_stuck_prs()
