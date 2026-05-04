import express from "express";
import cors from "cors";
import ffmpeg from "fluent-ffmpeg";
import { promises as fs } from "fs";
import path from "path";
import os from "os";

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "25mb" }));

const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
const AI_GATEWAY = "https://ai.gateway.lovable.dev/v1";

const OUT_DIR = path.join(os.tmpdir(), "shortsmith-out");
await fs.mkdir(OUT_DIR, { recursive: true });

const jobs = new Map();

app.get("/", (_req, res) => {
  res.json({ ok: true, service: "shortsmith-worker", hasKey: !!LOVABLE_API_KEY });
});

app.post("/render", (req, res) => {
  const storyboard = req.body || {};
  if (!Array.isArray(storyboard.scenes) || storyboard.scenes.length === 0) {
    return res.status(400).json({ error: "storyboard.scenes required" });
  }
  if (!LOVABLE_API_KEY) {
    return res.status(500).json({ error: "LOVABLE_API_KEY env var not set on worker" });
  }

  const jobId = "job_" + Math.random().toString(36).slice(2, 10);
  jobs.set(jobId, { status: "processing", progress: 0, createdAt: Date.now() });

  renderJob(jobId, storyboard).catch((err) => {
    console.error(`[${jobId}] failed:`, err);
    const job = jobs.get(jobId);
    if (job) {
      job.status = "failed";
      job.error = err?.message || String(err);
    }
  });

  res.json({ jobId });
});

app.get("/status/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "job not found" });
  res.json({
    status: job.status,
    progress: job.progress,
    fileUrl: job.fileUrl,
    error: job.error,
  });
});

app.get("/file/:name", async (req, res) => {
  const safe = path.basename(req.params.name);
  const filePath = path.join(OUT_DIR, safe);
  try { await fs.access(filePath); }
  catch { return res.status(404).json({ error: "file not found" }); }
  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Content-Disposition", `inline; filename="${safe}"`);
  res.sendFile(filePath);
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`[worker] listening on :${PORT}`));

// ---------- Pipeline ----------

async function renderJob(jobId, storyboard) {
  const job = jobs.get(jobId);
  const workDir = path.join(OUT_DIR, jobId);
  await fs.mkdir(workDir, { recursive: true });

  const scenes = storyboard.scenes;
  const total = scenes.length;
  const sceneFiles = [];

  for (let i = 0; i < total; i++) {
    const scene = scenes[i];
    console.log(`[${jobId}] scene ${i + 1}/${total}`);

    const imgPath = path.join(workDir, `scene_${i}.png`);
    const audPath = path.join(workDir, `scene_${i}.mp3`);
    const vidPath = path.join(workDir, `scene_${i}.mp4`);

    await Promise.all([
      generateImage(scene.visual_prompt, imgPath),
      generateTTS(scene.narration, audPath),
    ]);

    const dur = await probeDuration(audPath).catch(() => scene.duration_seconds || 5);
    await composeScene(imgPath, audPath, vidPath, Math.max(2, dur));
    sceneFiles.push(vidPath);

    job.progress = Math.round(((i + 1) / total) * 90);
  }

  const finalName = `${jobId}.mp4`;
  const finalPath = path.join(OUT_DIR, finalName);
  await concatScenes(sceneFiles, finalPath, workDir);

  fs.rm(workDir, { recursive: true, force: true }).catch(() => {});

  job.status = "done";
  job.progress = 100;
  job.fileUrl = `/file/${finalName}`;
  console.log(`[${jobId}] done -> ${job.fileUrl}`);
}

async function generateImage(prompt, outPath) {
  const r = await fetch(`${AI_GATEWAY}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash-image",
      messages: [{ role: "user", content: `${prompt}\n\nVertical 9:16 cinematic composition, vivid, high detail.` }],
      modalities: ["image", "text"],
    }),
  });
  if (!r.ok) throw new Error(`image gen ${r.status}: ${await r.text()}`);
  const data = await r.json();
  const url = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!url || !url.startsWith("data:")) throw new Error("no image returned");
  const b64 = url.split(",")[1];
  await fs.writeFile(outPath, Buffer.from(b64, "base64"));
}

async function generateTTS(text, outPath) {
  const r = await fetch(`${AI_GATEWAY}/audio/speech`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini-tts",
      voice: "alloy",
      input: text,
      format: "mp3",
    }),
  });
  if (!r.ok) throw new Error(`tts ${r.status}: ${await r.text()}`);
  const buf = Buffer.from(await r.arrayBuffer());
  await fs.writeFile(outPath, buf);
}

function probeDuration(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) return reject(err);
      resolve(data.format?.duration || 0);
    });
  });
}

function composeScene(img, audio, out, duration) {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(img).loop(duration).inputOptions(["-framerate 30"])
      .input(audio)
      .outputOptions([
        "-c:v libx264",
        "-tune stillimage",
        "-pix_fmt yuv420p",
        "-c:a aac",
        "-b:a 192k",
        "-shortest",
        "-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,format=yuv420p",
        "-r 30",
      ])
      .duration(duration)
      .on("end", () => resolve())
      .on("error", reject)
      .save(out);
  });
}

async function concatScenes(files, out, workDir) {
  const listPath = path.join(workDir, "concat.txt");
  await fs.writeFile(listPath, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(listPath).inputOptions(["-f concat", "-safe 0"])
      .outputOptions(["-c:v libx264", "-c:a aac", "-pix_fmt yuv420p"])
      .on("end", () => resolve())
      .on("error", reject)
      .save(out);
  });
}
