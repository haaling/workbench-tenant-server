require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../src/models/User');

const parseArg = (name) => {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length).trim() : '';
};

const username = parseArg('username') || process.env.SUPER_ADMIN_USERNAME || '';
const email = (parseArg('email') || process.env.SUPER_ADMIN_EMAIL || '').toLowerCase();
const password = parseArg('password') || process.env.SUPER_ADMIN_PASSWORD || '';

const usage = () => {
  console.log('Usage:');
  console.log('  npm run create:super-admin -- --username=admin --email=admin@example.com --password=YourPass123');
  console.log('Or set env vars: SUPER_ADMIN_USERNAME, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD');
};

const main = async () => {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI 未配置，无法连接数据库');
  }

  const dbName = process.env.WORKBENCH_DB_NAME || 'workbench_tenant';

  if (!username || !email || !password) {
    usage();
    throw new Error('缺少必填参数：username / email / password');
  }

  await mongoose.connect(process.env.MONGODB_URI, {
    dbName,
    appName: 'workbench-tenant-server-script',
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000,
    maxPoolSize: 10,
    minPoolSize: 1
  });

  const byEmail = await User.findOne({ email });
  const byUsername = await User.findOne({ username });

  if (byEmail && String(byEmail.username) !== String(username)) {
    throw new Error(`邮箱 ${email} 已被用户名 ${byEmail.username} 使用`);
  }

  if (byUsername && String(byUsername.email) !== String(email)) {
    throw new Error(`用户名 ${username} 已被邮箱 ${byUsername.email} 使用`);
  }

  let user = byEmail || byUsername;
  let action = 'created';

  if (!user) {
    user = new User({
      username,
      email,
      password,
      role: 'super_admin',
      companyId: null,
      isActive: true
    });
  } else {
    action = 'updated';
    user.username = username;
    user.email = email;
    user.password = password;
    user.role = 'super_admin';
    user.companyId = null;
    user.isActive = true;
  }

  await user.save();

  console.log(JSON.stringify({
    success: true,
    action,
    user: {
      id: String(user._id),
      username: user.username,
      email: user.email,
      role: user.role,
      companyId: user.companyId,
      isActive: user.isActive
    }
  }, null, 2));
};

main()
  .catch((error) => {
    console.error('创建超级管理员失败:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await mongoose.disconnect();
    } catch (error) {
      // ignore disconnect error
    }
  });
