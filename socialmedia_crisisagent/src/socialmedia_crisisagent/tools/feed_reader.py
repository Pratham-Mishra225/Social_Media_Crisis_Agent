import json
import os
from crewai.tools import BaseTool


class FeedReaderTool(BaseTool):
    name: str = "Tweet Feed Reader"
    description: str = (
        "Reads incoming tweet mentions for NovaBrew Coffee. "
        "Pass 'wave=1' for the initial crisis wave (default), "
        "or 'wave=2' for the follow-up wave after response was posted."
    )

    def _run(self, query: str = "wave=1") -> str:
        # Parse wave number from query
        wave = "1"
        if "wave=2" in query:
            wave = "2"

        filename = f"tweets_wave{wave}.json" if wave == "2" else "tweets.json"
        path = os.path.join(os.getcwd(), "mock_data", filename)

        if not os.path.exists(path):
            return f"ERROR: {filename} not found at {path}"

        with open(path, "r") as f:
            data = json.load(f)

        return json.dumps(data, indent=2)