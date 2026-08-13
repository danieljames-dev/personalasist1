# iPhone / Safari voice acceptance matrix

**Docs basis (2026-08-12 research):** MDN `getUserMedia` secure contexts; WebKit MediaRecorder; Tailscale Serve HTTPS.

## Secure context

| URL | isSecureContext | mic expected |
|-----|-----------------|--------------|
| `https://<host>.<tailnet>.ts.net/` | true | Available if permission granted |
| `http://127.0.0.1:31415/` | true (localhost exception) | Desktop only |
| `http://100.x.x.x:31415/` | **false** | **Fail** — Not Secure |

## API chain

| Step | Expected |
|------|----------|
| `navigator.mediaDevices` | defined on HTTPS |
| `getUserMedia({ audio: true })` | user gesture; permission prompt |
| Permission denied | clean toast; Send still works for text |
| Permission allowed | MediaStream active |
| `MediaRecorder.isTypeSupported` | negotiate — **do not assume webm** |
| iOS preferred MIME | try `audio/mp4`, `audio/aac`, then others |
| record / stop | Blob non-empty |
| upload | same chat pipeline as file attach |
| server ffmpeg | converts if needed |
| faster-whisper | transcript or READY failure |
| AION answer | same conversation focus as typed |

## Browser-side format negotiation (expected contract)

```text
for type of [audio/mp4, audio/mp4;codecs=mp4a.40.2, audio/aac, audio/webm;codecs=opus, audio/webm]:
  if MediaRecorder.isTypeSupported(type): use type; break
if none: show honest "this browser cannot record audio here"
```

## Outcomes to record

| Case | Result | Notes |
|------|--------|-------|
| HTTPS + allow | | |
| HTTPS + deny | | |
| HTTP Tailscale IP | | |
| Desktop Chrome HTTPS | | |
| Desktop Chrome localhost | | |
