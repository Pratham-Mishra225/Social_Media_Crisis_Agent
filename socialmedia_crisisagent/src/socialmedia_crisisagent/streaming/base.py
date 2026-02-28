"""Abstract base class for social media stream providers.

Any real API integration (X/Twitter, Instagram Graph API, etc.) should
subclass ``StreamProvider`` and implement the three abstract methods.
"""

from abc import ABC, abstractmethod
from typing import AsyncGenerator


class StreamProvider(ABC):
    """Contract every streaming source must follow."""

    @abstractmethod
    async def stream(self) -> AsyncGenerator[dict, None]:  # pragma: no cover
        """Yield individual post dicts one at a time.

        Each dict must at minimum contain::

            {
                "id": str,
                "user": str,
                "text": str,
                "likes": int,
                "retweets": int,
                "timestamp": str  # ISO-8601
            }
        """
        yield {}  # type hint helper – real impls will yield actual dicts

    @abstractmethod
    async def inject(self, payload: dict) -> None:  # pragma: no cover
        """Push additional posts into a running stream.

        ``payload`` follows the same schema produced by ``stream()``.
        Implementations should buffer them so the ``stream()`` generator
        picks them up on the next iteration.
        """

    @abstractmethod
    async def stop(self) -> None:  # pragma: no cover
        """Signal the stream to shut down gracefully."""

    @property
    @abstractmethod
    def running(self) -> bool:  # pragma: no cover
        """Whether the stream is currently active."""
