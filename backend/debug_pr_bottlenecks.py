import sys
import os

# Add backend directory to sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import SessionLocal
from app.services.signal_engine import SignalEngine

def test_pr_bottlenecks():
    db = SessionLocal()
    try:
        engine = SignalEngine(db)
        repo_id = 1
        print(f"Testing compute_pr_bottlenecks for repo_id={repo_id}...")
        data = engine.compute_pr_bottlenecks(repo_id)
        if data:
            print("SUCCESS: Data retrieved")
            print(data.keys())
        else:
            print("FAILURE: returned None")
    except Exception as e:
        print(f"CRITICAL EXCEPTION: {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    test_pr_bottlenecks()
