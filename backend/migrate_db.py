from app.database import engine
from sqlalchemy import text

def migrate():
    with engine.connect() as connection:
        print("Migrating database...")
        try:
            connection.execute(text("ALTER TABLE repositories ADD COLUMN sync_status VARCHAR DEFAULT 'completed'"))
            print("Added sync_status")
        except Exception as e:
            print(f"sync_status might exist: {e}")

        try:
            connection.execute(text("ALTER TABLE repositories ADD COLUMN sync_item_count INTEGER DEFAULT 0"))
            print("Added sync_item_count")
        except Exception as e:
            print(f"sync_item_count might exist: {e}")

        try:
            connection.execute(text("ALTER TABLE repositories ADD COLUMN sync_total_items INTEGER DEFAULT 0"))
            print("Added sync_total_items")
        except Exception as e:
            print(f"sync_total_items might exist: {e}")
            
    print("Migration complete.")

if __name__ == "__main__":
    migrate()
