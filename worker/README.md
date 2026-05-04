# Shortsmith Worker

Renders 9:16 MP4 shorts from a storyboard JSON using:
- Lovable AI image generation (one image per scene)
- Lovable AI TTS (`openai/gpt-4o-mini-tts`) for narration
- FFmpeg to compose scenes and concatenate

## Endpoints
- `POST /render` — body: storyboard JSON `{ title, scenes: [{ visual_prompt, narration, duration_seconds }] }` → `{ jobId }`
- `GET /status/:id` → `{ status: "processing"|"done"|"failed", progress, fileUrl?, error? }`
- `GET /file/:name` → MP4

## Deploy on Render
1. Push the `worker/` folder to a Git repo.
2. Create a new **Web Service** on Render → choose the repo.
3. Environment: **Docker** (uses the included `Dockerfile`, which installs FFmpeg).
4. Add env var `LOVABLE_API_KEY` (copy from Lovable Cloud → Settings).
5. Deploy. Health check: `GET /` returns `{ ok: true, hasKey: true }`.

## Notes
- Files are stored in `/tmp` (ephemeral on Render).
- Music & captions intentionally omitted in this version.
