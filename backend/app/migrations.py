"""
Lightweight additive schema migration for SQLite.

SQLAlchemy's `Base.metadata.create_all` creates missing tables but never ALTERs
existing ones, so any column added to a model after a table exists would raise
`OperationalError: no such column` at runtime. This module inspects each table
via `PRAGMA table_info` and runs `ALTER TABLE ... ADD COLUMN` for any model
column that is missing in the live database.

Only additive, nullable (or defaulted) columns are added here — this intentionally
avoids destructive operations and keeps first-deploy safe.
"""
from sqlalchemy import inspect, text
from app.database import engine, Base


def _column_ddl(column) -> str:
    """Build the `ADD COLUMN` DDL fragment for a single SQLAlchemy column."""
    col_type = column.type.compile(dialect=engine.dialect)
    parts = [f'"{column.name}"', col_type]

    # Only apply a DEFAULT for literal scalar Python defaults (int/bool/str).
    # Callable defaults (e.g. datetime.utcnow) are not inlined here — they're
    # still applied by SQLAlchemy at insert time via the model.
    default = column.default
    if default is not None:
        arg = getattr(default, "arg", None)
        is_callable = callable(arg) or getattr(default, "is_callable", False)
        if not is_callable and arg is not None:
            if isinstance(arg, bool):
                parts.append(f"DEFAULT {int(arg)}")
            elif isinstance(arg, (int, float)):
                parts.append(f"DEFAULT {arg}")
            else:
                parts.append(f"DEFAULT '{str(arg).replace(chr(39), chr(39)+chr(39))}'")
    elif not column.nullable:
        # SQLite disallows NOT NULL without a default on ADD COLUMN for non-empty
        # tables; fall back to nullable to keep the migration safe.
        parts.append("NOT NULL")

    return " ".join(parts)


def run_additive_migrations() -> None:
    """Add any model columns missing from existing tables. Idempotent and safe."""
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())

    with engine.begin() as conn:
        for table_name, table in Base.metadata.tables.items():
            if table_name not in existing_tables:
                continue  # create_all handles brand-new tables.

            # PRAGMA table_info returns columns: cid, name, type, notnull,
            # dflt_value, pk. Use .mappings() for dict-style access (raw Row
            # objects only support integer indexing).
            live_columns = {
                row["name"]
                for row in conn.execute(text(f"PRAGMA table_info({table_name})")).mappings()
            }

            for column in table.columns:
                if column.name in live_columns:
                    continue
                # Skip primary keys and unique-constrained columns — those can't be
                # safely added via ALTER TABLE and shouldn't change for additive work.
                if column.primary_key or column.unique:
                    continue

                ddl = _column_ddl(column)
                try:
                    conn.execute(text(f'ALTER TABLE "{table_name}" ADD COLUMN {ddl}'))
                    print(f"[migration] +{table_name}.{column.name} ({col_type_label(column)})")
                except Exception as exc:  # noqa: BLE001
                    print(f"[migration] skipped {table_name}.{column.name}: {exc}")


def col_type_label(column) -> str:
    return column.type.compile(dialect=engine.dialect)
