const express = require("express");
const cors = require("cors");

const app = express();
const PORT = 3000;


app.use(cors());
app.use(express.json());
app.use(express.static(".")); // serves your HTML files


const users = [];


app.get("/api/auth/status", (req, res) => {
  res.json({
    success: true,
    capabilities: ["signup", "login"]
  });
});


app.post("/api/auth/signup", (req, res) => {
  const { email, password, username } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: "Email and password required"
    });
  }

  const existingUser = users.find(user => user.email === email);
  if (existingUser) {
    return res.status(409).json({
      success: false,
      message: "User already exists"
    });
  }

  const newUser = {
    id: Date.now(),
    email,
    password,
    name: username || "User",
    provider: "local"
  };

  users.push(newUser);

  res.json({
    success: true,
    user: newUser,
    token: "fake-jwt-token"
  });
});


app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body;

  const user = users.find(
    u => u.email === email && u.password === password
  );

  if (!user) {
    return res.status(401).json({
      success: false,
      message: "Invalid email or password"
    });
  }

  res.json({
    success: true,
    user,
    token: "fake-jwt-token"
  });
});


app.get("/api/auth/google/config", (req, res) => {
  res.json({
    enabled: false
  });
});

app.post("/api/auth/google", (req, res) => {
  res.status(400).json({
    success: false,
    message: "Google auth not set up yet"
  });
});


app.patch("/api/auth/profile", (req, res) => {
  res.json({
    success: true,
    user: { message: "Profile updated (demo only)" }
  });
});


app.post("/api/auth/logout", (req, res) => {
  res.json({
    success: true
  });
});


app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});