const mongoose = require('mongoose');

const connectDB = async () => {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI 未配置');
  }

  const dbName = process.env.WORKBENCH_DB_NAME || 'workbench_tenant';

  const conn = await mongoose.connect(process.env.MONGODB_URI, {
    dbName,
    appName: 'workbench-tenant-server',
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000,
    maxPoolSize: 50,
    minPoolSize: 10
  });

  console.log(`MongoDB connected: ${conn.connection.host}/${conn.connection.name}`);
};

module.exports = connectDB;
