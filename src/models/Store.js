const mongoose = require('mongoose');

const storeSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
    index: true
  },
  storeName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  platform: {
    type: String,
    default: 'aliexpress',
    trim: true,
    maxlength: 30
  },
  storeIdOnPlatform: {
    type: String,
    trim: true,
    default: ''
  },
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  },
  employeeIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee'
  }],
  metadata: {
    type: Object,
    default: {}
  }
}, {
  timestamps: true
});

storeSchema.index({ companyId: 1, platform: 1, storeName: 1 });
storeSchema.index({ companyId: 1, storeIdOnPlatform: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Store', storeSchema);
