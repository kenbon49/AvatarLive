# MuseTalk server_total idle/live playback

The live console supports the three-service development stack from
`D:/code/avatar/MuseTalk/docker-compose.dev.yml`:

```text
server_total :8080
  -> LiteLLM
  -> MeloTTS :8084 (16 kHz PCM)
  -> accelerated MuseTalk :8083 (/v1/stream)
  -> MSTK/1 PCM + JPEG packets
  -> AvatarLive canvas + Web Audio
```

## Playback states

The MuseTalk stage has one visible media layer at a time:

1. `idle`: muted `/assets/musetalk-default/chinese-idle-3f.mp4`, repeatedly seeking
   over the interval `[0, 1)` seconds.
2. `stream_start`: establish a 650 ms jitter buffer, then use the PCM clock and
   each packet's `pts_us` to schedule PCM and JPEG frames. The idle layer stays
   visible until the first generated JPEG is actually painted, avoiding a
   black transition frame.
3. `stream_end`: keep playing already scheduled packets; switch to idle only
   after the greatest audio/video PTS has elapsed.
4. disconnect, error, renderer switch, or a new question: stop old audio,
   invalidate delayed frames, close the old WebSocket, and return to idle.

The inference source is `D:/code/avatar/MuseTalk/data/avatar_image/chinese.mp4`.
The browser idle asset contains only source frames 16, 17, and 18 at 3 FPS;
the three unique frames repeat while the full source remains unchanged.

## Start the inference stack

From the MuseTalk checkout:

```powershell
cd D:\code\avatar\MuseTalk
Copy-Item .env.example .env
docker compose -f docker-compose.dev.yml up --build
```

Required endpoints after warm-up:

```text
http://localhost:8083/readiness
http://localhost:8084/health
http://localhost:8080/health
ws://localhost:8080/v1/conversation
```

For the AvatarLive web process, the defaults are sufficient on the same
machine. Cross-machine or HTTPS deployments should configure:

```dotenv
MUSETALK_TOTAL_UPSTREAM=http://GPU_HOST:8080
NEXT_PUBLIC_MUSETALK_TOTAL_URL=wss://WEB_HOST/musetalk-total-api/v1/conversation
```

The reverse proxy must pass WebSocket Upgrade headers for
`/musetalk-total-api/*`.

## Scope

`server_total` accepts a question, not arbitrary live camera frames. Its
generated video is a JPEG stream driven by the selected preprocessed MuseTalk
profile. The idle MP4 is only a placeholder and never enters inference.

The MuseTalk repository's software license is MIT, but that does not by itself
prove a production portrait/model release for the person in `chinese.mp4`.
Confirm that permission before public or commercial use.
