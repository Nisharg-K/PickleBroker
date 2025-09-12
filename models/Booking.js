const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
  ground: { type: mongoose.Schema.Types.ObjectId, ref: 'Ground', required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amount: Number,
  timeslot: {
    from: Date,
    to: Date
  },
  paymentScreenshot: String,
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'rejected'],
    default: 'pending'
  }
}, { timestamps: true });

module.exports = mongoose.model('Booking', bookingSchema);
