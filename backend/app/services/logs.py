import asyncio
from collections import deque
from collections.abc import AsyncGenerator
from pathlib import Path


def tail_log(path: Path, max_lines: int = 200) -> list[str]:
    lines, _offset = tail_log_with_offset(path, max_lines=max_lines)
    return lines


def tail_log_with_offset(path: Path, max_lines: int = 200) -> tuple[list[str], int]:
    if max_lines <= 0 or not path.is_file():
        return [], 0

    with path.open("r", encoding="utf-8", errors="replace") as log_file:
        lines = [line.rstrip("\r\n") for line in deque(log_file, maxlen=max_lines)]
        return lines, log_file.tell()


def _sse_data(line: str) -> str:
    return f"data: {line}\n\n"


async def stream_log(
    path: Path | None,
    poll_seconds: float = 0.5,
    follow_from_end: bool = False,
    start_position: int | None = None,
) -> AsyncGenerator[str]:
    position = 0
    if start_position is not None:
        position = max(start_position, 0)
    elif follow_from_end and path is not None and path.is_file():
        position = path.stat().st_size

    yield ": connected\n\n"

    while True:
        if path is not None and path.is_file():
            with path.open("r", encoding="utf-8", errors="replace") as log_file:
                if position > path.stat().st_size:
                    position = 0
                log_file.seek(position)
                for line in log_file:
                    yield _sse_data(line.rstrip("\r\n"))
                position = log_file.tell()
        await asyncio.sleep(poll_seconds)
