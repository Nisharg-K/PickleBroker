const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const GroundSchema = new Schema({
  title: { type: String, required: true },
  description: String,
  owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  thumbnail: String,
  images: [String],
  price: {
    amount: Number,
    currency: { type: String, default: 'INR' },
    negotiable: { type: Boolean, default: false }
  },
  tags_sport: [String],
  tags_facilities: [String],
  location: {
    address: String,
    lat: Number,
    lng: Number
  },
  available: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Ground', GroundSchema);
