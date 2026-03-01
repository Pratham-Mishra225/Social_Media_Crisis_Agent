import json
import os
import asyncio
import re
import sys
import io
import threading
from datetime import datetime
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sse_starlette.sse import EventSourceResponse

from socialmedia_crisisagent.streaming import StreamingSimulator

# Resolve paths relative to the project root (four levels up from this file)
# server.py → api/ → socialmedia_crisisagent/ → src/ → socialmedia_crisisagent/
_PROJECT_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
)

app = FastAPI(title="Crisis Agent API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://social-media-crisis-agent.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_lock = threading.Lock()
agent_event_log: list[dict] = []
crew_status: dict = {"status": "idle", "final_output": None}

# ── Structured decisions extracted from agent outputs ──────────────────────
crew_decisions: dict = {
    "severity": None,       # {level, reasoning}
    "strategy": None,       # {action, tone, escalate}
    "recommendation": None, # {status, reason}
    "monitor_summary": None, # {flagged_count, total_engagement}
}

# ── Streaming simulator (singleton) ────────────────────────────────────────
simulator = StreamingSimulator(
    data_dir=os.path.join(_PROJECT_ROOT, "mock_data"),
    delay_seconds=3.0,
    initial_wave=1,
)


def log_event(agent: str, message: str, event_type: str = "thought"):
    with _lock:
        event = {
            "id": len(agent_event_log) + 1,
            "timestamp": datetime.now().isoformat(),
            "agent": agent,
            "message": message,
            "type": event_type,
        }
        agent_event_log.append(event)
    return event


# ── Decision parsers ──────────────────────────────────────────────────────
def _parse_decisions_from_answer(agent: str, answer_text: str):
    """Parse structured decisions from an agent's final answer."""
    global crew_decisions
    txt = answer_text.strip()

    if agent == "Social Media Monitor":
        # Count rows (lines with |)
        rows = [l for l in txt.split("\n") if "|" in l]
        total_eng = 0
        for row in rows:
            parts = row.split("|")
            for part in parts:
                nums = re.findall(r'\d[\d,]*', part.strip())
                for n in nums:
                    val = int(n.replace(",", ""))
                    if val > 10:  # engagement values, not IDs
                        total_eng += val
        crew_decisions["monitor_summary"] = {
            "flagged_count": len(rows),
            "total_engagement": total_eng,
        }

    elif agent == "Crisis Severity Classifier":
        level = "MODERATE"
        for lbl in ["CRITICAL", "MODERATE", "LOW"]:
            if lbl in txt.upper():
                level = lbl
                break
        # Reasoning = everything after the level word
        reasoning = re.sub(r'(?i)^(CRITICAL|MODERATE|LOW)\s*', '', txt).strip()
        crew_decisions["severity"] = {"level": level, "reasoning": reasoning[:200]}

    elif agent == "Brand Response Strategist":
        action_m = re.search(r'ACTION:\s*(\S+)', txt, re.IGNORECASE)
        tone_m   = re.search(r'TONE:\s*(\S+)', txt, re.IGNORECASE)
        esc_m    = re.search(r'ESCALATE:\s*(\S+)', txt, re.IGNORECASE)
        crew_decisions["strategy"] = {
            "action":   action_m.group(1).lower() if action_m else "unknown",
            "tone":     tone_m.group(1).lower() if tone_m else "unknown",
            "escalate": esc_m.group(1).upper() == "YES" if esc_m else False,
        }

    elif agent == "Post-Response Sentiment Monitor":
        status_m = re.search(r'STATUS:\s*(ESCALATE|FOLLOW\s*UP|RESOLVED)', txt, re.IGNORECASE)
        reason_m = re.search(r'REASON:\s*(.+)', txt, re.IGNORECASE)
        crew_decisions["recommendation"] = {
            "status": status_m.group(1).upper() if status_m else "UNKNOWN",
            "reason": reason_m.group(1).strip()[:200] if reason_m else "",
        }


# ── Map task names → canonical agent names ────────────────────────────────
_TASK_AGENT_MAP = {
    "monitor_task":  "Social Media Monitor",
    "severity_task": "Crisis Severity Classifier",
    "strategy_task": "Brand Response Strategist",
    "drafter_task":  "PR Response Copywriter",
    "feedback_task": "Post-Response Sentiment Monitor",
}


def _extract_decisions_from_result(result):
    """
    Parse decisions from the CrewOutput.tasks_output list.
    This is the reliable path — called once after kickoff() returns.
    """
    global crew_decisions
    try:
        for task_output in (result.tasks_output or []):
            raw = (task_output.raw or "").strip()
            if not raw:
                continue

            # Determine canonical agent name from task name or agent field
            agent_name = None
            task_name = getattr(task_output, "name", "") or ""
            for tname, aname in _TASK_AGENT_MAP.items():
                if tname in task_name.lower():
                    agent_name = aname
                    break

            if not agent_name:
                # Fallback: try to detect from the agent field
                agent_str = str(getattr(task_output, "agent", ""))
                agent_name = detect_agent(agent_str) if agent_str else None

            if not agent_name:
                # Last resort: try to detect from content
                if any(w in raw.upper() for w in ["CRITICAL", "MODERATE", "LOW"]) and len(raw) < 500:
                    agent_name = "Crisis Severity Classifier"
                elif "ACTION:" in raw.upper() and "TONE:" in raw.upper():
                    agent_name = "Brand Response Strategist"
                elif "STATUS:" in raw.upper() and "REASON:" in raw.upper():
                    agent_name = "Post-Response Sentiment Monitor"
                elif "TWEET" in raw.upper() and "@" in raw:
                    agent_name = "PR Response Copywriter"
                else:
                    agent_name = "Social Media Monitor"

            _parse_decisions_from_answer(agent_name, raw)

            # Also log the final answer as an event if not already captured by stdout
            log_event(agent_name, raw[:300], "final_answer")

        print(f"[CrisisAgent] Decisions extracted: {crew_decisions}")
    except Exception as e:
        print(f"[CrisisAgent] Error extracting decisions: {e}")


AGENT_PATTERNS = {
    "Social Media Monitor":           ["Social Media Monitor", "Monitor Agent"],
    "Crisis Severity Classifier":     ["Crisis Severity Classifier", "Severity"],
    "Brand Response Strategist":      ["Brand Response Strategist", "Strategist"],
    "PR Response Copywriter":         ["PR Response Copywriter", "Copywriter", "Drafter"],
    "Post-Response Sentiment Monitor":["Post-Response Sentiment Monitor", "Feedback"],
}

# Lines to suppress from the agent activity log
_NOISE_PATTERNS = [
    "CrewAIEventsBus",
    "Event pairing mismatch",
    "expected 'task_started'",
    "expected 'agent_execution_started'",
    "expected 'crew_kickoff_started'",
    "Tracing is disabled",
    "tracing=True",
    "CREWAI_TRACING_ENABLED",
    "crewai traces enable",
]

def detect_agent(text: str) -> str:
    for agent, patterns in AGENT_PATTERNS.items():
        for p in patterns:
            if p.lower() in text.lower():
                return agent
    return "System"


class CrewOutputCapture(io.StringIO):
    """Intercepts crewAI stdout and converts it to structured events."""
    def __init__(self, original_stdout):
        super().__init__()
        self.original = original_stdout
        self.current_agent = "System"
        self._capturing_answer = False
        self._answer_lines: list[str] = []
        self._answer_agent = "System"

    def _flush_answer(self):
        """Flush the captured final-answer block to decisions + event log."""
        if self._answer_lines:
            full_answer = "\n".join(self._answer_lines).strip()
            if full_answer:
                _parse_decisions_from_answer(self._answer_agent, full_answer)
                log_event(self._answer_agent, full_answer[:300], "final_answer")
            self._answer_lines = []
        self._capturing_answer = False

    def write(self, text: str):
        self.original.write(text)  # still print to terminal

        lines = text.split("\n")
        for line in lines:
            # Strip ANSI escape codes early so all checks work on clean text
            line = re.sub(r'\x1b\[[0-9;]*m', '', line).strip()
            if not line:
                continue

            # Suppress noisy framework warnings
            if any(noise in line for noise in _NOISE_PATTERNS):
                continue

            # ── Final Answer capture ─────────────────────────
            if "Final Answer" in line:
                # If we were already capturing a previous answer, flush it
                if self._capturing_answer:
                    self._flush_answer()
                self._capturing_answer = True
                self._answer_agent = self.current_agent
                self._answer_lines = []
                # Extract inline content after "Final Answer:" if present
                after = line.split("Final Answer:")[-1].strip() if "Final Answer:" in line else ""
                if after:
                    self._answer_lines.append(after)
                log_event(self.current_agent, "Formulating final answer...", "thought")
                continue

            # If capturing answer lines, collect until next box/event marker
            if self._capturing_answer:
                is_boundary = (
                    any(c in line for c in ["╭", "╰", "╮", "╯"])
                    or "Agent:" in line
                    or "Task Started" in line
                    or "Task Completed" in line
                    or "Task Completion" in line
                )
                if is_boundary:
                    self._flush_answer()
                    # Fall through to process this line normally
                else:
                    # Skip box-drawing mid-chars (│ ─)
                    clean = re.sub(r'\x1b\[[0-9;]*m', '', line)
                    clean = clean.strip("│─ ")
                    if clean and len(clean) > 2:
                        self._answer_lines.append(clean)
                    continue

            # ── Standard event detection ─────────────────────
            # Detect agent start
            if "Agent:" in line:
                agent = detect_agent(line)
                if agent != "System":
                    self.current_agent = agent
                    log_event(agent, f"Agent started", "agent_start")

            # Detect task start
            elif "Task Started" in line:
                log_event(self.current_agent, "Starting task...", "task_start")

            # Detect task complete
            elif "Task Completed" in line or "Task Completion" in line:
                log_event(self.current_agent, "Task completed ✓", "agent_complete")

            # Detect tool execution
            elif "Tool Execution Started" in line or "🔧" in line:
                log_event(self.current_agent, "Calling tool...", "tool_call")

            # Detect tool result
            elif "Tool Execution Completed" in line or "Tool Completed" in line:
                log_event(self.current_agent, "Tool returned result", "tool_result")

            # Capture key reasoning lines (non-box-drawing)
            elif (len(line) > 20 and
                  not any(c in line for c in ["╭","╰","│","─","╮","╯"]) and
                  not line.startswith("INFO") and
                  not line.startswith("WARNING") and
                  not line.startswith("Tool ") and
                  not line.startswith("ERROR")):
                if len(line) > 15:
                    log_event(self.current_agent, line[:200], "thought")

    def flush(self):
        # Flush any pending answer before stream ends
        if self._capturing_answer:
            self._flush_answer()
        self.original.flush()


@app.get("/")
def health():
    return {"status": "ok", "message": "Crisis Agent API running"}

@app.get("/status")
def get_status():
    return crew_status

@app.get("/events")
def get_events():
    return {"events": agent_event_log}

@app.get("/decisions")
def get_decisions():
    return crew_decisions


@app.post("/run")
async def run_crew():
    global agent_event_log, crew_status, crew_decisions

    if crew_status.get("status") == "running":
        return JSONResponse(status_code=409, content={"status": "error", "message": "Crew is already running"})

    with _lock:
        agent_event_log = []
    crew_status = {"status": "running", "final_output": None}
    crew_decisions = {"severity": None, "strategy": None, "recommendation": None, "monitor_summary": None}
    log_event("System", "🚨 Crisis crew triggered", "system")

    def _run_crew_sync():
        """Run the crew in a thread so the event loop stays free for polling."""
        global crew_status
        original_stdout = sys.stdout
        capture = CrewOutputCapture(original_stdout)
        sys.stdout = capture
        try:
            from socialmedia_crisisagent.crew import SocialmediaCrisisagent
            result = SocialmediaCrisisagent().crew().kickoff()
            final_output = str(result)

            # ── Extract decisions from task outputs (reliable) ──────
            _extract_decisions_from_result(result)

            crew_status = {"status": "completed", "final_output": final_output}
            log_event("System", "✅ Crew completed successfully", "system")
        except Exception as e:
            crew_status = {"status": "error", "final_output": str(e)}
            log_event("System", f"❌ Error: {str(e)[:100]}", "error")
        finally:
            sys.stdout = original_stdout

    # Run in a thread so /events and /status remain responsive
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _run_crew_sync)

    return {"status": crew_status["status"], "final_output": crew_status.get("final_output"), "events": agent_event_log}


@app.get("/logs")
def get_logs():
    path = os.path.join(_PROJECT_ROOT, "mock_data", "crisis_log.md")
    if not os.path.exists(path):
        return {"logs": "No responses drafted yet."}
    with open(path, "r", encoding="utf-8") as f:
        return {"logs": f.read()}


@app.get("/tweets/{wave}")
def get_tweets(wave: int = 1):
    filename = "tweets.json" if wave == 1 else f"tweets_wave{wave}.json"
    path = os.path.join(_PROJECT_ROOT, "mock_data", filename)
    if not os.path.exists(path):
        return JSONResponse(status_code=404, content={"error": f"{filename} not found"})
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


@app.post("/inject-crisis/{wave}")
async def inject_crisis(wave: int = 1):
    filename = "tweets.json" if wave == 1 else f"tweets_wave{wave}.json"
    path = os.path.join(_PROJECT_ROOT, "mock_data", filename)
    if not os.path.exists(path):
        return JSONResponse(status_code=404, content={"error": f"Wave {wave} not found"})
    count = await simulator.inject_wave(wave)
    log_event("System", f"💥 Crisis wave {wave} injected ({count} posts)", "system")
    return {"status": "injected", "wave": wave, "file": filename, "posts_queued": count}


@app.get("/stream")
async def stream_posts(request: Request):
    """SSE endpoint — emits one tweet at a time from the streaming simulator."""

    async def _event_generator():
        # Reset the simulator for a fresh stream each time a client connects
        if simulator.running:
            await simulator.stop()

        # Small delay to let the old generator fully terminate
        await asyncio.sleep(0.1)

        # Re-create internal state for a new run
        simulator._running_flag = False
        simulator._queue = asyncio.Queue()
        simulator._new_data = asyncio.Event()
        simulator._initial_wave = 1

        async for post in simulator.stream():
            if await request.is_disconnected():
                await simulator.stop()
                break
            yield {
                "event": "tweet",
                "data": json.dumps(post),
            }

    return EventSourceResponse(_event_generator())