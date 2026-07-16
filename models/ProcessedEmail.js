const mongoose = require('mongoose');

const processedEmailSchema = new mongoose.Schema({
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    index: true
  },
  messageId: {
    type: String,
    required: true
  },
  processedAt: {
    type: Date,
    default: Date.now
  }
});
processedEmailSchema.index(
  { adminId: 1, messageId: 1 },
  { unique: true }
);

module.exports = mongoose.model('ProcessedEmail', processedEmailSchema);