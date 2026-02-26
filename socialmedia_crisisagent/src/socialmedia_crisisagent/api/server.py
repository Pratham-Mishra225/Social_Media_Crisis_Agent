import json
import os
import asyncio
import re
import sys
import io
from datetime import datetime
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

app = FastAPI(title="Crisis Agent API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

agent_event_log: list[dict] = []
crew_status: dict = {"status": "idle", "final_output": None}


def log_event(agent: str, message: str, event_type: str = "thought"):
    event = {
        "id": len(agent_event_log) + 1,
        "timestamp": datetime.now().isoformat(),
        "agent": agent,
        "message": message,
        "type": event_type,
    }
    agent_event_log.append(event)
    return event


AGENT_PATTERNS = {
    "Social Media Monitor":           ["Social Media Monitor", "Monitor Agent"],
    "Crisis Severity Classifier":     ["Crisis Severity Classifier", "Severity"],
    "Brand Response Strategist":      ["Brand Response Strategist", "Strategist"],
    "PR Response Copywriter":         ["PR Response Copywriter", "Copywriter", "Drafter"],
    "Post-Response Sentiment Monitor":["Post-Response Sentiment Monitor", "Feedback"],
}

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
        self.buffer_lines = []

    def write(self, text: str):
        self.original.write(text)  # still print to terminal

        lines = text.split("\n")
        for line in lines:
            line = line.strip()
            if not line:
                continue

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

            # Capture Final Answer
            elif "Final Answer:" in line:
                log_event(self.current_agent, "Formulating final answer...", "thought")

            # Capture key reasoning lines (non-box-drawing)
            elif (len(line) > 20 and
                  not any(c in line for c in ["╭","╰","│","─","╮","╯"]) and
                  not line.startswith("INFO") and
                  not line.startswith("WARNING") and
                  not line.startswith("Tool ") and
                  not line.startswith("ERROR")):
                # Only log substantive lines
                clean = re.sub(r'\x1b\[[0-9;]*m', '', line)  # strip ANSI
                if len(clean) > 15:
                    log_event(self.current_agent, clean[:200], "thought")

    def flush(self):
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

@app.post("/run")
async def run_crew():
    global agent_event_log, crew_status
    agent_event_log = []
    crew_status = {"status": "running", "final_output": None}
    log_event("System", "🚨 Crisis crew triggered", "system")

    # Capture stdout to extract agent thoughts
    original_stdout = sys.stdout
    capture = CrewOutputCapture(original_stdout)
    sys.stdout = capture

    try:
        from socialmedia_crisisagent.crew import SocialmediaCrisisagent
        result = SocialmediaCrisisagent().crew().kickoff()
        final_output = str(result)
        crew_status = {"status": "completed", "final_output": final_output}
        log_event("System", "✅ Crew completed successfully", "system")
        return {"status": "completed", "final_output": final_output, "events": agent_event_log}

    except Exception as e:
        crew_status = {"status": "error", "final_output": str(e)}
        log_event("System", f"❌ Error: {str(e)[:100]}", "error")
        return JSONResponse(status_code=500, content={"status": "error", "message": str(e)})

    finally:
        sys.stdout = original_stdout


@app.get("/logs")
def get_logs():
    path = os.path.join(os.getcwd(), "mock_data", "crisis_log.md")
    if not os.path.exists(path):
        return {"logs": "No responses drafted yet."}
    with open(path, "r") as f:
        return {"logs": f.read()}


@app.get("/tweets/{wave}")
def get_tweets(wave: int = 1):
    filename = "tweets.json" if wave == 1 else f"tweets_wave{wave}.json"
    path = os.path.join(os.getcwd(), "mock_data", filename)
    if not os.path.exists(path):
        return JSONResponse(status_code=404, content={"error": f"{filename} not found"})
    with open(path, "r") as f:
        return json.load(f)


@app.post("/inject-crisis/{wave}")
def inject_crisis(wave: int = 1):
    filename = "tweets.json" if wave == 1 else f"tweets_wave{wave}.json"
    path = os.path.join(os.getcwd(), "mock_data", filename)
    if not os.path.exists(path):
        return JSONResponse(status_code=404, content={"error": f"Wave {wave} not found"})
    return {"status": "injected", "wave": wave}