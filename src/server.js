import express from "express";

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.send("✅ AI Video Worker is running");
});

app.post("/render", (req, res) => {
  res.json({
    message: "Render endpoint working",
    received: req.body
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
