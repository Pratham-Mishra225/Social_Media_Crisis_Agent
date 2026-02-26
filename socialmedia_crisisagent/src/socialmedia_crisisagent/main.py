#!/usr/bin/env python
import sys
import warnings
import json
from datetime import datetime

from socialmedia_crisisagent.crew import SocialmediaCrisisagent

warnings.filterwarnings("ignore", category=SyntaxWarning, module="pysbd")


def run():
    """Run the crew in terminal."""
    print("\n🚨 Starting Social Media Crisis Response Crew...\n")
    try:
        result = SocialmediaCrisisagent().crew().kickoff()
        print("\n\n=== CREW FINAL OUTPUT ===")
        print(result)
        return result
    except Exception as e:
        raise Exception(f"An error occurred while running the crew: {e}")


def serve():
    """Start the FastAPI server."""
    import uvicorn
    print("\n🚀 Starting Crisis Agent API server on http://localhost:8000\n")
    uvicorn.run(
        "socialmedia_crisisagent.api.server:app",
        host="0.0.0.0",
        port=8000,
        reload=True
    )


def train():
    try:
        SocialmediaCrisisagent().crew().train(
            n_iterations=int(sys.argv[1]),
            filename=sys.argv[2],
        )
    except Exception as e:
        raise Exception(f"An error occurred while training the crew: {e}")


def replay():
    try:
        SocialmediaCrisisagent().crew().replay(task_id=sys.argv[1])
    except Exception as e:
        raise Exception(f"An error occurred while replaying the crew: {e}")


def test():
    try:
        SocialmediaCrisisagent().crew().test(
            n_iterations=int(sys.argv[1]),
            eval_llm=sys.argv[2],
        )
    except Exception as e:
        raise Exception(f"An error occurred while testing the crew: {e}")