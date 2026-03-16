from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    # LLM
    llm_provider: str = "ollama"
    ollama_base_url: str = "http://llm:11434"
    ollama_model: str = "llama3.1:70b"
    ollama_api_key: Optional[str] = None
    anthropic_api_key: Optional[str] = None

    # Database
    database_url: str = "postgresql+asyncpg://vantax:password@db:5432/vantax"
    database_url_sync: str = "postgresql://vantax:password@db:5432/vantax"

    # Redis
    redis_url: str = "redis://redis:6379/0"

    # MinIO
    minio_endpoint: str = "minio:9000"
    minio_access_key: str = "vantax"
    minio_secret_key: str = ""
    minio_bucket_uploads: str = "vantax-uploads"
    minio_bucket_reports: str = "vantax-reports"

    # Licence
    licence_key: Optional[str] = None
    licence_server_url: str = "https://licence.dqagent.vantax.co.za"

    # Notifications
    resend_api_key: Optional[str] = None
    teams_webhook_url: Optional[str] = None

    # Auth
    clerk_secret_key: Optional[str] = None
    auth_mode: str = "local"

    # Observability
    sentry_dsn: Optional[str] = None

    model_config = {"env_file": ".env", "case_sensitive": False, "extra": "ignore"}


settings = Settings()
