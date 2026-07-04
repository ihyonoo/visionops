from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "sqlite:///./vision_ops_data/app.db"
    artifact_root: Path = Path("./vision_ops_data")
    cors_origins: list[str] = [
        "http://127.0.0.1:5173",
        "http://localhost:5173",
    ]

    model_config = SettingsConfigDict(env_prefix="VISIONOPS_")


settings = Settings()
