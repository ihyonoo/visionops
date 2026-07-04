from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import datasets, inference, projects, splits, training
from app.core.config import settings
from app.db import Base, engine

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


@app.on_event("startup")
def on_startup() -> None:
    Base.metadata.create_all(bind=engine)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
