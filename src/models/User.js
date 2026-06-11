const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const WORKBENCH_USER_COLLECTION = process.env.WORKBENCH_USER_COLLECTION || 'workbench_users';

const userSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    default: null,
    index: true
  },
  role: {
    type: String,
    enum: ['super_admin', 'company_admin', 'finance', 'readonly', 'employee'],
    default: 'finance',
    index: true
  },
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 50
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  lastLoginAt: {
    type: Date
  },
  isActive: {
    type: Boolean,
    default: true
  },
  income: {
    type: Number,
    default: 0,
    min: 0
  }
});

userSchema.index({ createdAt: -1 });
userSchema.index({ income: 1 });
userSchema.index({ companyId: 1, role: 1, isActive: 1 });

userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.toJSON = function() {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

module.exports = mongoose.model('User', userSchema, WORKBENCH_USER_COLLECTION);
