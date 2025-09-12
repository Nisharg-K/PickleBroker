const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const UserSchema = new Schema({
  name: String,
  email: { type: String, unique: true, required: true },
  passwordHash: { type: String, required: true },
  phone: String,
  role: { type: String, enum: ['user','owner'], default: 'user' },
  upiId: String // owners can store UPI id when listing
}, { timestamps: true });

module.exports = mongoose.model('User', UserSchema);
