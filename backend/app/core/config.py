from pydantic_settings import BaseSettings
from pydantic import field_validator
from typing import List, Optional


class Settings(BaseSettings):
    anthropic_api_key: Optional[str] = None  # None → SDK reads ANTHROPIC_API_KEY from env directly
    database_url: str = "postgresql+asyncpg://tutor:tutor@localhost:5432/tutor"

    @field_validator("database_url", mode="before")
    @classmethod
    def fix_database_url(cls, v: str) -> str:
        # Railway provides postgres:// or postgresql:// — convert to postgresql+asyncpg://
        v = v.replace("postgres://", "postgresql+asyncpg://")
        v = v.replace("postgresql://", "postgresql+asyncpg://")
        return v
    upload_dir: str = "/app/uploads"
    cors_origins: str = "http://localhost:3000"
    admin_password: str = "5499"

    @property
    def cors_origins_list(self) -> List[str]:
        return [o.strip() for o in self.cors_origins.split(",")]

    class Config:
        env_file = ".env"


settings = Settings()
