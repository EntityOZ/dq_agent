import logging
import os
from typing import Any

from langchain_anthropic import ChatAnthropic
from langchain_openai import ChatOpenAI
from langchain_ollama import ChatOllama

logger = logging.getLogger("meridian.llm")

# Sentinel returned when the configured provider is unreachable at startup
_UNAVAILABLE_PROVIDER = None


def get_llm() -> Any:
    """Return a LangChain chat model for the configured LLM_PROVIDER.

    Raises ValueError for unknown providers.
    Returns a configured model instance for valid providers — callers should
    handle connection errors gracefully at invocation time.
    """
    provider = os.getenv("LLM_PROVIDER", "ollama")

    if provider == "ollama":
        # Fully local — default for Tier 2 customer deployments
        return ChatOllama(
            base_url=os.getenv("OLLAMA_BASE_URL", "http://ollama:11434"),
            model=os.getenv("OLLAMA_MODEL", "qwen3.5:9b-instruct"),
            temperature=0.1,
            num_predict=8192,
            format="json",
        )

    if provider == "ollama_cloud":
        # Ollama Cloud API — dev and CI usage
        return ChatOllama(
            base_url=os.getenv("OLLAMA_BASE_URL", "https://ollama.com/api"),
            model=os.getenv("OLLAMA_MODEL", "gemma4:31b-cloud"),
            headers={"Authorization": f"Bearer {os.getenv('OLLAMA_API_KEY', '')}"},
            temperature=0.1,
            num_predict=8192,
        )

    if provider == "anthropic":
        # Tier 1 — Anthropic API (customers who have approved external API usage)
        return ChatAnthropic(
            model=os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6"),
            api_key=os.getenv("ANTHROPIC_API_KEY"),
            temperature=0.1,
            timeout=120.0,
            max_retries=2,
        )

    if provider == "azure_openai":
        # Tier 1/3 — Azure OpenAI endpoint
        from langchain_openai import AzureChatOpenAI

        return AzureChatOpenAI(
            azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT", ""),
            api_key=os.getenv("AZURE_OPENAI_API_KEY", ""),
            azure_deployment=os.getenv("AZURE_OPENAI_DEPLOYMENT", "gpt-4o"),
            api_version=os.getenv("AZURE_OPENAI_API_VERSION", "2024-08-01-preview"),
            temperature=0.1,
            timeout=120.0,
            max_retries=2,
        )

    if provider == "custom":
        # Tier 3 — BYOLLM: any OpenAI-compatible endpoint
        return ChatOpenAI(
            base_url=os.getenv("CUSTOM_LLM_BASE_URL", ""),
            api_key=os.getenv("CUSTOM_LLM_API_KEY", "not-required"),
            model=os.getenv("CUSTOM_LLM_MODEL", "default"),
            temperature=0.1,
            timeout=120.0,
            max_retries=2,
        )

    raise ValueError(f"Unknown LLM_PROVIDER: {provider!r}")


def test_llm_connection() -> bool:
    """Verify the configured LLM is reachable. Returns True if healthy."""
    try:
        llm = get_llm()
        response = llm.invoke("Reply with only the word READY.")
        return "READY" in response.content.upper()
    except Exception as e:
        logger.warning("LLM connection test failed: %s", e)
        return False


def get_llm_safe() -> Any | None:
    """Like get_llm() but returns None instead of raising on config errors.

    Use this when AI features should degrade gracefully rather than crash
    the application (e.g. agent orchestration, NLP service).
    """
    try:
        return get_llm()
    except Exception as e:
        logger.error("LLM provider unavailable: %s", e)
        return None


AI_UNAVAILABLE_MSG = (
    "AI features are temporarily unavailable. "
    "All other Meridian features continue to work normally."
)
