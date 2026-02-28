import json
import os
from datetime import datetime
from crewai.tools import BaseTool

# Resolve paths relative to the project root (three levels up from this file)
_PROJECT_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
)


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

        mock_dir = os.path.join(_PROJECT_ROOT, "mock_data")
        os.makedirs(mock_dir, exist_ok=True)

        # ── JSON structured log (audit trail) ──
        json_path = os.path.join(mock_dir, "crisis_log.json")
        logs = []
        if os.path.exists(json_path):
            with open(json_path, "r", encoding="utf-8") as f:
                try:
                    logs = json.load(f)
                except Exception:
                    logs = []
        logs.append(log_entry)
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(logs, f, indent=2)

        # ── Markdown log (consumed by dashboard /logs endpoint) ──
        md_path = os.path.join(mock_dir, "crisis_log.md")
        md_line = f"[{log_entry['timestamp']}] SEVERITY: {severity} | {response_text}\n"
        with open(md_path, "a", encoding="utf-8") as f:
            f.write(md_line)

        return f"✅ Response logged. Severity: {severity} | Time: {log_entry['timestamp']}"