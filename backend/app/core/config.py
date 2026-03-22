from pydantic_settings import BaseSettings
from typing import List, Optional


class Settings(BaseSettings):
    anthropic_api_key: Optional[str] = None  # None → SDK reads ANTHROPIC_API_KEY from env directly
    database_url: str = "postgresql+asyncpg://tutor:tutor@localhost:5432/tutor"
    upload_dir: str = "/app/uploads"
    cors_origins: str = "http://localhost:3000"
    admin_password: str = "5499"

    @property
    def cors_origins_list(self) -> List[str]:
        return [o.strip() for o in self.cors_origins.split(",")]

    class Config:
        env_file = ".env"


settings = Settings()
