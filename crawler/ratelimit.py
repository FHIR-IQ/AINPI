"""
Per-host token bucket for polite crawling.

One request per second per host by default. A separate global semaphore
caps total concurrency. Both limits apply together.

Reference: the methodology's crawl etiquette section specifies 2-4
concurrent connections per host, 1 rps default, exponential backoff
with jitter on 429/503. This module implements the per-host limit;
backoff lives in levels.py alongside the HTTP calls.
"""

from __future__ import annotations

import asyncio
import time
from collections import defaultdict


class PerHostRateLimiter:
    """Enforces min_interval seconds between requests to the same host.

    Thread-unsafe; async-safe. One instance shared across all probes.
    """

    def __init__(self, min_interval_seconds: float = 1.0) -> None:
        self._min_interval = min_interval_seconds
        self._next_allowed: dict[str, float] = defaultdict(float)
        self._locks: dict[str, asyncio.Lock] = {}
        self._locks_guard = asyncio.Lock()

    async def _lock_for(self, host: str) -> asyncio.Lock:
        async with self._locks_guard:
            lock = self._locks.get(host)
            if lock is None:
                lock = asyncio.Lock()
                self._locks[host] = lock
            return lock

    async def acquire(self, host: str) -> None:
        """Block until it's this host's turn; update the next-allowed timestamp."""
        lock = await self._lock_for(host)
        async with lock:
            now = time.monotonic()
            earliest = self._next_allowed[host]
            if now < earliest:
                await asyncio.sleep(earliest - now)
            self._next_allowed[host] = max(now, earliest) + self._min_interval
