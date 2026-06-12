require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const connectDB = require('./config/database');

const app = express();

const resolveTrustProxy = () => {
  const raw = process.env.TRUST_PROXY;
  if (!raw) return 1;
  if (raw === 'true') return 1;
  if (raw === 'false') return false;

  const asNumber = Number(raw);
  if (Number.isInteger(asNumber) && asNumber >= 0) {
    return asNumber;
  }

  return raw;
};

app.set('trust proxy', resolveTrustProxy());

connectDB().catch((err) => {
  console.error('MongoDB 连接失败:', err.message);
  process.exit(1);
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((item) => item.trim()).filter(Boolean)
  : [];

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.length === 0 || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  maxAge: Math.max(60, parseInt(process.env.CORS_MAX_AGE_SECONDS || '600', 10)),
  optionsSuccessStatus: 204
}));

app.options('*', (req, res) => {
  res.sendStatus(200);
});

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/health' || req.method === 'OPTIONS',
  message: {
    success: false,
    message: '请求过于频繁，请稍后再试'
  }
});

app.use('/api/', limiter);
app.use('/api/auth', require('./routes/auth'));
app.use('/api/tenant', require('./routes/tenant'));

app.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'workbench-tenant-server',
    timestamp: new Date().toISOString()
  });
});

app.get('/', (req, res) => {
  res.json({
    success: true,
    message: '工作台独立后端服务',
    endpoints: {
      auth: '/api/auth',
      tenant: '/api/tenant',
      health: '/health'
    }
  });
});

app.use((req, res) => {
  res.status(404).json({ success: false, message: '请求的资源不存在' });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: '服务器内部错误',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

const PORT = process.env.PORT || 3100;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`workbench-tenant-server running on port ${PORT}`);
});

module.exports = app;
