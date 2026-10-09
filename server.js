
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");

const app = express();
app.use(cors());

const upload = multer({
  dest: "/tmp/",
  limits: { fileSize: 100 * 1024 * 1024 }
});

app.get("/", (req, res) => {
  res.json({ message: "DubFlow backend is running" });
});

app.post("/api/dub", upload.single("video"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Video required" });
  }

  try {
    if (!process.env.ELEVENLABS_API_KEY) {
      return res.status(500).json({ error: "API key not configured" });
    }

    const form = new FormData();
    const buffer = fs.readFileSync(req.file.path);

    form.append(
      "file",
      new Blob([buffer], { type: req.file.mimetype }),
      req.file.originalname
    );
    form.append("target_lang", req.body.target_lang || "en");
    form.append("source_lang", "auto");
    form.append("num_speakers", "0");

    const response = await fetch(
      "https://api.elevenlabs.io/v1/dubbing",
      {
        method: "POST",
        headers: {
          "xi-api-key": process.env.ELEVENLABS_API_KEY
        },
        body: form
      }
    );

    const data = await response.json();
    res.status(response.status).json(data);
   } catch (error) {
    console.error("DubFlow error:", error);
res.status(500).json({ error: error.message || "Dubbing request failed" });
  } finally {
  fs.unlink(req.file.path, () => {});
}
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`DubFlow running on port ${PORT}`);
});
