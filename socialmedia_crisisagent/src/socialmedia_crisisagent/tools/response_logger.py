import json
import os
from datetime import datetime
from crewai.tools import BaseTool


class ResponseLoggerTool(BaseTool):
    name: str = "Response Logger"
    description: str = (
        "Logs the drafted crisis response to the crisis log file. "
        "Pass a single string in this exact format: "
        "SEVERITY: <level> | RESPONSE: <text> | ACTION: <action taken>"
    )

    def _run(self, log_input: str = "") -> str:
        try:
            parts = {}
            for part in log_input.split("|"):
                if ":" in part:
                    key, value = part.split(":", 1)
                    parts[key.strip()] = value.strip()

            severity = parts.get("SEVERITY", "UNKNOWN")
            response_text = parts.get("RESPONSE", "")
            action_taken = parts.get("ACTION", "")

        except Exception:
            severity = "UNKNOWN"
            response_text = log_input
            action_taken = "raw log"

        log_entry = {
            "timestamp": datetime.now().isoformat(),
            "severity": severity,
            "response": response_text,
            "action": action_taken
        }

        # Same fix — use cwd
        path = os.path.join(os.getcwd(), "mock_data", "crisis_log.json")

        logs = []
        if os.path.exists(path):
            with open(path, "r") as f:
                try:
                    logs = json.load(f)
                except Exception:
                    logs = []

        logs.append(log_entry)

        with open(path, "w") as f:
            json.dump(logs, f, indent=2)

        return f"✅ Response logged. Severity: {severity} | Time: {log_entry['timestamp']}"