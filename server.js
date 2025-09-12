// server.js
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const bodyParser = require('body-parser');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const QRCode = require('qrcode');

const User = require('./models/User');
const Ground = require('./models/Ground');
const Booking = require('./models/Booking');
require('dotenv').config();


const MONGO_URI = process.env.MONGO_URI;

mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log("✅ MongoDB connected successfully"))
.catch(err => console.error("❌ MongoDB connection error:", err));


const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));
app.use(express.static(path.join(__dirname,'public')));

// configure multer for image uploads (dev: store locally)
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, 'public/uploads'));
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g,'-'));
  }
});
const upload = multer({ storage });

const JWT_SECRET = process.env.JWT_SECRET || 'replace_with_secure_random_string';

// connect to mongodb
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(()=> console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// helper middleware: verify token and set req.user
const authMiddleware = async (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ message: 'No token' });
  const token = auth.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = await User.findById(decoded.id).select('-passwordHash');
    next();
  } catch (e) {
    return res.status(401).json({ message: 'Invalid token' });
  }
};



// --- AUTH routes ---
app.post('/api/signup', async (req, res) => {
  const { name, email, password, phone, role, upiId } = req.body;
  if (!email || !password) return res.status(400).json({ message: 'Email and password required' });
  const existing = await User.findOne({ email });
  if (existing) return res.status(400).json({ message: 'Email already registered' });
  const passwordHash = await bcrypt.hash(password, 10);
  const user = new User({ name, email, passwordHash, phone, role, upiId });
  await user.save();
  const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
});

// Get current user info
app.get('/api/me', authMiddleware, async (req, res) => {
  if (!req.user) return res.status(401).json({ message: 'Not authenticated' });
  // req.user was loaded in authMiddleware (without passwordHash)
  res.json({ user: req.user });
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });
  if (!user) return res.status(400).json({ message: 'Invalid credentials' });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(400).json({ message: 'Invalid credentials' });
  const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
});

// --- Grounds (public read) ---
app.get('/api/grounds', async (req, res) => {
  const grounds = await Ground.find({ available: true }).populate('owner', 'name phone email upiId');
  res.json(grounds);
});

// Owner: list all their grounds (available + unavailable)
app.get('/api/grounds/owner', authMiddleware, async (req, res) => {
  if (!req.user || req.user.role !== 'owner') return res.status(403).json({ message: 'Not owner' });
  const grounds = await Ground.find({ owner: req.user._id });
  res.json(grounds);
});



app.get('/api/grounds/:id', async (req, res) => {
  const g = await Ground.findById(req.params.id).populate('owner', 'name phone email upiId');
  if (!g) return res.status(404).json({ message: 'Not found' });
  res.json(g);
});

// --- Owner creates/edits a ground ---
app.post('/api/grounds', authMiddleware, upload.fields([{name:'thumbnail', maxCount:1}, {name:'images', maxCount:10}]), async (req, res) => {
  if (!req.user || req.user.role !== 'owner') return res.status(403).json({ message: 'Not owner' });
  const body = req.body;
  const thumbnail = (req.files['thumbnail'] && req.files['thumbnail'][0]) ? '/uploads/' + req.files['thumbnail'][0].filename : body.thumbnail;
  const images = (req.files['images'] || []).map(f => '/uploads/' + f.filename).concat(body.images ? (Array.isArray(body.images) ? body.images : [body.images]) : []);
  const ground = new Ground({
    title: body.title,
    description: body.description,
    owner: req.user._id,
    thumbnail,
    images,
    price: {
      amount: Number(body.amount) || 0,
      negotiable: body.negotiable === 'true' || body.negotiable === true
    },
    tags_sport: body.tags_sport ? (Array.isArray(body.tags_sport) ? body.tags_sport : body.tags_sport.split(',').map(s=>s.trim())) : [],
    tags_facilities: body.tags_facilities ? (Array.isArray(body.tags_facilities) ? body.tags_facilities : body.tags_facilities.split(',').map(s=>s.trim())) : [],
    location: {
      address: body.address || '',
      lat: body.lat ? Number(body.lat) : undefined,
      lng: body.lng ? Number(body.lng) : undefined
    },
    available: true
  });
  await ground.save();
  res.json(ground);
});

// toggle availability or update
app.patch('/api/grounds/:id', authMiddleware, async (req, res) => {
  const g = await Ground.findById(req.params.id);
  if (!g) return res.status(404).json({ message: 'Not found' });
  if (g.owner.toString() !== req.user._id.toString()) return res.status(403).json({ message: 'Not owner' });
  Object.assign(g, req.body);
  await g.save();
  res.json(g);
});

// --- Book a ground (user) ---
app.post('/api/bookings', authMiddleware, upload.single('paymentScreenshot'), async (req, res) => {
  if (!req.user) return res.status(401).json({ message: 'Not authenticated' });
  const { groundId, amount, from, to } = req.body;
  const ground = await Ground.findById(groundId);
  if (!ground) return res.status(404).json({ message: 'Ground not found' });
  if (!ground.available) return res.status(400).json({ message: 'Ground not available' });
  const booking = new Booking({
    ground: ground._id,
    user: req.user._id,
    owner: ground.owner,
    amount: Number(amount||ground.price.amount),
    timeslot: { from: from ? new Date(from) : null, to: to ? new Date(to) : null },
    paymentScreenshot: req.file ? '/uploads/' + req.file.filename : undefined
  });
  await booking.save();
  // keep ground listed until owner confirms; owner will mark it unavailable on confirmation
  res.json({ message: 'Booking request sent', bookingId: booking._id });
});

// owner: list booking requests for his grounds
// server.js
app.get('/api/bookings/owner', authMiddleware, async (req, res) => {
  if (!req.user || req.user.role !== 'owner') return res.status(403).json({ message: 'Not owner' });
  const bookings = await Booking.find({
    owner: req.user._id,
    status: { $ne: 'confirmed' }   // Exclude confirmed
  }).populate('ground user');
  res.json(bookings);
});


// owner confirms booking
app.post('/api/bookings/:id/confirm', authMiddleware, async (req, res) => {
  if (!req.user || req.user.role !== 'owner') return res.status(403).json({ message: 'Not owner' });
  const booking = await Booking.findById(req.params.id).populate('ground');
  if (!booking) return res.status(404).json({ message: 'Not found' });
  if (booking.owner.toString() !== req.user._id.toString()) return res.status(403).json({ message: 'Not yours' });
  booking.status = 'confirmed';
  await booking.save();
  // set ground unavailable
  const g = await Ground.findById(booking.ground._id);
  g.available = false;
  await g.save();
  res.json({ message: 'Booking confirmed' });
});

// owner rejects booking
// owner rejects booking
app.post('/api/bookings/:id/reject', authMiddleware, async (req, res) => {
  if (!req.user || req.user.role !== 'owner') return res.status(403).json({ message: 'Not owner' });
  const booking = await Booking.findById(req.params.id).populate('ground');
  if (!booking) return res.status(404).json({ message: 'Not found' });

  booking.status = 'rejected';
  await booking.save();

  // ensure ground stays available
  const g = await Ground.findById(booking.ground._id);
  g.available = true;   // 👈 keep it bookable
  await g.save();

  res.json({ message: 'Booking rejected' });
});



// user: view history
app.get('/api/bookings', authMiddleware, async (req, res) => {
  const bookings = await Booking.find({ user: req.user._id }).populate('ground owner');
  res.json(bookings);
});

// --- UPI QR generator (returns dataURL) ---
// expects body: { upiId, name, amount, note }
app.post('/api/upi-qrcode', async (req, res) => {
  const { upiId, name, amount, note } = req.body;
  if (!upiId || !amount) return res.status(400).json({ message: 'upiId and amount required' });
  // UPI deep link spec
  const upiStr = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(name || '')}&am=${encodeURIComponent(amount)}&cu=INR&tn=${encodeURIComponent(note || '')}`;
  try {
    const dataUrl = await QRCode.toDataURL(upiStr);
    res.json({ dataUrl, upiStr });
  } catch (e) {
    res.status(500).json({ message: 'QR generation failed', error: e.message });
  }
});

// catch-all static
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, ()=> console.log('Server running on port', PORT));
