require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// ENV variables
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/lytune-app';

// MongoDB User schema
mongoose
  .connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected'))
  .catch((err) => {
    console.error('MongoDB connection failed:', err);
    process.exit(1);
  });

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  name: { type: String, default: 'User' },
  provider: { type: String, default: 'local' }, // prepared for social auth
}, { timestamps: true });

const User = mongoose.model('User', userSchema);

const app = express();
app.use(cors());
app.use(express.json());

// -- Status route
app.get('/api/auth/status', (req, res) => {
  res.json({
    success: true,
    capabilities: ['signup', 'login']
  });
});

// -- Signup route
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { email, password, username } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password required' });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ success: false, message: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const user = await User.create({
      email,
      password: hashedPassword,
      name: username || 'User'
    });

    const token = jwt.sign({ id: user._id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, user: { id: user._id, email: user.email, name: user.name }, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Signup failed, please try again.' });
  }
});

// -- Login route
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const token = jwt.sign({ id: user._id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, user: { id: user._id, email: user.email, name: user.name }, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Login failed, please try again.' });
  }
});

// -- Profile update stub
app.patch('/api/auth/profile', async (req, res) => {
  // For demo: return success (implement secure updates for real apps)
  res.json({
    success: true,
    user: { message: 'Profile updated (demo only)' }
  });
});

// -- Logout stub
app.post('/api/auth/logout', (req, res) => {
  // Client should just delete the token
  res.json({ success: true });
});

// -- Social login stub
app.get('/api/auth/google/config', (req, res) => {
  res.json({ enabled: false });
});

app.post('/api/auth/google', (req, res) => {
  res.status(400).json({ success: false, message: 'Google auth not set up yet' });
});

// -- Start the server
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
