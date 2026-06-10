const mongoose = require('mongoose');

const connectDB = async () => {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI 未配置');
  }

  const conn = await mongoose.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000,
    maxPoolSize: 50,
    minPoolSize: 10
  });

  console.log(`MongoDB connected: ${conn.connection.host}`);
};

module.exports = connectDB;
