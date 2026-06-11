const express = require('express');
const mongoose = require('mongoose');
const authenticateToken = require('../middleware/auth');
const User = require('../models/User');
const Company = require('../models/Company');
const Store = require('../models/Store');
const Employee = require('../models/Employee');
const PerformanceResult = require('../models/PerformanceResult');

const router = express.Router();

const VALID_ROLES = ['super_admin', 'company_admin', 'finance', 'branch_manager', 'team_lead', 'employee', 'readonly'];

router.use(authenticateToken);

const isSuperAdmin = (user) => String(user?.role || '') === 'super_admin';
const isCompanyAdmin = (user) => String(user?.role || '') === 'company_admin';

const normalizeObjectId = (value) => {
  const text = String(value || '').trim();
  if (!text || !mongoose.Types.ObjectId.isValid(text)) return null;
  return text;
};

const canManageTenant = (user) => isSuperAdmin(user) || isCompanyAdmin(user);

const ensureTenantManager = (req, res) => {
  if (!canManageTenant(req.user)) {
    res.status(403).json({ success: false, message: '无权限访问，仅管理员可操作' });
    return false;
  }
  return true;
};

const resolveTargetCompanyId = (req, rawCompanyId) => {
  if (isSuperAdmin(req.user)) {
    return normalizeObjectId(rawCompanyId);
  }
  return normalizeObjectId(req.user.companyId);
};

const ensureCompanyAccess = (req, companyId) => {
  if (isSuperAdmin(req.user)) return true;
  return String(req.user.companyId || '') === String(companyId || '');
};

router.get('/me', async (req, res) => {
  return res.json({
    success: true,
    data: {
      user: {
        id: req.user._id,
        username: req.user.username,
        email: req.user.email,
        role: req.user.role || 'finance',
        companyId: req.user.companyId || null,
        isActive: req.user.isActive
      }
    }
  });
});

router.post('/companies', async (req, res) => {
  if (!isSuperAdmin(req.user)) {
    return res.status(403).json({ success: false, message: '仅超级管理员可创建公司' });
  }

  try {
    const {
      companyName,
      expireDate,
      maxUsers = 5,
      notes = '',
      adminUsername,
      adminPassword,
      adminEmail
    } = req.body || {};

    if (!companyName || !expireDate || !adminUsername || !adminPassword) {
      return res.status(400).json({
        success: false,
        message: 'companyName、expireDate、adminUsername、adminPassword 为必填项'
      });
    }

    const normalizedAdminUsername = String(adminUsername).trim();
    const normalizedAdminEmail = adminEmail
      ? String(adminEmail).trim().toLowerCase()
      : `${normalizedAdminUsername}@workbench.local`;

    if (normalizedAdminUsername.length < 3) {
      return res.status(400).json({ success: false, message: '管理员账号长度至少 3 位' });
    }

    if (String(adminPassword).length < 6) {
      return res.status(400).json({ success: false, message: '管理员密码长度至少 6 位' });
    }

    const expireAt = new Date(expireDate);
    if (Number.isNaN(expireAt.getTime())) {
      return res.status(400).json({ success: false, message: 'expireDate 格式无效' });
    }

    const existingAdmin = await User.findOne({
      $or: [
        { username: normalizedAdminUsername },
        { email: normalizedAdminEmail }
      ]
    }).lean();
    if (existingAdmin) {
      return res.status(400).json({ success: false, message: '管理员账号或邮箱已存在' });
    }

    const company = await Company.create({
      companyName: String(companyName).trim(),
      expireDate: expireAt,
      maxUsers: Number(maxUsers) || 5,
      notes: String(notes || '')
    });

    try {
      const adminUser = new User({
        username: normalizedAdminUsername,
        email: normalizedAdminEmail,
        password: String(adminPassword),
        role: 'company_admin',
        companyId: company._id,
        isActive: true
      });
      await adminUser.save();

      return res.json({
        success: true,
        message: '公司及管理员创建成功',
        data: {
          company,
          adminUser: {
            id: adminUser._id,
            username: adminUser.username,
            email: adminUser.email,
            role: adminUser.role,
            companyId: adminUser.companyId,
            isActive: adminUser.isActive
          }
        }
      });
    } catch (adminError) {
      await Company.findByIdAndDelete(company._id).catch(() => null);
      return res.status(500).json({ success: false, message: '创建公司管理员失败', error: adminError.message });
    }
  } catch (error) {
    if (error && error.code === 11000) {
      return res.status(400).json({ success: false, message: '公司名称已存在' });
    }
    return res.status(500).json({ success: false, message: '创建公司失败', error: error.message });
  }
});

router.get('/companies', async (req, res) => {
  if (!canManageTenant(req.user)) {
    return res.status(403).json({ success: false, message: '无权限访问，仅管理员可操作' });
  }

  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, parseInt(req.query.limit, 10) || 50);
    const skip = (page - 1) * limit;

    const query = isSuperAdmin(req.user)
      ? {}
      : { _id: normalizeObjectId(req.user.companyId) };

    const [companies, total] = await Promise.all([
      Company.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Company.countDocuments(query)
    ]);

    const companyIds = companies.map((item) => item._id);
    const userAgg = companyIds.length > 0
      ? await User.aggregate([
        { $match: { companyId: { $in: companyIds } } },
        {
          $group: {
            _id: '$companyId',
            totalUsers: { $sum: 1 },
            activeUsers: {
              $sum: {
                $cond: ['$isActive', 1, 0]
              }
            },
            adminUsers: {
              $sum: {
                $cond: [{ $eq: ['$role', 'company_admin'] }, 1, 0]
              }
            }
          }
        }
      ])
      : [];

    const userAggMap = new Map(userAgg.map((item) => [String(item._id), item]));
    const now = new Date();
    const companiesWithStats = companies.map((company) => {
      const agg = userAggMap.get(String(company._id));
      const expireDate = company.expireDate ? new Date(company.expireDate) : null;

      return {
        ...company,
        totalUsers: agg?.totalUsers || 0,
        activeUsers: agg?.activeUsers || 0,
        adminUsers: agg?.adminUsers || 0,
        isExpiredByDate: expireDate ? expireDate <= now : false
      };
    });

    const statusStats = companiesWithStats.reduce((acc, item) => {
      const key = item.status || 'active';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, { active: 0, disabled: 0, expired: 0 });

    return res.json({
      success: true,
      data: {
        companies: companiesWithStats,
        stats: {
          totalCompanies: total,
          activeCompanies: statusStats.active || 0,
          disabledCompanies: statusStats.disabled || 0,
          expiredCompanies: statusStats.expired || 0
        },
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: '获取公司列表失败', error: error.message });
  }
});

router.patch('/companies/:companyId', async (req, res) => {
  if (!canManageTenant(req.user)) {
    return res.status(403).json({ success: false, message: '无权限访问，仅管理员可操作' });
  }

  try {
    const companyId = normalizeObjectId(req.params.companyId);
    if (!companyId) {
      return res.status(400).json({ success: false, message: 'companyId 无效' });
    }

    if (!ensureCompanyAccess(req, companyId)) {
      return res.status(403).json({ success: false, message: '无权编辑其他公司的信息' });
    }

    const patch = {};
    const editableFields = isSuperAdmin(req.user)
      ? ['companyName', 'status', 'notes']
      : ['companyName', 'notes'];
    editableFields.forEach((key) => {
      if (req.body && req.body[key] !== undefined) patch[key] = req.body[key];
    });

    if (isSuperAdmin(req.user) && req.body && req.body.expireDate !== undefined) {
      const d = new Date(req.body.expireDate);
      if (Number.isNaN(d.getTime())) {
        return res.status(400).json({ success: false, message: 'expireDate 格式无效' });
      }
      patch.expireDate = d;
    }

    if (isSuperAdmin(req.user) && req.body && req.body.maxUsers !== undefined) {
      const maxUsers = Number(req.body.maxUsers);
      if (!Number.isFinite(maxUsers) || maxUsers < 1) {
        return res.status(400).json({ success: false, message: 'maxUsers 必须大于 0' });
      }
      patch.maxUsers = maxUsers;
    }

    const company = await Company.findByIdAndUpdate(companyId, { $set: patch }, { new: true });
    if (!company) {
      return res.status(404).json({ success: false, message: '公司不存在' });
    }

    return res.json({ success: true, message: '公司更新成功', data: { company } });
  } catch (error) {
    return res.status(500).json({ success: false, message: '更新公司失败', error: error.message });
  }
});

router.patch('/companies/:companyId/subsidiaries', async (req, res) => {
  if (!canManageTenant(req.user)) {
    return res.status(403).json({ success: false, message: '无权限访问，仅管理员可操作' });
  }

  try {
    const companyId = normalizeObjectId(req.params.companyId);
    if (!companyId) {
      return res.status(400).json({ success: false, message: 'companyId 无效' });
    }

    if (!ensureCompanyAccess(req, companyId)) {
      return res.status(403).json({ success: false, message: '无权编辑其他公司的信息' });
    }

    const inputSubsidiaries = Array.isArray(req.body?.subsidiaries) ? req.body.subsidiaries : [];
    const subsidiaries = Array.from(new Set(
      inputSubsidiaries
        .map((item) => String(item || '').trim())
        .filter(Boolean)
    ));

    const company = await Company.findById(companyId).lean();
    if (!company) {
      return res.status(404).json({ success: false, message: '公司不存在' });
    }

    let extras = {};
    if (company.notes) {
      try {
        extras = JSON.parse(String(company.notes));
      } catch (_) {
        extras = {};
      }
    }

    const nextNotes = JSON.stringify({
      ...(extras && typeof extras === 'object' ? extras : {}),
      subsidiaries
    });

    const updated = await Company.findByIdAndUpdate(
      companyId,
      { $set: { notes: nextNotes } },
      { new: true }
    );

    return res.json({ success: true, message: '分公司信息更新成功', data: { company: updated } });
  } catch (error) {
    return res.status(500).json({ success: false, message: '更新分公司信息失败', error: error.message });
  }
});

router.post('/users', async (req, res) => {
  if (!ensureTenantManager(req, res)) return;

  try {
    const { username, email, password, role = 'finance', companyId: bodyCompanyId } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'username、password 为必填项' });
    }

    const normalizedUsername = String(username).trim();
    const normalizedEmail = String(email || '').trim().toLowerCase() || `${normalizedUsername}@workbench.local`;

    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ success: false, message: 'role 无效' });
    }

    if (isCompanyAdmin(req.user) && role === 'super_admin') {
      return res.status(403).json({ success: false, message: '公司管理员不能创建超级管理员' });
    }

    const targetCompanyId = resolveTargetCompanyId(req, bodyCompanyId);
    if (!targetCompanyId) {
      return res.status(400).json({ success: false, message: 'companyId 无效或缺失' });
    }

    const company = await Company.findById(targetCompanyId).lean();
    if (!company) {
      return res.status(404).json({ success: false, message: '公司不存在' });
    }

    const existingUser = await User.findOne({ $or: [{ email: normalizedEmail }, { username: normalizedUsername }] }).lean();
    if (existingUser) {
      return res.status(400).json({ success: false, message: '用户名或邮箱已存在' });
    }

    const user = new User({
      username: normalizedUsername,
      email: normalizedEmail,
      password,
      role,
      companyId: targetCompanyId,
      isActive: true
    });
    await user.save();

    return res.json({
      success: true,
      message: '用户创建成功',
      data: {
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          role: user.role,
          companyId: user.companyId,
          isActive: user.isActive
        }
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: '创建用户失败', error: error.message });
  }
});

router.get('/users', async (req, res) => {
  if (!ensureTenantManager(req, res)) return;

  try {
    const filter = isSuperAdmin(req.user)
      ? {}
      : { companyId: normalizeObjectId(req.user.companyId) };

    const users = await User.find(filter)
      .select('-password')
      .sort({ createdAt: -1 })
      .lean();

    const companyIds = Array.from(new Set(
      users
        .map((item) => item.companyId)
        .filter((item) => item)
        .map((item) => String(item))
    ));

    const companies = companyIds.length > 0
      ? await Company.find({ _id: { $in: companyIds } })
        .select('_id companyName status expireDate maxUsers')
        .lean()
      : [];
    const companyMap = new Map(companies.map((item) => [String(item._id), item]));

    const usersWithCompany = users.map((user) => {
      const company = user.companyId ? companyMap.get(String(user.companyId)) : null;
      return {
        ...user,
        company: company ? {
          _id: company._id,
          companyName: company.companyName,
          status: company.status,
          expireDate: company.expireDate,
          maxUsers: company.maxUsers
        } : null
      };
    });

    return res.json({ success: true, data: { users: usersWithCompany } });
  } catch (error) {
    return res.status(500).json({ success: false, message: '获取用户列表失败', error: error.message });
  }
});

router.patch('/users/:userId', async (req, res) => {
  if (!ensureTenantManager(req, res)) return;

  try {
    const userId = normalizeObjectId(req.params.userId);
    if (!userId) {
      return res.status(400).json({ success: false, message: 'userId 无效' });
    }

    const targetUser = await User.findById(userId);
    if (!targetUser) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }

    if (!ensureCompanyAccess(req, targetUser.companyId)) {
      return res.status(403).json({ success: false, message: '无权修改其他公司的用户' });
    }

    const patch = {};
    if (req.body && req.body.isActive !== undefined) {
      patch.isActive = !!req.body.isActive;
    }

    if (req.body && req.body.role !== undefined) {
      if (!VALID_ROLES.includes(req.body.role)) {
        return res.status(400).json({ success: false, message: 'role 无效' });
      }
      if (isCompanyAdmin(req.user) && req.body.role === 'super_admin') {
        return res.status(403).json({ success: false, message: '公司管理员不能设置超级管理员角色' });
      }
      patch.role = req.body.role;
    }

    if (req.body && req.body.companyId !== undefined) {
      if (!isSuperAdmin(req.user)) {
        return res.status(403).json({ success: false, message: '仅超级管理员可调整用户公司归属' });
      }
      const companyId = normalizeObjectId(req.body.companyId);
      if (!companyId) {
        return res.status(400).json({ success: false, message: 'companyId 无效' });
      }
      patch.companyId = companyId;
    }

    const user = await User.findByIdAndUpdate(userId, { $set: patch }, { new: true })
      .select('-password')
      .lean();

    return res.json({ success: true, message: '用户更新成功', data: { user } });
  } catch (error) {
    return res.status(500).json({ success: false, message: '更新用户失败', error: error.message });
  }
});

router.post('/stores', async (req, res) => {
  if (!ensureTenantManager(req, res)) return;

  try {
    const {
      companyId: bodyCompanyId,
      storeName,
      platform = 'aliexpress',
      storeIdOnPlatform = '',
      metadata = {}
    } = req.body || {};

    if (!storeName) {
      return res.status(400).json({ success: false, message: 'storeName 为必填项' });
    }

    const companyId = resolveTargetCompanyId(req, bodyCompanyId);
    if (!companyId) {
      return res.status(400).json({ success: false, message: 'companyId 无效或缺失' });
    }

    const company = await Company.findById(companyId).lean();
    if (!company) {
      return res.status(404).json({ success: false, message: '公司不存在' });
    }

    const store = await Store.create({
      companyId,
      storeName: String(storeName).trim(),
      platform: String(platform).trim() || 'aliexpress',
      storeIdOnPlatform: String(storeIdOnPlatform || '').trim(),
      metadata
    });

    return res.json({ success: true, message: '店铺创建成功', data: { store } });
  } catch (error) {
    if (error && error.code === 11000) {
      return res.status(400).json({ success: false, message: '店铺平台ID已存在' });
    }
    return res.status(500).json({ success: false, message: '创建店铺失败', error: error.message });
  }
});

router.get('/stores', async (req, res) => {
  if (!ensureTenantManager(req, res)) return;

  try {
    const { companyId: qCompanyId, keyword = '' } = req.query;
    const companyId = isSuperAdmin(req.user)
      ? normalizeObjectId(qCompanyId)
      : normalizeObjectId(req.user.companyId);

    const query = {};
    if (companyId) {
      query.companyId = companyId;
    }
    if (keyword) {
      query.storeName = { $regex: String(keyword).trim(), $options: 'i' };
    }

    const stores = await Store.find(query)
      .populate('employeeIds', 'name employeeCode status')
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ success: true, data: { stores } });
  } catch (error) {
    return res.status(500).json({ success: false, message: '获取店铺列表失败', error: error.message });
  }
});

router.patch('/stores/:storeId', async (req, res) => {
  if (!ensureTenantManager(req, res)) return;

  try {
    const storeId = normalizeObjectId(req.params.storeId);
    if (!storeId) {
      return res.status(400).json({ success: false, message: 'storeId 无效' });
    }

    const current = await Store.findById(storeId).lean();
    if (!current) {
      return res.status(404).json({ success: false, message: '店铺不存在' });
    }

    if (!ensureCompanyAccess(req, current.companyId)) {
      return res.status(403).json({ success: false, message: '无权编辑其他公司的店铺' });
    }

    const patch = {};
    ['storeName', 'platform', 'storeIdOnPlatform', 'status', 'metadata'].forEach((key) => {
      if (req.body && req.body[key] !== undefined) {
        patch[key] = req.body[key];
      }
    });

    if (req.body && req.body.companyId !== undefined) {
      if (!isSuperAdmin(req.user)) {
        return res.status(403).json({ success: false, message: '仅超级管理员可调整店铺所属公司' });
      }
      const targetCompanyId = normalizeObjectId(req.body.companyId);
      if (!targetCompanyId) {
        return res.status(400).json({ success: false, message: 'companyId 无效' });
      }
      patch.companyId = targetCompanyId;
    }

    const store = await Store.findByIdAndUpdate(storeId, { $set: patch }, { new: true })
      .populate('employeeIds', 'name employeeCode status')
      .lean();

    return res.json({ success: true, message: '店铺更新成功', data: { store } });
  } catch (error) {
    return res.status(500).json({ success: false, message: '更新店铺失败', error: error.message });
  }
});

router.post('/employees', async (req, res) => {
  if (!ensureTenantManager(req, res)) return;

  try {
    const { companyId: bodyCompanyId, name, employeeCode = '', notes = '' } = req.body || {};
    if (!name) {
      return res.status(400).json({ success: false, message: 'name 为必填项' });
    }

    const companyId = resolveTargetCompanyId(req, bodyCompanyId);
    if (!companyId) {
      return res.status(400).json({ success: false, message: 'companyId 无效或缺失' });
    }

    const employee = await Employee.create({
      companyId,
      name: String(name).trim(),
      employeeCode: String(employeeCode || '').trim(),
      notes: String(notes || '')
    });

    return res.json({ success: true, message: '员工创建成功', data: { employee } });
  } catch (error) {
    if (error && error.code === 11000) {
      return res.status(400).json({ success: false, message: '员工编号已存在' });
    }
    return res.status(500).json({ success: false, message: '创建员工失败', error: error.message });
  }
});

router.get('/employees', async (req, res) => {
  if (!ensureTenantManager(req, res)) return;

  try {
    const { companyId: qCompanyId } = req.query;
    const companyId = isSuperAdmin(req.user)
      ? normalizeObjectId(qCompanyId)
      : normalizeObjectId(req.user.companyId);

    const query = companyId ? { companyId } : {};
    const employees = await Employee.find(query).sort({ createdAt: -1 }).lean();

    return res.json({ success: true, data: { employees } });
  } catch (error) {
    return res.status(500).json({ success: false, message: '获取员工列表失败', error: error.message });
  }
});

router.put('/stores/:storeId/employees', async (req, res) => {
  if (!ensureTenantManager(req, res)) return;

  try {
    const storeId = normalizeObjectId(req.params.storeId);
    if (!storeId) {
      return res.status(400).json({ success: false, message: 'storeId 无效' });
    }

    const store = await Store.findById(storeId);
    if (!store) {
      return res.status(404).json({ success: false, message: '店铺不存在' });
    }

    if (!ensureCompanyAccess(req, store.companyId)) {
      return res.status(403).json({ success: false, message: '无权操作其他公司的店铺' });
    }

    const employeeIds = Array.isArray(req.body?.employeeIds)
      ? req.body.employeeIds.map(normalizeObjectId).filter(Boolean)
      : [];

    if (employeeIds.length > 0) {
      const validCount = await Employee.countDocuments({
        _id: { $in: employeeIds },
        companyId: store.companyId,
        status: 'active'
      });
      if (validCount !== employeeIds.length) {
        return res.status(400).json({ success: false, message: '存在无效员工，或员工不属于该公司' });
      }
    }

    store.employeeIds = employeeIds;
    await store.save();

    const fullStore = await Store.findById(storeId)
      .populate('employeeIds', 'name employeeCode status')
      .lean();

    return res.json({ success: true, message: '店铺员工绑定更新成功', data: { store: fullStore } });
  } catch (error) {
    return res.status(500).json({ success: false, message: '更新店铺员工绑定失败', error: error.message });
  }
});

router.post('/performance/final-results', async (req, res) => {
  if (!ensureTenantManager(req, res)) return;

  try {
    const { storeId, period, summary = {}, aggregatedRows = [] } = req.body || {};
    const normalizedStoreId = normalizeObjectId(storeId);
    if (!normalizedStoreId || !period) {
      return res.status(400).json({ success: false, message: 'storeId 和 period 为必填项' });
    }

    if (!Array.isArray(aggregatedRows) || aggregatedRows.length === 0) {
      return res.status(400).json({ success: false, message: 'aggregatedRows 必须为非空数组' });
    }

    if (aggregatedRows.length > 50000) {
      return res.status(400).json({ success: false, message: '单次上传行数过大，请控制在 50000 行以内' });
    }

    const store = await Store.findById(normalizedStoreId).lean();
    if (!store) {
      return res.status(404).json({ success: false, message: '店铺不存在' });
    }
    if (!ensureCompanyAccess(req, store.companyId)) {
      return res.status(403).json({ success: false, message: '无权上传到其他公司的店铺' });
    }

    const payloadRows = aggregatedRows.slice(0, 50000);
    const document = await PerformanceResult.create({
      companyId: store.companyId,
      storeId: store._id,
      uploadedBy: req.user._id,
      period: String(period).trim(),
      source: 'web-local-calculator',
      summary,
      aggregatedRows: payloadRows,
      rowCount: payloadRows.length
    });

    return res.json({
      success: true,
      message: '最终绩效结果上传成功',
      data: {
        id: document._id,
        companyId: document.companyId,
        storeId: document.storeId,
        period: document.period,
        rowCount: document.rowCount,
        createdAt: document.createdAt
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: '上传最终绩效结果失败', error: error.message });
  }
});

router.get('/performance/final-results', async (req, res) => {
  if (!ensureTenantManager(req, res)) return;

  try {
    const { storeId, period } = req.query;
    const query = {};

    if (isSuperAdmin(req.user)) {
      if (storeId) {
        const normalizedStoreId = normalizeObjectId(storeId);
        if (!normalizedStoreId) {
          return res.status(400).json({ success: false, message: 'storeId 无效' });
        }
        query.storeId = normalizedStoreId;
      }
    } else {
      query.companyId = normalizeObjectId(req.user.companyId);
      if (storeId) {
        const normalizedStoreId = normalizeObjectId(storeId);
        if (!normalizedStoreId) {
          return res.status(400).json({ success: false, message: 'storeId 无效' });
        }

        const store = await Store.findById(normalizedStoreId).select('companyId').lean();
        if (!store || String(store.companyId) !== String(query.companyId)) {
          return res.status(403).json({ success: false, message: '无权查看其他公司的店铺绩效' });
        }
        query.storeId = normalizedStoreId;
      }
    }

    if (period) {
      query.period = String(period).trim();
    }

    const rows = await PerformanceResult.find(query)
      .select('-aggregatedRows')
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    return res.json({ success: true, data: { rows } });
  } catch (error) {
    return res.status(500).json({ success: false, message: '获取最终绩效结果失败', error: error.message });
  }
});

module.exports = router;
