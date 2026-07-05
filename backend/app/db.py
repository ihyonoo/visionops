from collections.abc import Generator
from pathlib import Path
import re
import unicodedata

from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy import inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import settings


def _ensure_sqlite_parent(database_url: str) -> None:
    url = make_url(database_url)
    if not url.drivername.startswith("sqlite"):
        return
    database = url.database
    if not database or database == ":memory:":
        return
    Path(database).parent.mkdir(parents=True, exist_ok=True)


_ensure_sqlite_parent(settings.database_url)

engine = create_engine(settings.database_url, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def ensure_schema_compatibility() -> None:
    url = make_url(settings.database_url)
    if not url.drivername.startswith("sqlite"):
        return

    inspector = inspect(engine)
    if not inspector.has_table("projects"):
        return

    statements: list[str] = []
    project_columns = {column["name"] for column in inspector.get_columns("projects")}
    should_backfill_project_slugs = "slug" not in project_columns
    if should_backfill_project_slugs:
        statements.append("ALTER TABLE projects ADD COLUMN slug VARCHAR NOT NULL DEFAULT ''")

    if inspector.has_table("dataset_splits"):
        split_columns = {column["name"] for column in inspector.get_columns("dataset_splits")}
        if "test_ratio" not in split_columns:
            statements.append("ALTER TABLE dataset_splits ADD COLUMN test_ratio FLOAT NOT NULL DEFAULT 0.0")
        if "test_count" not in split_columns:
            statements.append("ALTER TABLE dataset_splits ADD COLUMN test_count INTEGER NOT NULL DEFAULT 0")

    if not statements and not should_backfill_project_slugs:
        return

    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))
        if should_backfill_project_slugs:
            used_slugs: set[str] = set()
            rows = connection.execute(text("SELECT id, name FROM projects ORDER BY created_at, id")).mappings()
            for row in rows:
                base_slug = _project_slug_from_name(str(row["name"]))
                slug = base_slug
                suffix = 2
                while slug in used_slugs:
                    slug = f"{base_slug}-{suffix}"
                    suffix += 1
                used_slugs.add(slug)
                connection.execute(
                    text("UPDATE projects SET slug = :slug WHERE id = :project_id"),
                    {"project_id": row["id"], "slug": slug},
                )


def _project_slug_from_name(name: str) -> str:
    normalized = unicodedata.normalize("NFKC", name).strip().lower()
    slug = re.sub(r"[^\w\s-]", "", normalized, flags=re.UNICODE)
    slug = re.sub(r"[\s_]+", "-", slug, flags=re.UNICODE)
    slug = re.sub(r"-+", "-", slug).strip("-")
    return slug or "project"


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
