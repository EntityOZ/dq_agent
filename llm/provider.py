import logging
import os

from langchain_anthropic import ChatAnthropic
from langchain_openai import ChatOpenAI
from langchain_ollama import ChatOllama

logger = logging.getLogger("meridian.llm")


def get_llm():
    provider = os.getenv("LLM_PROVIDER", "ollama")

    if provider == "ollama":
        # Fully local — default for production customer deployments
        return ChatOllama(
            base_url=os.getenv("OLLAMA_BASE_URL", "http://llm:11434"),
            model=os.getenv("OLLAMA_MODEL", "llama3.2:3b-instruct-q4_K_M"),
            temperature=0.1,
            num_predict=8192,
            format="json",
        )

    if provider == "ollama_cloud":
        # Ollama Cloud API — use dev key for local dev and CI
        return ChatOpenAI(
            base_url=os.getenv("OLLAMA_BASE_URL", "https://ollama.com/api/v1"),
            api_key=os.getenv("OLLAMA_API_KEY"),
            model=os.getenv("OLLAMA_MODEL", "llama3.1:70b"),
            temperature=0.1,
            timeout=120.0,
            max_retries=2,
        )

    if provider == "anthropic":
        # For customers who have approved external API usage
        return ChatAnthropic(
            model="claude-sonnet-4-6",
            api_key=os.getenv("ANTHROPIC_API_KEY"),
            temperature=0.1,
            timeout=120.0,
            max_retries=2,
        )

    raise ValueError(f"Unknown LLM_PROVIDER: {provider}")


def test_llm_connection() -> bool:
    """Call this on startup to verify the LLM is reachable. Returns True if ok."""
    try:
        llm = get_llm()
        response = llm.invoke("Reply with only the word READY.")
        return "READY" in response.content.upper()
    except Exception as e:
        logger.warning(f"LLM connection test failed: {e}")
        return False
