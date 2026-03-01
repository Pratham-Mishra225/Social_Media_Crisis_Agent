import os
import time
import litellm
from crewai import Agent, Crew, Process, Task, LLM
from crewai.project import CrewBase, agent, crew, task
from crewai.agents.agent_builder.base_agent import BaseAgent
from typing import List
from dotenv import load_dotenv

from socialmedia_crisisagent.tools.feed_reader import FeedReaderTool
from socialmedia_crisisagent.tools.response_logger import ResponseLoggerTool

load_dotenv()


# ─── Provider definitions ──────────────────────────────────────────
def _build_providers() -> list:
    """Build ordered list of available LLM providers from env vars.
    
    NOTE: OpenAI is validated at startup because CrewAI uses its own
    native OpenAI SDK (not litellm), so our litellm fallback wrapper
    can't intercept OpenAI errors. Gemini/Groq go through litellm and
    are handled by the fallback wrapper mid-run.
    """
    providers = []

    # ── OpenAI: Validate key upfront (CrewAI uses native SDK) ──
    key = os.getenv("OPENAI_API_KEY")
    if key and not key.startswith("#"):
        try:
            import openai
            client = openai.OpenAI(api_key=key)
            client.models.list()  # Tiny API call to validate key
            providers.append({
                "name": "OpenAI GPT-4o-mini",
                "model": "openai/gpt-4o-mini",
                "api_key": key,
            })
            print("✅ OpenAI key validated")
        except Exception as e:
            print(f"⚠️  OpenAI key invalid — skipping ({str(e)[:60]})")

    # ── Gemini: Validate upfront (CrewAI uses native Gemini SDK, not litellm) ──
    key = os.getenv("GEMINI_API_KEY")
    if key and not key.startswith("#"):
        try:
            import google.genai as genai
            client = genai.Client(api_key=key)
            # Tiny call to validate the key + quota
            client.models.generate_content(
                model="gemini-2.0-flash-lite",
                contents="ping",
                config={"max_output_tokens": 5},
            )
            providers.append({
                "name": "Gemini 2.0 Flash Lite",
                "model": "gemini/gemini-2.0-flash-lite",
                "api_key": key,
            })
            print("✅ Gemini key validated")
        except Exception as e:
            print(f"⚠️  Gemini key invalid or quota exhausted — skipping ({str(e)[:80]})")

    # ── Groq: Register multiple models (each has its own daily quota) ──
    # We validate the key once with a tiny call, then register all models.
    # If llama-3.3-70b hits its TPD cap, we fall back to 8b, then gemma2.
    key = os.getenv("GROQ_API_KEY")
    if key and key != "your_groq_api_key_here":
        groq_models = [
            ("Groq Llama-3.3-70b",  "groq/llama-3.3-70b-versatile"),
            ("Groq Llama-3.1-8b",   "groq/llama-3.1-8b-instant"),
            ("Groq Mixtral-8x7b",   "groq/mixtral-8x7b-32768"),
        ]
        # Validate key once with cheapest model
        try:
            import litellm as _lt
            _lt.completion(
                model="groq/llama-3.1-8b-instant",
                messages=[{"role": "user", "content": "hi"}],
                api_key=key,
                max_tokens=2,
            )
            for name, model in groq_models:
                providers.append({"name": name, "model": model, "api_key": key})
            print(f"✅ Groq key validated — {len(groq_models)} models registered")
        except Exception as e:
            err = str(e).lower()
            if "rate_limit" in err or "429" in str(e):
                # Key is valid, just quota-limited — still register all models
                for name, model in groq_models:
                    providers.append({"name": name, "model": model, "api_key": key})
                print(f"✅ Groq key valid (quota-limited) — {len(groq_models)} models registered")
            else:
                print(f"⚠️  Groq key invalid — skipping ({str(e)[:80]})")

    return providers


_providers = _build_providers()
_current_idx = 0

if not _providers:
    raise ValueError(
        "❌ No LLM available!\n"
        "Set at least one in .env: OPENAI_API_KEY, GEMINI_API_KEY, or GROQ_API_KEY"
    )

print(f"🔗 LLM chain: {' → '.join(p['name'] for p in _providers)}")
print(f"✅ Starting with: {_providers[0]['name']}")


# ─── Dynamic fallback wrapper (for litellm-routed providers) ───────
# This handles Gemini ↔ Groq mid-run switching. OpenAI is validated
# at startup so it either works or is excluded from the chain.
litellm.num_retries = 0  # We handle retries ourselves

_original_completion = litellm.completion


def _fallback_completion(*args, **kwargs):
    """
    Wraps litellm.completion with automatic provider fallback.
    On rate-limit/quota errors, switches to the next litellm provider.
    """
    global _current_idx

    _MAX_RETRIES = 3          # retries per provider on minute-level limits
    _RATE_LIMIT_WAIT = 60     # seconds to wait on TPM rate-limit
    _PACING_DELAY = 5         # seconds between successful calls
    _TOOL_HALLUC_RETRIES = 2  # retries for tool hallucination errors

    for i in range(_current_idx, len(_providers)):
        provider = _providers[i]
        # Skip OpenAI — it uses CrewAI's native SDK, not litellm
        if provider["model"].startswith("openai/"):
            continue

        kwargs["model"] = provider["model"]
        kwargs["api_key"] = provider["api_key"]

        for retry in range(_MAX_RETRIES):
            try:
                result = _original_completion(*args, **kwargs)
                if i != _current_idx:
                    _current_idx = i
                # Proactive pacing: spread calls so we don't burst the TPM
                time.sleep(_PACING_DELAY)
                return result
            except Exception as e:
                err = str(e).lower()
                is_rate_limit = (
                    "rate_limit" in err
                    or "429" in str(e)
                    or "resource_exhausted" in err
                    or "quota" in err
                )
                # Daily quota (TPD) = skip this model immediately, no retry
                is_daily_limit = "tokens per day" in err or "tpd" in err

                if is_daily_limit:
                    next_msg = ""
                    if i + 1 < len(_providers):
                        next_p = _providers[i + 1]
                        if not next_p["model"].startswith("openai/"):
                            next_msg = f" → switching to {next_p['name']}"
                    print(f"⚠️  {provider['name']}: Daily quota exhausted{next_msg}")
                    break  # Skip all retries, move to next provider

                # Tool hallucination: model called a non-existent tool
                is_tool_halluc = (
                    "tool call validation failed" in err
                    or "tool_use_failed" in err
                    or "not in request.tools" in err
                )
                if is_tool_halluc and retry < _TOOL_HALLUC_RETRIES:
                    print(
                        f"🔄 {provider['name']}: Hallucinated tool call → retrying "
                        f"(attempt {retry + 1}/{_TOOL_HALLUC_RETRIES})..."
                    )
                    time.sleep(2)
                    continue

                if is_rate_limit and retry < _MAX_RETRIES - 1:
                    print(
                        f"⏳ {provider['name']}: Rate limited → waiting "
                        f"{_RATE_LIMIT_WAIT}s (attempt {retry + 1}/{_MAX_RETRIES})..."
                    )
                    time.sleep(_RATE_LIMIT_WAIT)
                    continue

                if is_rate_limit:
                    if i + 1 < len(_providers):
                        next_p = _providers[i + 1]
                        if not next_p["model"].startswith("openai/"):
                            print(f"⚠️  {provider['name']} exhausted → switching to {next_p['name']}...")
                    break  # Move to next provider

                # Non-rate-limit error: raise immediately
                raise

    # All providers exhausted
    raise Exception(
        f"❌ All LLM providers exhausted. "
        "Please wait for daily rate limits to reset or upgrade your API tier."
    )


litellm.completion = _fallback_completion


# ─── Get LLM instance with token budget ────────────────────────────
def get_llm(max_tokens: int = 200) -> LLM:
    """Returns an LLM instance with a strict token cap."""
    provider = _providers[_current_idx]
    return LLM(
        model=provider["model"],
        api_key=provider["api_key"],
        max_tokens=max_tokens,
    )


# Per-agent LLMs — budget tuned for 12,000 TPM across full crew run
llm_monitor  = get_llm(max_tokens=200)   # structured table output
llm_severity = get_llm(max_tokens=100)   # classification + 2-3 sentences
llm_strategy = get_llm(max_tokens=120)   # short directive, 3 fields
llm_drafter  = get_llm(max_tokens=350)   # 4 tweet-length replies
llm_feedback = get_llm(max_tokens=120)   # verdict + one sentence


@CrewBase
class SocialmediaCrisisagent():
    """Social Media Crisis Response Crew"""

    agents: List[BaseAgent]
    tasks: List[Task]

    @agent
    def monitor_agent(self) -> Agent:
        return Agent(
            config=self.agents_config['monitor_agent'],
            tools=[FeedReaderTool()],
            llm=llm_monitor,
            verbose=True,
            max_iter=2,
        )

    @agent
    def severity_agent(self) -> Agent:
        return Agent(
            config=self.agents_config['severity_agent'],
            llm=llm_severity,
            verbose=True,
            max_iter=2,
        )

    @agent
    def strategy_agent(self) -> Agent:
        return Agent(
            config=self.agents_config['strategy_agent'],
            llm=llm_strategy,
            verbose=True,
            max_iter=2,
        )

    @agent
    def drafter_agent(self) -> Agent:
        return Agent(
            config=self.agents_config['drafter_agent'],
            tools=[ResponseLoggerTool()],
            llm=llm_drafter,
            verbose=True,
            max_iter=3,
        )

    @agent
    def feedback_agent(self) -> Agent:
        return Agent(
            config=self.agents_config['feedback_agent'],
            tools=[FeedReaderTool()],
            llm=llm_feedback,
            verbose=True,
            max_iter=4,
        )

    @task
    def monitor_task(self) -> Task:
        return Task(config=self.tasks_config['monitor_task'])

    @task
    def severity_task(self) -> Task:
        return Task(config=self.tasks_config['severity_task'])

    @task
    def strategy_task(self) -> Task:
        return Task(config=self.tasks_config['strategy_task'])

    @task
    def drafter_task(self) -> Task:
        return Task(config=self.tasks_config['drafter_task'])

    @task
    def feedback_task(self) -> Task:
        return Task(
            config=self.tasks_config['feedback_task'],
            output_file='report.md'
        )

    @crew
    def crew(self) -> Crew:
        return Crew(
            agents=self.agents,
            tasks=self.tasks,
            process=Process.sequential,
            verbose=True,
            max_rpm=15,  # stay well under 30 RPM limit
        )