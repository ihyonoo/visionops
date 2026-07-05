from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import datasets, inference, notification_settings, projects, runtime, splits, training
from app.core.config import settings
from app.db import Base, engine, ensure_schema_compatibility

app = FastAPI(title="VisionOps API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(projects.router)
app.include_router(datasets.router)
app.include_router(splits.router)
app.include_router(training.router)
app.include_router(inference.router)
app.include_router(runtime.router)
app.include_router(notification_settings.router)


@app.on_event("startup")
def on_startup() -> None:
    Base.metadata.create_all(bind=engine)
    ensure_schema_compatibility()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
