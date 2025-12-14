import { useState, useRef } from "react";

const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

console.log("====== ENVIRONMENT CHECK ======");
console.log("VITE_API_BASE_URL =", import.meta.env.VITE_API_BASE_URL);
console.log("API USED =", API);

if (!import.meta.env.VITE_API_BASE_URL) {
  console.warn("❗ WARNING: VITE_API_BASE_URL is NOT FOUND. Using localhost!");
}

export default function App() {
  const [url, setUrl] = useState("");
  const [meta, setMeta] = useState(null);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [jobId, setJobId] = useState(null);
  const [progress, setProgress] = useState({});
  const eventSourceRef = useRef(null);
  const [dark, setDark] = useState(false);

  const toggleTheme = () => {
    document.documentElement.classList.toggle("dark");
    setDark(d => !d);
  };

  // -----------------------------
  // Fetch metadata
  // -----------------------------
  const fetchInfo = async () => {
    if (!url.trim()) {
      alert("Enter a URL");
      return;
    }

    setLoadingInfo(true);
    setMeta(null);

    try {
      const res = await fetch(`${API}/info`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      if (!res.ok) {
        const t = await res.text();
        throw new Error(t);
      }

      const data = await res.json();
      setMeta(data);
    } catch (err) {
      alert("Failed to fetch info");
      console.error(err);
    } finally {
      setLoadingInfo(false);
    }
  };

  // -----------------------------
  // Start download (URL ONLY)
  // -----------------------------
  const startDownload = async () => {
    if (!meta) {
      alert("Fetch info first");
      return;
    }

    setProgress({ percent: 0, status: "starting" });

    const res = await fetch(`${API}/download`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: meta.webpage_url }),
    });

    const data = await res.json();
    setJobId(data.jobId);

    const es = new EventSource(`${API}/progress/${data.jobId}`);
    eventSourceRef.current = es;

    es.addEventListener("progress", e => {
      setProgress(JSON.parse(e.data));
    });

    es.addEventListener("done", async e => {
      es.close();
      const payload = JSON.parse(e.data);

      if (payload.status === "finished") {
        const fileRes = await fetch(`${API}/file/${data.jobId}`);
        const blob = await fileRes.blob();

        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "video.mp4";
        a.click();
      } else {
        alert("Download failed");
      }

      setJobId(null);
    });
  };

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 p-6">
      <button onClick={toggleTheme} className="fixed top-4 right-4 px-4 py-2 bg-black text-white rounded">
        {dark ? "☀ Light" : "🌙 Dark"}
      </button>

      <div className="max-w-3xl mx-auto bg-white dark:bg-gray-800 p-6 rounded">
        <h1 className="text-2xl font-bold mb-4">Universal Video Downloader</h1>

        <div className="flex gap-3">
          <input
            className="flex-1 p-3 border rounded"
            placeholder="Paste Instagram Reel URL"
            value={url}
            onChange={e => setUrl(e.target.value)}
          />
          <button onClick={fetchInfo} className="bg-blue-600 text-white px-4 rounded">
            {loadingInfo ? "Loading..." : "Fetch Info"}
          </button>
        </div>

        {meta && (
          <div className="mt-6">
            <img src={meta.thumbnail} className="rounded mb-3" />
            <h2 className="font-semibold">{meta.title}</h2>
            <p className="text-sm text-gray-500">
              Instagram videos are downloaded in best quality with audio.
            </p>

            <button
              onClick={startDownload}
              className="mt-4 bg-green-600 text-white px-4 py-2 rounded"
            >
              Download MP4 (Video + Audio)
            </button>

            {progress.status && (
              <div className="mt-4">
                <div className="h-2 bg-gray-300 rounded">
                  <div
                    className="h-2 bg-blue-600 rounded"
                    style={{ width: `${progress.percent || 0}%` }}
                  />
                </div>
                <p className="text-sm mt-1">{Math.floor(progress.percent || 0)}%</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
