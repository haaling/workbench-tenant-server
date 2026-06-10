const jwt = require('jsonwebtoken');
const User = require('../models/User');

const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ success: false, message: '未提供认证令牌' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId)
      .select('_id username email isActive role companyId')
      .lean();

    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, message: '用户不存在或已被禁用' });
    }

    req.user = user;
    req.userId = decoded.userId;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(403).json({ success: false, message: '令牌已过期' });
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(403).json({ success: false, message: '无效的令牌' });
    }
    return res.status(500).json({ success: false, message: '服务器错误', error: error.message });
  }
};

module.exports = authenticateToken;
