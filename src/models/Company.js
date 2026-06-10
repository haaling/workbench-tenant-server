const mongoose = require('mongoose');

const companySchema = new mongoose.Schema({
  companyName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  status: {
    type: String,
    enum: ['active', 'disabled', 'expired'],
    default: 'active'
  },
  expireDate: {
    type: Date,
    required: true
  },
  maxUsers: {
    type: Number,
    default: 5,
    min: 1,
    max: 500
  },
  notes: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

companySchema.index({ companyName: 1 }, { unique: true });
companySchema.index({ status: 1, expireDate: 1 });

module.exports = mongoose.model('Company', companySchema);
