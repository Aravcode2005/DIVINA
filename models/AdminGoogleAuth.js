const mongoose = require('mongoose');

const adminGoogleAuthSchema = new mongoose.Schema({
  adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'adminmodel', required: true, unique: true },
  email: String,
  tokens: Object
});

module.exports = mongoose.model('AdminGoogleAuth', adminGoogleAuthSchema);
