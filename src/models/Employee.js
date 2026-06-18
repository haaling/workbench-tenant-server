const mongoose = require('mongoose');

const employeeSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  subsidiary: {
    type: String,
    trim: true,
    default: '总公司'
  },
  employeeCode: {
    type: String,
    trim: true,
    default: undefined,
    set: (value) => {
      const normalized = String(value || '').trim();
      return normalized || undefined;
    }
  },
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  },
  notes: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

employeeSchema.index({ companyId: 1, name: 1 });
employeeSchema.index({ companyId: 1, subsidiary: 1, status: 1 });
employeeSchema.index(
  { companyId: 1, employeeCode: 1 },
  { unique: true, partialFilterExpression: { employeeCode: { $type: 'string', $gt: '' } } }
);

module.exports = mongoose.model('Employee', employeeSchema);
