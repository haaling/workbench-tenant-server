const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Company = require('../models/Company');
const authenticateToken = require('../middleware/auth');

const router = express.Router();

const parseExpiresInToSeconds = (expiresIn) => {
  if (typeof expiresIn === 'number') return expiresIn;
  const match = String(expiresIn).match(/^(\d+)(s|m|h|d)$/);
  if (!match) return 7 * 24 * 3600;
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers = { s: 1, m: 60, h: 3600, d: 86400 };
  return value * multipliers[unit];
};

const generateToken = (userId) => {
  return jwt.sign(
    { userId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

const resolveCompanyAccess = async (user) => {
  const role = user.role || 'finance';
  if (role === 'super_admin') {
    return { ok: true, company: null };
  }

  if (!user.companyId) {
    return {
      ok: false,
      statusCode: 403,
      message: '账号未绑定公司，请联系管理员',
      reasonCode: 'COMPANY_REQUIRED'
    };
  }

  const company = await Company.findById(user.companyId).select('_id companyName status expireDate').lean();
  if (!company) {
    return {
      ok: false,
      statusCode: 403,
      message: '所属公司不存在，请联系管理员',
      reasonCode: 'COMPANY_NOT_FOUND'
    };
  }

  if (company.status === 'disabled') {
    return {
      ok: false,
      statusCode: 403,
      message: '公司账号已被停用，请联系管理员',
      reasonCode: 'COMPANY_DISABLED'
    };
  }

  if (company.status === 'expired' || new Date(company.expireDate) <= new Date()) {
    return {
      ok: false,
      statusCode: 403,
      message: '公司服务已到期，请续费后再登录',
      reasonCode: 'COMPANY_EXPIRED'
    };
  }

  return { ok: true, company };
};

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: '请提供邮箱和密码'
      });
    }

    const user = await User.findOne({ email: String(email).trim().toLowerCase() });
    if (!user) {
      return res.status(401).json({
        success: false,
        message: '邮箱或密码错误'
      });
    }

    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: '邮箱或密码错误'
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: '账户已被禁用'
      });
    }

    const companyAccess = await resolveCompanyAccess(user);
    if (!companyAccess.ok) {
      return res.status(companyAccess.statusCode).json({
        success: false,
        message: companyAccess.message,
        reasonCode: companyAccess.reasonCode
      });
    }

    user.lastLoginAt = Date.now();
    await user.save();

    const token = generateToken(user._id);
    const accessExpiresInSeconds = parseExpiresInToSeconds(process.env.JWT_EXPIRES_IN || '7d');
    const accessExpiresAt = new Date(Date.now() + accessExpiresInSeconds * 1000).toISOString();

    return res.json({
      success: true,
      message: '登录成功',
      data: {
        user: {
          ...user.toJSON(),
          role: user.role || 'finance',
          companyId: user.companyId || null
        },
        company: companyAccess.company,
        token,
        expiresIn: accessExpiresInSeconds,
        expiresAt: accessExpiresAt
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: '登录失败',
      error: error.message
    });
  }
});

router.get('/verify', authenticateToken, async (req, res) => {
  return res.json({
    success: true,
    data: {
      user: req.user
    }
  });
});

module.exports = router;