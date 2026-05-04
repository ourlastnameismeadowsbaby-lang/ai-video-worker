import express from "express";
import cors from "cors";

const app = express();

app.use(cors()); // 🔥 THIS FIXES YOUR ERROR
app.use(express.json());

app.get("/", (req, res) => {
  res.send("✅ Worker running");
});

app.post("/render", (req, res) => {
  console.log("Received:", req.body);

  res.json({
    jobId: "123",
    status: "processing"
  });
});

app.get("/status/:id", (req, res) => {
  res.json({
    status: "done",
    file: "/file/demo.mp4"
  });
});

app.get("/file/:name", (req, res) => {
  res.send("Dummy video file");
});

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
