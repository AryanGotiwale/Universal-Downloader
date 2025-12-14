// backend/server.js
import express from "express";
import cors from "cors";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";

const app = express();
app.use(express.json());
app.use(cors());

const DOWNLOAD_DIR = path.join(process.cwd(), "downloads");
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR);

// Force add FFmpeg path (Windows Winget)
process.env.PATH += ";C:\\Users\\admin\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.0.1-full_build\\bin";

const jobs = {}; // In-memory job tracking

/* =======================
      /info – metadata
==========================*/
app.post("/info", (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "Missing url" });

  const proc = spawn(
    "python",
    ["-m", "yt_dlp", "--dump-json", url],
    { shell: false }
  );

  let stdout = "";
  let stderr = "";

  proc.stdout.on("data", (d) => (stdout += d.toString()));
  proc.stderr.on("data", (d) => (stderr += d.toString()));

  proc.on("close", (code) => {
    if (code !== 0) {
      console.error("yt-dlp info error:", stderr);
      return res.status(500).json({
        error: "Failed to fetch info",
        details: stderr,
      });
    }

    try {
      const info = JSON.parse(stdout);
      const meta = {
        id: info.id,
        title: info.title,
        thumbnail: info.thumbnail,
        duration: info.duration,
        uploader: info.uploader,
        webpage_url: info.webpage_url,
        formats: (info.formats || []).map((f) => ({
          format_id: f.format_id,
          ext: f.ext,
          height: f.height || null,
          filesize: f.filesize || null,
          format_note: f.format_note || null,
          acodec: f.acodec,
          vcodec: f.vcodec,
        })),
      };
      res.json(meta);
    } catch (err) {
      console.error("Parse error:", err);
      res.status(500).json({ error: "Failed to parse metadata" });
    }
  });
});

/* =======================
   /download – actual file
==========================*/
app.post("/download", (req, res) => {
  const { url, format } = req.body;
  if (!url) return res.status(400).json({ error: "Missing url" });

  const jobId = uuidv4();
  const outName = `file_${jobId}.%(ext)s`;
  const outPath = path.join(DOWNLOAD_DIR, outName);

  const args = ["-o", outPath, "--no-warnings", "--newline"];
  if (format) args.push("-f", format);

  args.push(url); // DO NOT QUOTE URL here

  const proc = spawn("python", ["-m", "yt_dlp", ...args], { shell: false });

  jobs[jobId] = {
    id: jobId,
    process: proc,
    status: "running",
    percent: 0,
    speed: null,
    eta: null,
    outputFile: null,
    stderr: "",
  };

  // Handle yt-dlp output
  const parseProgress = (line) => {
    line = line.toString().trim();
    if (!line) return;

    if (line.includes("Destination:")) {
      const filename = line.split("Destination:")[1].trim();
      jobs[jobId].outputFile = filename;
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

  proc.stdout.on("data", (d) => parseProgress(d));
  proc.stderr.on("data", (d) => {
    jobs[jobId].stderr += d.toString();
    parseProgress(d);
  });

  proc.on("close", (code) => {
    if (code === 0) {
      jobs[jobId].status = "finished";

      const files = fs.readdirSync(DOWNLOAD_DIR);
      const found = files.find((f) => f.includes(jobId));
      if (found) jobs[jobId].outputFile = path.join(DOWNLOAD_DIR, found);
    } else {
      jobs[jobId].status = "error";
      console.log("YT-DLP ERROR:", jobs[jobId].stderr);
    }
  });

  res.json({ jobId });
});

/* =======================
   /progress – SSE updates
==========================*/
app.get("/progress/:jobId", (req, res) => {
  const { jobId } = req.params;

  if (!jobs[jobId]) return res.status(404).send("Job not found");

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const interval = setInterval(() => {
    const job = jobs[jobId];

    res.write(`event: progress\n`);
    res.write(`data: ${JSON.stringify(job)}\n\n`);

    if (job.status === "finished" || job.status === "error") {
      clearInterval(interval);
      res.write(`event: done\n`);
      res.write(`data: ${JSON.stringify({ status: job.status })}\n\n`);
      res.end();
    }
  }, 700);

  req.on("close", () => clearInterval(interval));
});

/* =======================
   /file – return finished file
==========================*/
app.get("/file/:jobId", (req, res) => {
  const job = jobs[req.params.jobId];

  if (!job) return res.status(404).send("Job not found");
  if (job.status !== "finished") return res.status(400).send("Not ready");

  const filePath = job.outputFile;
  if (!filePath || !fs.existsSync(filePath)) return res.status(404).send("File missing");

  res.download(filePath, path.basename(filePath), () => {
    // Cleanup
    try {
      fs.unlinkSync(filePath);
      delete jobs[req.params.jobId];
    } catch {}
  });
});

/* =======================*/
app.listen(5000, () => {
  console.log("Backend running on port 5000");
});