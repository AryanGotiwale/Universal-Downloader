import { useState, useEffect, useRef } from "react";

// ----------------------------
// CONFIG + DEBUG LOGGING
// ----------------------------
const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

console.log("====== ENVIRONMENT CHECK ======");
console.log("VITE_API_BASE_URL =", import.meta.env.VITE_API_BASE_URL);
console.log("API USED =", API);

// Warn if env variable is missing in production
if (!import.meta.env.VITE_API_BASE_URL) {
  console.warn("❗ WARNING: VITE_API_BASE_URL is NOT FOUND. Using localhost!");
}


export default function App() {
  const [url, setUrl] = useState("");
  const [meta, setMeta] = useState(null);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [selectedFormat, setSelectedFormat] = useState("");
  const [jobId, setJobId] = useState(null);
  const [progress, setProgress] = useState({});
  const eventSourceRef = useRef(null);
  const [dark, setDark] = useState(false);


  const toggleTheme = () => {
    document.documentElement.classList.toggle("dark");
    setDark((d) => !d);
  };


  // ------------------------------------
  // 📌 FETCH VIDEO INFO
  // ------------------------------------
  const fetchInfo = async () => {
    if (!url.trim()) {
      alert("Enter a URL");
      return;
    }

    console.log("▶ Fetching Info from:", `${API}/info`);
    setLoadingInfo(true);
    setMeta(null);

    try {
      const res = await fetch(`${API}/info`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      console.log("🔵 /info RESPONSE STATUS:", res.status);

      if (!res.ok) {
        const txt = await res.text();
        console.error("❌ /info error text:", txt);
        throw new Error("Failed to fetch video info");
      }

      const data = await res.json();
      console.log("✅ VIDEO INFO RECEIVED:", data);

      setMeta(data);

      if (data.formats?.length > 0) {
        setSelectedFormat(data.formats[0].format_id);
      }

    } catch (err) {
      console.error("❌ FETCH INFO ERROR:", err);
      alert("Failed to fetch info: " + err.message);

    } finally {
      setLoadingInfo(false);
    }
  };


  // ------------------------------------
  // 📌 START DOWNLOAD
  // ------------------------------------
  const startDownload = async (formatOverride = null) => {
    if (!meta) {
      alert("Fetch info first");
      return;
    }

    const formatToSend = formatOverride || selectedFormat;
    console.log("▶ Starting download with format:", formatToSend);

    setProgress({ percent: 0, status: "starting" });

    try {
      const res = await fetch(`${API}/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: meta.webpage_url,
          format: formatToSend,
        }),
      });

      console.log("🔵 /download RESPONSE STATUS:", res.status);

      if (!res.ok) {
        const txt = await res.text();
        console.error("❌ /download ERROR:", txt);
        alert("Download start failed");
        return;
      }

      const data = await res.json();
      console.log("✅ DOWNLOAD JOB CREATED:", data);

      setJobId(data.jobId);

      // ----------------------------
      // Start SSE Listener
      // ----------------------------
      const es = new EventSource(`${API}/progress/${data.jobId}`);
      eventSourceRef.current = es;

      console.log("🔵 SSE CONNECTED:", `${API}/progress/${data.jobId}`);

      es.addEventListener("progress", (e) => {
        try {
          const p = JSON.parse(e.data);
          console.log("📊 PROGRESS:", p);
          setProgress(p);
        } catch (err) {
          console.error("❌ SSE Progress parse error:", err);
        }
      });

      es.addEventListener("done", async (e) => {
        console.log("🏁 SSE DONE EVENT:", e.data);
        es.close();

        let payload = null;
        try {
          payload = JSON.parse(e.data);
        } catch (err) {
          console.error("❌ Done event JSON parse error:", err);
          alert("Failed to process final download data");
          return;
        }

        if (payload.status === "finished") {
          console.log("⬇ Downloading final file:", payload.file);

          const fileRes = await fetch(`${API}/file/${data.jobId}`);
          const blob = await fileRes.blob();
          const urlObj = URL.createObjectURL(blob);

          const a = document.createElement("a");
          a.href = urlObj;
          a.download = "download";
          document.body.appendChild(a);
          a.click();
          a.remove();

          URL.revokeObjectURL(urlObj);
        } else {
          console.error("❌ Download failed:", payload);
          alert("Download failed");
        }

        setJobId(null);
      });

      es.onerror = (err) => {
        console.error("❌ SSE ERROR:", err);
        es.close();
        alert("SSE connection lost");
      };

    } catch (err) {
      console.error("❌ DOWNLOAD ERROR:", err);
      alert("Download error: " + err.message);
    }
  };


  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 text-black dark:text-white p-6 transition-all">

      <button
        onClick={toggleTheme}
        className="fixed top-4 right-4 px-4 py-2 rounded shadow bg-gray-800 text-white
          dark:bg-gray-200 dark:text-black"
      >
        {dark ? "☀ Light" : "🌙 Dark"}
      </button>

      <div className="max-w-3xl mx-auto bg-white dark:bg-gray-800 shadow-lg rounded-lg p-6 transition-colors">
        <h1 className="text-2xl font-bold mb-4">Universal Video Downloader</h1>

        {/* URL INPUT */}
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            className="flex-1 p-3 border rounded bg-white text-black dark:bg-gray-700 dark:text-white dark:border-gray-600"
            placeholder="Paste video URL..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />

          <button
            onClick={fetchInfo}
            className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700
              dark:bg-blue-500 dark:hover:bg-blue-400 w-full sm:w-auto"
          >
            {loadingInfo ? "Loading..." : "Fetch Info"}
          </button>
        </div>

        {/* METADATA CARD */}
        {meta && (
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
            <img
              src={meta.thumbnail}
              alt="thumb"
              className="rounded-lg w-full h-auto object-cover"
            />

            <div className="col-span-2">
              <h2 className="text-lg font-semibold">{meta.title}</h2>
              <p className="text-sm text-gray-500 dark:text-gray-300">
                {meta.duration}s • {meta.uploader || "Unknown"}
              </p>

              <div className="mt-4">
                <label className="text-sm">Choose Format</label>
                <select
                  className="w-full p-2 rounded border bg-white dark:bg-gray-700 dark:border-gray-600 mt-1"
                  value={selectedFormat}
                  onChange={(e) => setSelectedFormat(e.target.value)}
                >
                  {meta.formats.map((f) => (
                    <option key={f.format_id} value={f.format_id}>
                      {f.ext} {f.height ? `${f.height}px` : "Audio"}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-3 mt-4">
                <button
                  onClick={() => startDownload()}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded"
                >
                  Download
                </button>

                <button
                  onClick={() => startDownload("mp3")}
                  className="px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-black rounded"
                >
                  Download MP3
                </button>
              </div>

              {/* Progress Bar */}
              {progress?.status && (
                <div className="mt-6">
                  <div className="w-full bg-gray-300 dark:bg-gray-700 rounded h-3">
                    <div
                      className="bg-blue-600 h-3 rounded dark:bg-blue-400"
                      style={{
                        width: `${progress.percent || 0}%`,
                        transition: "width 0.3s",
                      }}
                    />
                  </div>
                  <p className="text-sm mt-1">
                    {Math.floor(progress.percent) || 0}% • {progress.speed} • {progress.eta}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
