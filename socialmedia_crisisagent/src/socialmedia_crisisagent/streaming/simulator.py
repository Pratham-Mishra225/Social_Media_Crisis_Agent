"""Simulated real-time social media stream.

Reads posts from the ``mock_data/`` folder and yields them one-by-one
with a configurable delay, mimicking a live firehose.  An ``inject_wave``
helper lets the dashboard push additional waves (e.g. after clicking
"Inject Crisis") into the same running stream without restarting it.
"""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import AsyncGenerator

from .base import StreamProvider

# Default: three directories above this file → project root
_DEFAULT_DATA_DIR = Path(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
) / "mock_data"


class StreamingSimulator(StreamProvider):
    """Async generator that emits mock tweets at a steady cadence.

    Parameters
    ----------
    data_dir:
        Folder containing ``tweets.json``, ``tweets_wave2.json``, etc.
    delay_seconds:
        Pause between successive posts (seconds).
    initial_wave:
        Which wave file to load on first ``stream()`` call
        (``1`` → ``tweets.json``, ``2`` → ``tweets_wave2.json``).
    """

    def __init__(
        self,
        data_dir: Path | str | None = None,
        delay_seconds: float = 3.0,
        initial_wave: int = 1,
    ) -> None:
        self._data_dir = Path(data_dir) if data_dir else _DEFAULT_DATA_DIR
        self._delay = delay_seconds
        self._initial_wave = initial_wave
        self._queue: asyncio.Queue[dict | None] = asyncio.Queue()
        self._running_flag = False
        self._new_data = asyncio.Event()  # wakes the idle loop when new posts arrive

    # ── StreamProvider interface ──────────────────────────────────────────

    @property
    def running(self) -> bool:
        return self._running_flag

    async def stream(self) -> AsyncGenerator[dict, None]:
        """Start emitting posts. Yields forever until ``stop()`` is called."""
        self._running_flag = True

        # Seed the queue with the initial wave
        self._enqueue_wave(self._initial_wave)

        while self._running_flag:
            # Drain everything currently in the queue
            while not self._queue.empty():
                post = self._queue.get_nowait()
                if post is None:  # poison pill → shutdown
                    self._running_flag = False
                    return
                yield post
                await asyncio.sleep(self._delay)

            # Queue is empty – wait for new data or a stop signal
            self._new_data.clear()
            try:
                await asyncio.wait_for(self._new_data.wait(), timeout=1.0)
            except asyncio.TimeoutError:
                continue  # just loop back and re-check

    async def inject(self, payload: dict) -> None:
        """Push a single post dict into the live stream."""
        await self._queue.put(payload)
        self._new_data.set()

    async def stop(self) -> None:
        """Gracefully shut down the stream."""
        self._running_flag = False
        await self._queue.put(None)  # poison pill
        self._new_data.set()

    # ── Convenience helpers ───────────────────────────────────────────────

    async def inject_wave(self, wave: int) -> int:
        """Load all posts from a wave file and push them into the queue.

        Returns the number of posts enqueued.
        """
        count = self._enqueue_wave(wave)
        self._new_data.set()
        return count

    def _enqueue_wave(self, wave: int) -> int:
        """Synchronously load a wave file and put posts on the queue."""
        filename = "tweets.json" if wave == 1 else f"tweets_wave{wave}.json"
        path = self._data_dir / filename
        if not path.exists():
            return 0
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        tweets = data.get("tweets", [])
        for tweet in tweets:
            tweet["wave"] = data.get("wave", wave)
            self._queue.put_nowait(tweet)
        return len(tweets)
