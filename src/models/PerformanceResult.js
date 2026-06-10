const mongoose = require('mongoose');

const performanceResultSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
    index: true
  },
  storeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Store',
    required: true,
    index: true
  },
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  period: {
    type: String,
    required: true,
    trim: true
  },
  source: {
    type: String,
    default: 'web-local-calculator'
  },
  summary: {
    type: Object,
    default: {}
  },
  aggregatedRows: {
    type: [Object],
    default: []
  },
  rowCount: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

performanceResultSchema.index({ companyId: 1, storeId: 1, period: 1, createdAt: -1 });

module.exports = mongoose.model('PerformanceResult', performanceResultSchema);
