import express from "express";
import cors from "cors";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";

const app = express();

// -------------------------------------------------------
// CORS
// -------------------------------------------------------
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
  })
);

app.use(express.json());

const jobs = {};

// -------------------------------------------------------
// Downloads directory
// -------------------------------------------------------
const DOWNLOAD_DIR = path.join(process.cwd(), "downloads");
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR);

// -------------------------------------------------------
// 🔥 COOKIE PATH SUPPORT (LOCAL & RENDER)
// -------------------------------------------------------
const LOCAL_COOKIE = path.join(process.cwd(), "cookies.txt");

// On Render, secret files are stored in /etc/secrets
const SECRET_COOKIE = "/etc/secrets/cookies.txt";

// Choose correct cookie path:
const COOKIES_PATH = fs.existsSync(SECRET_COOKIE)
  ? SECRET_COOKIE
  : fs.existsSync(LOCAL_COOKIE)
  ? LOCAL_COOKIE
  : null;

console.log("🔥 Cookies loaded from:", COOKIES_PATH || "NO COOKIES FOUND!");

// -------------------------------------------------------
// Test Route
// -------------------------------------------------------
app.get("/test", (req, res) => {
  res.json({
    status: "Backend OK 🚀",
    cookies_found: COOKIES_PATH ? true : false,
    cookies_path: COOKIES_PATH,
  });
});

// -------------------------------------------------------
// /info → Fetch metadata
// -------------------------------------------------------
app.post("/info", (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "Missing URL" });

  const ytArgs = ["-m", "yt_dlp"];

  // Attach cookies if available
  if (COOKIES_PATH) ytArgs.push("--cookies", COOKIES_PATH);

  ytArgs.push(
    "--dump-json",
    "--no-warnings",
    "--merge-output-format",
    "mp4",
    url
  );

  const proc = spawn("python", ytArgs);

  let stdout = "";
  let stderr = "";

  proc.stdout.on("data", (d) => (stdout += d.toString()));
  proc.stderr.on("data", (d) => (stderr += d.toString()));

  proc.on("close", (code) => {
    if (code !== 0) {
      return res.status(500).json({
        error: "yt-dlp failed",
        details: stderr,
      });
    }

    try {
      const info = JSON.parse(stdout);
      const formats = info.formats || [];

      // Best video & audio
      const bestVideo = formats.find((f) => f.vcodec !== "none" && f.ext === "mp4");
      const bestAudio = formats.find((f) => f.acodec !== "none" && f.vcodec === "none");

      const mergedFormat =
        bestVideo && bestAudio
          ? {
              format_id: `${bestVideo.format_id}+${bestAudio.format_id}`,
              ext: "mp4",
              resolution: `${bestVideo.height || 720}p`,
              note: "Merged (video+audio)",
            }
          : null;

      const cleanedFormats = formats
        .filter((f) => {
          const isVideo = f.ext === "mp4" && f.vcodec !== "none";
          const isAudio = f.vcodec === "none" && f.acodec !== "none";
          return isVideo || isAudio;
        })
        .map((f) => ({
          format_id: f.format_id,
          ext: f.ext,
          resolution: f.vcodec === "none" ? "audio" : `${f.height || 0}p`,
        }));

      if (mergedFormat) cleanedFormats.unshift(mergedFormat);

      res.json({
        id: info.id,
        title: info.title,
        thumbnail: info.thumbnail,
        duration: info.duration,
        uploader: info.uploader,
        webpage_url: info.webpage_url,
        formats: cleanedFormats,
      });
    } catch (err) {
      res.status(500).json({
        error: "Parse error",
        details: err.message,
      });
    }
  });
});

// -------------------------------------------------------
// /download → Uses cookies for Instagram
// -------------------------------------------------------
app.post("/download", (req, res) => {
  const { url, format } = req.body;
  if (!url) return res.status(400).json({ error: "Missing URL" });

  const jobId = uuidv4();
  const outPath = path.join(DOWNLOAD_DIR, `file_${jobId}.%(ext)s`);

  const args = [
    "-o",
    outPath,
    "--no-warnings",
    "--newline",
    "--merge-output-format",
    "mp4",
  ];

  if (COOKIES_PATH) args.push("--cookies", COOKIES_PATH);

  if (format === "mp3") {
    args.push(
      "-f",
      "bestaudio",
      "--extract-audio",
      "--audio-format",
      "mp3",
      "--audio-quality",
      "0"
    );
  } else if (url.includes("instagram.com")) {
    args.push("-f", "bestvideo+bestaudio/best");
  } else if (format) {
    args.push("-f", `${format}+bestaudio/best`);
  } else {
    args.push("-f", "bestvideo+bestaudio/best");
  }

  args.push(url);

  const proc = spawn("python", ["-m", "yt_dlp", ...args]);

  jobs[jobId] = {
    id: jobId,
    status: "running",
    percent: 0,
    eta: null,
    speed: null,
    outputFile: null,
  };

  const parseProgress = (line) => {
    line = line.toString().trim();

    if (line.includes("Destination:")) {
      jobs[jobId].outputFile = line.split("Destination:")[1].trim();
    }

    if (line.startsWith("[download]")) {
      const pct = line.match(/([\d.]+)%/);
      const speed = line.match(/at ([\d.]+\S+\/s)/);
      const eta = line.match(/ETA (\S+)/);

      if (pct) jobs[jobId].percent = parseFloat(pct[1]);
      if (speed) jobs[jobId].speed = speed[1];
      if (eta) jobs[jobId].eta = eta[1];
    }
  };

  proc.stdout.on("data", parseProgress);

  proc.on("close", () => {
    const files = fs.readdirSync(DOWNLOAD_DIR);
    const found = files.find((f) => f.includes(jobId));

    if (found) {
      jobs[jobId].status = "finished";
      jobs[jobId].outputFile = path.join(DOWNLOAD_DIR, found);
    } else {
      jobs[jobId].status = "error";
    }
  });

  res.json({ jobId });
});

// -------------------------------------------------------
// SSE progress
// -------------------------------------------------------
app.get("/progress/:jobId", (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job) return res.status(404).send("Job not found");

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const timer = setInterval(() => {
    res.write(`event: progress\n`);
    res.write(`data: ${JSON.stringify(job)}\n\n`);

    if (job.status === "finished" || job.status === "error") {
      clearInterval(timer);
      res.write(`event: done\n`);
      res.write(`data: ${JSON.stringify(job)}\n\n`);
      res.end();
    }
  }, 700);
});

// -------------------------------------------------------
// /file → return final file
// -------------------------------------------------------
app.get("/file/:jobId", (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job || job.status !== "finished")
    return res.status(404).send("Not ready");

  res.download(job.outputFile);
});

// -------------------------------------------------------
// Start server
// -------------------------------------------------------
app.listen(process.env.PORT || 5000, () =>
  console.log("Backend running on", process.env.PORT || 5000)
);
