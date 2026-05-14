import os
import json
import boto3
from functools import lru_cache
from pydantic_settings import BaseSettings


def _load_aws_secrets(secret_name: str) -> dict:
    """Pull secrets from AWS Secrets Manager (used in production)."""
    try:
        client = boto3.client("secretsmanager", region_name=os.getenv("AWS_REGION", "us-east-1"))
        response = client.get_secret_value(SecretId=secret_name)
        return json.loads(response["SecretString"])
    except Exception:
        return {}


class Settings(BaseSettings):
    # App
    app_name: str = "Knowledge Base API"
    debug: bool = False
    cors_origins: str = "http://localhost:3000"

    # Database
    database_url: str = "postgresql://kb_admin:kb_local_password@localhost:5432/knowledge_base"

    # Auth (JWT)
    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60

    # AWS (production)
    aws_region: str = "us-east-1"
    secret_name: str = ""

    # AI
    openai_api_key: str = ""
    anthropic_api_key: str = ""

    # S3
    s3_bucket: str = ""

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

    def get_cors_origins(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",")]


@lru_cache
def get_settings() -> Settings:
    settings = Settings()

    # In production, overlay with values from Secrets Manager
    if settings.secret_name:
        secrets = _load_aws_secrets(settings.secret_name)
        if secrets.get("DB_HOST"):
            db_user = secrets.get("DB_USER", "kb_admin")
            db_pass = secrets.get("DB_PASSWORD", "")
            db_host = secrets.get("DB_HOST", "localhost")
            db_port = secrets.get("DB_PORT", "5432")
            db_name = secrets.get("DB_NAME", "knowledge_base")
            settings.database_url = (
                f"postgresql://{db_user}:{db_pass}@{db_host}:{db_port}/{db_name}"
            )
        if secrets.get("ANTHROPIC_API_KEY"):
            settings.anthropic_api_key = secrets["ANTHROPIC_API_KEY"]
        if secrets.get("OPENAI_API_KEY"):
            settings.openai_api_key = secrets["OPENAI_API_KEY"]
        if secrets.get("S3_BUCKET"):
            settings.s3_bucket = secrets["S3_BUCKET"]

    return settings
