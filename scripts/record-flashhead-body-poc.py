#!/usr/bin/env python3
"""Record one real FlashHead WebRTC body-motion sample to an MP4 file."""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path
import time

import aiohttp
from aiortc import RTCPeerConnection, RTCSessionDescription
from aiortc.contrib.media import MediaRecorder


def parse_args() -> argparse.Namespace:
    repo_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser()
    parser.add_argument("--server", default="http://127.0.0.1:8030")
    parser.add_argument(
        "--output",
        type=Path,
        default=repo_root / "public/demos/flashhead-body-poc.mp4",
    )
    parser.add_argument("--action", default="point")
    parser.add_argument(
        "--text",
        default="请看这里，这款产品的核心参数和优惠信息都已经为你整理好了。",
    )
    parser.add_argument("--timeout", type=float, default=40.0)
    return parser.parse_args()


async def wait_for_connection(pc: RTCPeerConnection, timeout: float) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if pc.connectionState == "connected":
            return
        if pc.connectionState in {"closed", "failed"}:
            raise RuntimeError(f"WebRTC connection entered {pc.connectionState!r}")
        await asyncio.sleep(0.05)
    raise TimeoutError("WebRTC connection timed out")


async def wait_for_speech(
    session: aiohttp.ClientSession,
    server: str,
    request_id: int,
    timeout: float,
) -> dict[str, object]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        async with session.get(f"{server}/health") as response:
            response.raise_for_status()
            health = await response.json()
        timing = health.get("last_timing")
        if isinstance(timing, dict) and timing.get("request_id") == request_id:
            if timing.get("state") == "completed":
                return health
            if timing.get("state") == "failed":
                raise RuntimeError(f"FlashHead speech failed: {json.dumps(timing)}")
        await asyncio.sleep(0.2)
    raise TimeoutError("FlashHead speech did not complete before the recording timeout")


async def record(args: argparse.Namespace) -> None:
    args.output.parent.mkdir(parents=True, exist_ok=True)
    pc = RTCPeerConnection()
    recorder = MediaRecorder(str(args.output))
    received_tracks: list[str] = []

    @pc.on("track")
    def on_track(track) -> None:
        received_tracks.append(track.kind)
        recorder.addTrack(track)

    pc.addTransceiver("video", direction="recvonly")
    pc.addTransceiver("audio", direction="recvonly")

    try:
        async with aiohttp.ClientSession() as session:
            offer = await pc.createOffer()
            await pc.setLocalDescription(offer)
            async with session.post(
                f"{args.server}/offer",
                json={"sdp": pc.localDescription.sdp, "type": pc.localDescription.type},
            ) as response:
                response.raise_for_status()
                answer = await response.json()
            await pc.setRemoteDescription(
                RTCSessionDescription(sdp=answer["sdp"], type=answer["type"])
            )
            await wait_for_connection(pc, min(args.timeout, 15.0))
            if set(received_tracks) != {"audio", "video"}:
                raise RuntimeError(f"expected audio and video tracks, got {received_tracks}")

            await recorder.start()
            await asyncio.sleep(0.6)
            async with session.post(
                f"{args.server}/human",
                json={
                    "type": "echo",
                    "text": args.text,
                    "action": args.action,
                    "interrupt": True,
                },
            ) as response:
                response.raise_for_status()
                submitted = await response.json()
            request_id = int(submitted["request_id"])
            health = await wait_for_speech(
                session,
                args.server,
                request_id,
                args.timeout,
            )
            await asyncio.sleep(0.8)
            print(json.dumps({
                "output": str(args.output),
                "action": submitted.get("action"),
                "resolution": health.get("resolution"),
                "timing": health.get("last_timing"),
            }, ensure_ascii=False, indent=2))
    finally:
        await recorder.stop()
        await pc.close()


def main() -> None:
    args = parse_args()
    if args.timeout <= 0:
        raise ValueError("timeout must be positive")
    asyncio.run(record(args))


if __name__ == "__main__":
    main()
