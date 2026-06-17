#!/usr/bin/env node

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const readline = require('readline');

// 创建交互式输入接口
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// 隐藏输入的密码
const promptHidden = (question) => {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    stdin.resume();
    stdin.setEncoding('utf8');
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
};

// 普通提示
const prompt = (question) => {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
};

async function promptForCredentials() {
  console.log('\n📝 创建超级管理员账户\n');
  
  const username = await prompt('请输入用户名 (至少3个字符): ');
  if (!username || username.trim().length < 3) {
    console.error('❌ 用户名至少需要3个字符');
    rl.close();
    process.exit(1);
  }

  const email = await prompt('请输入邮箱: ');
  if (!email || !email.includes('@')) {
    console.error('❌ 请输入有效的邮箱地址');
    rl.close();
    process.exit(1);
  }

  const password = await promptHidden('请输入密码 (至少6个字符): ');
  if (!password || password.length < 6) {
    console.error('❌ 密码至少需要6个字符');
    rl.close();
    process.exit(1);
  }

  const passwordConfirm = await promptHidden('请再次输入密码以确认: ');
  if (password !== passwordConfirm) {
    console.error('❌ 两次输入的密码不一致');
    rl.close();
    process.exit(1);
  }

  rl.close();
  return { username: username.trim(), email: email.trim(), password };
}

const WORKBENCH_USER_COLLECTION = process.env.WORKBENCH_USER_COLLECTION || 'workbench_users';

const userSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    default: null
  },
  role: {
    type: String,
    enum: ['super_admin', 'company_admin', 'finance', 'branch_manager', 'team_lead', 'employee', 'readonly'],
    default: 'finance'
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

const User = mongoose.model('User', userSchema, WORKBENCH_USER_COLLECTION);

async function createSuperAdmin() {
  try {
    // 获取用户输入
    const { username, email, password } = await promptForCredentials();

    const mongoUrl = process.env.MONGODB_URI;
    if (!mongoUrl) {
      console.error('❌ 错误: 缺少 MONGODB_URI 环境变量');
      process.exit(1);
    }

    console.log('\n🔄 正在连接到 MongoDB...');
    await mongoose.connect(mongoUrl, {
      dbName: process.env.WORKBENCH_DB_NAME || 'workbench_tenant'
    });

    console.log('🔍 正在检查是否已存在同名用户...');
    const existing = await User.findOne({ $or: [{ username }, { email }] });
    if (existing) {
      console.error(`❌ 错误: 用户 ${username} 或邮箱 ${email} 已存在`);
      await mongoose.disconnect();
      process.exit(1);
    }

    console.log('💾 正在创建超级管理员账户...');
    const newUser = new User({
      username,
      email,
      password,
      role: 'super_admin',
      isActive: true,
      companyId: null
    });

    await newUser.save();

    console.log('\n✅ 超级管理员账户创建成功！');
    console.log(`   用户名: ${username}`);
    console.log(`   邮箱: ${email}`);
    console.log(`   角色: super_admin`);
    console.log(`   状态: 已激活\n`);

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ 创建失败:', error.message);
    if (mongoose.connection.readyState) {
      await mongoose.disconnect();
    }
    process.exit(1);
  }
}

createSuperAdmin().catch(error => {
  console.error('❌ 未捕获的错误:', error.message);
  process.exit(1);
});
