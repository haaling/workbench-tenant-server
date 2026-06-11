const mongoose = require('mongoose');

const performanceWorkflowSchema = new mongoose.Schema({
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
  period: {
    type: String,
    required: true,
    trim: true
  },
  submittedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  assignedToUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true
  },
  confirmedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  archivedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  status: {
    type: String,
    enum: ['draft', 'pushed', 'confirmed', 'archived'],
    default: 'draft',
    index: true
  },
  summary: {
    type: Object,
    default: {}
  },
  calculatedRows: {
    type: [Object],
    default: []
  },
  uploadedRows: {
    type: [Object],
    default: []
  },
  rowCountCalculated: {
    type: Number,
    default: 0
  },
  rowCountUploaded: {
    type: Number,
    default: 0
  },
  pushNote: {
    type: String,
    default: ''
  },
  pushedAt: {
    type: Date,
    default: null
  },
  confirmedAt: {
    type: Date,
    default: null
  },
  archivedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

performanceWorkflowSchema.index({ companyId: 1, storeId: 1, period: 1, createdAt: -1 });

module.exports = mongoose.model('PerformanceWorkflow', performanceWorkflowSchema);
