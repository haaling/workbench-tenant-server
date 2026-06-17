const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');
const authenticateToken = require('../middleware/auth');
const User = require('../models/User');
const Company = require('../models/Company');
const Store = require('../models/Store');
const Employee = require('../models/Employee');
const PerformanceResult = require('../models/PerformanceResult');
const PerformanceWorkflow = require('../models/PerformanceWorkflow');

const router = express.Router();

const VALID_ROLES = ['super_admin', 'company_admin', 'finance', 'branch_manager', 'team_lead', 'employee', 'readonly'];

router.use(authenticateToken);

const isSuperAdmin = (user) => String(user?.role || '') === 'super_admin';
const isCompanyAdmin = (user) => String(user?.role || '') === 'company_admin';
const isFinance = (user) => String(user?.role || '') === 'finance';

const normalizeObjectId = (value) => {
  const text = String(value || '').trim();
  if (!text || !mongoose.Types.ObjectId.isValid(text)) return null;
  return text;
};

const canManageTenant = (user) => isSuperAdmin(user) || isCompanyAdmin(user);
const canOperatePerformanceWorkflow = (user) => isSuperAdmin(user) || isCompanyAdmin(user) || isFinance(user);
const canReadTenantStoresAndEmployees = (user) => {
  const role = String(user?.role || '');
  return ['super_admin', 'company_admin', 'finance', 'branch_manager', 'team_lead', 'employee', 'general_manager', 'manager', 'gm'].includes(role);
};

const ARCHIVE_PERFORMANCE_COLUMNS = [
  { label: '订单号', aliases: ['订单号', '订单编号', '平台订单号', '订单id', '订单ID'] },
  { label: '订单时间', aliases: ['订单时间', '下单时间', '付款时间', '创建时间'] },
  { label: '订单状态', aliases: ['订单状态', '状态'] },
  { label: '订单预计可得', aliases: ['订单预计可得', '预计可得', '预计可得金额'] },
  { label: '总物流费用', aliases: ['总物流费用', '物流费用', '总物流费'] },
  { label: '采购费用', aliases: ['采购费用', '采购成本', '总采购费用'] },
  { label: '支付宝是否开发票', aliases: ['支付宝是否开发票', '是否开票', '支付宝开票'] },
  { label: '净利润', aliases: ['净利润', '总利润', '总收支'] }
];

const normalizeCellText = (value) => String(value ?? '').trim();

const pickByAliases = (row, aliases) => {
  for (const key of aliases) {
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      return normalizeCellText(row[key]);
    }
  }
  return '';
};

const projectArchivedRows = (rows) => {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const source = row && typeof row === 'object' ? row : {};
    const output = {};
    for (const column of ARCHIVE_PERFORMANCE_COLUMNS) {
      output[column.label] = pickByAliases(source, column.aliases);
    }
    return output;
  });
};

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

    // 超级管理员可以创建不绑定公司的用户（如其他超级管理员）
    const isSuperAdminCreatingUser = isSuperAdmin(req.user);
    const targetCompanyId = isSuperAdminCreatingUser && role === 'super_admin'
      ? (bodyCompanyId ? normalizeObjectId(bodyCompanyId) : null)
      : resolveTargetCompanyId(req, bodyCompanyId);

    // 只有非超级管理员用户或绑定到公司的用户才需要有效的 companyId
    if (!isSuperAdminCreatingUser && !targetCompanyId) {
      return res.status(400).json({ success: false, message: 'companyId 无效或缺失' });
    }

    // 如果提供了 companyId，验证公司存在
    if (targetCompanyId) {
      const company = await Company.findById(targetCompanyId).lean();
      if (!company) {
        return res.status(404).json({ success: false, message: '公司不存在' });
      }
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

    const normalizedStoreIdOnPlatform = String(storeIdOnPlatform || '').trim();

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

    const createPayload = {
      companyId,
      storeName: String(storeName).trim(),
      platform: String(platform).trim() || 'aliexpress',
      metadata
    };
    if (normalizedStoreIdOnPlatform) {
      createPayload.storeIdOnPlatform = normalizedStoreIdOnPlatform;
    }

    const store = await Store.create(createPayload);

    return res.json({ success: true, message: '店铺创建成功', data: { store } });
  } catch (error) {
    if (error && error.code === 11000) {
      return res.status(400).json({ success: false, message: '店铺平台ID已存在' });
    }
    return res.status(500).json({ success: false, message: '创建店铺失败', error: error.message });
  }
});

router.get('/stores', async (req, res) => {
  if (!canReadTenantStoresAndEmployees(req.user)) {
    return res.status(403).json({ success: false, message: '无权限访问店铺列表' });
  }

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
    const unset = {};
    ['storeName', 'platform', 'storeIdOnPlatform', 'status', 'metadata'].forEach((key) => {
      if (req.body && req.body[key] !== undefined) {
        if (key === 'storeIdOnPlatform') {
          const normalized = String(req.body[key] || '').trim();
          if (normalized) {
            patch[key] = normalized;
          } else {
            unset[key] = 1;
          }
          return;
        }
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

    const updateDoc = { $set: patch };
    if (Object.keys(unset).length > 0) {
      updateDoc.$unset = unset;
    }

    const store = await Store.findByIdAndUpdate(storeId, updateDoc, { new: true })
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
    const { companyId: bodyCompanyId, userId: bodyUserId, name, employeeCode = '', notes = '' } = req.body || {};
    if (!name) {
      return res.status(400).json({ success: false, message: 'name 为必填项' });
    }

    const companyId = resolveTargetCompanyId(req, bodyCompanyId);
    if (!companyId) {
      return res.status(400).json({ success: false, message: 'companyId 无效或缺失' });
    }

    const userId = normalizeObjectId(bodyUserId);
    if (bodyUserId !== undefined && !userId) {
      return res.status(400).json({ success: false, message: 'userId 无效' });
    }

    if (userId) {
      const linkedUser = await User.findOne({ _id: userId, companyId }).select('_id').lean();
      if (!linkedUser) {
        return res.status(400).json({ success: false, message: '关联账号不存在，或不属于该公司' });
      }
    }

    const normalizedEmployeeCode = String(employeeCode || '').trim();

    const employee = await Employee.create({
      companyId,
      userId,
      name: String(name).trim(),
      ...(normalizedEmployeeCode ? { employeeCode: normalizedEmployeeCode } : {}),
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

router.patch('/employees/:employeeId/resign', async (req, res) => {
  if (!ensureTenantManager(req, res)) return;

  try {
    const employeeId = normalizeObjectId(req.params.employeeId);
    if (!employeeId) {
      return res.status(400).json({ success: false, message: 'employeeId 无效' });
    }

    const employee = await Employee.findById(employeeId);
    if (!employee) {
      return res.status(404).json({ success: false, message: '员工不存在' });
    }

    if (!ensureCompanyAccess(req, employee.companyId)) {
      return res.status(403).json({ success: false, message: '无权操作其他公司的员工' });
    }

    let linkedUser = null;
    if (employee.userId) {
      linkedUser = await User.findOne({ _id: employee.userId, companyId: employee.companyId });
    }

    if (!linkedUser) {
      const candidateKeys = [employee.name, employee.employeeCode]
        .map((item) => String(item || '').trim())
        .filter(Boolean);

      if (candidateKeys.length > 0) {
        const candidates = await User.find({
          companyId: employee.companyId,
          username: { $in: candidateKeys }
        });
        if (candidates.length === 1) {
          linkedUser = candidates[0];
          employee.userId = linkedUser._id;
        }
      }
    }

    employee.status = 'inactive';
    await employee.save();

    await Store.updateMany(
      { companyId: employee.companyId, employeeIds: employee._id },
      { $pull: { employeeIds: employee._id } }
    );

    if (linkedUser) {
      linkedUser.isActive = false;
      linkedUser.password = crypto.randomBytes(24).toString('hex');
      await linkedUser.save();
    }

    return res.json({
      success: true,
      message: linkedUser ? '员工已离职，账号已停用' : '员工已离职，未找到可停用的关联账号',
      data: {
        employee: employee.toObject(),
        user: linkedUser ? linkedUser.toJSON() : null
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: '员工离职处理失败', error: error.message });
  }
});

router.get('/employees', async (req, res) => {
  if (!canReadTenantStoresAndEmployees(req.user)) {
    return res.status(403).json({ success: false, message: '无权限访问员工列表' });
  }

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

router.get('/performance/workflows/reviewers', async (req, res) => {
  if (!canOperatePerformanceWorkflow(req.user)) {
    return res.status(403).json({ success: false, message: '仅财务或管理员可查看可指派员工' });
  }

  try {
    const companyId = normalizeObjectId(req.user.companyId);
    if (!companyId) {
      return res.status(400).json({ success: false, message: '当前账号未绑定公司' });
    }

    const users = await User.find({
      companyId,
      isActive: true,
      role: { $in: ['employee', 'team_lead', 'branch_manager', 'company_admin', 'general_manager', 'manager', 'gm'] }
    })
      .select('_id username role')
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ success: true, data: { users } });
  } catch (error) {
    return res.status(500).json({ success: false, message: '获取可指派员工失败', error: error.message });
  }
});

router.post('/performance/workflows', async (req, res) => {
  if (!canOperatePerformanceWorkflow(req.user)) {
    return res.status(403).json({ success: false, message: '仅财务或管理员可创建绩效核对流程' });
  }

  try {
    const { storeId, period, summary = {}, calculatedRows = [], uploadedRows = [] } = req.body || {};
    const normalizedStoreId = normalizeObjectId(storeId);
    if (!normalizedStoreId || !period) {
      return res.status(400).json({ success: false, message: 'storeId 和 period 为必填项' });
    }

    if (!Array.isArray(uploadedRows) || uploadedRows.length === 0) {
      return res.status(400).json({ success: false, message: 'uploadedRows 必须为非空数组' });
    }
    if (uploadedRows.length > 50000 || (Array.isArray(calculatedRows) && calculatedRows.length > 50000)) {
      return res.status(400).json({ success: false, message: '单次上传行数过大，请控制在 50000 行以内' });
    }

    const store = await Store.findById(normalizedStoreId).lean();
    if (!store) {
      return res.status(404).json({ success: false, message: '店铺不存在' });
    }
    if (!ensureCompanyAccess(req, store.companyId)) {
      return res.status(403).json({ success: false, message: '无权操作其他公司的店铺' });
    }

    const workflow = await PerformanceWorkflow.create({
      companyId: store.companyId,
      storeId: store._id,
      period: String(period).trim(),
      submittedBy: req.user._id,
      summary,
      calculatedRows: Array.isArray(calculatedRows) ? calculatedRows.slice(0, 50000) : [],
      uploadedRows: uploadedRows.slice(0, 50000),
      rowCountCalculated: Array.isArray(calculatedRows) ? calculatedRows.length : 0,
      rowCountUploaded: uploadedRows.length,
      status: 'draft'
    });

    return res.json({ success: true, message: '绩效核对流程创建成功', data: { workflow } });
  } catch (error) {
    return res.status(500).json({ success: false, message: '创建绩效核对流程失败', error: error.message });
  }
});

router.get('/performance/workflows', async (req, res) => {
  try {
    const { status, mine, storeId, period } = req.query || {};
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
      const companyId = normalizeObjectId(req.user.companyId);
      if (!companyId) {
        return res.status(400).json({ success: false, message: '当前账号未绑定公司' });
      }
      query.companyId = companyId;
    }

    if (status) {
      query.status = String(status).trim();
    }
    if (period) {
      query.period = String(period).trim();
    }

    if (!canOperatePerformanceWorkflow(req.user) || String(mine || '') === '1') {
      query.assignedToUser = req.user._id;
    }

    const workflows = await PerformanceWorkflow.find(query)
      .populate('storeId', 'storeName')
      .populate('assignedToUser', 'username role')
      .populate('submittedBy', 'username')
      .populate('confirmedBy', 'username')
      .populate('archivedBy', 'username')
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    return res.json({ success: true, data: { workflows } });
  } catch (error) {
    return res.status(500).json({ success: false, message: '获取绩效核对流程失败', error: error.message });
  }
});

router.patch('/performance/workflows/:workflowId/push', async (req, res) => {
  if (!canOperatePerformanceWorkflow(req.user)) {
    return res.status(403).json({ success: false, message: '仅财务或管理员可推送绩效核对' });
  }

  try {
    const workflowId = normalizeObjectId(req.params.workflowId);
    const assignedToUserId = normalizeObjectId(req.body?.assignedToUserId);
    const pushNote = String(req.body?.pushNote || '').trim();

    if (!workflowId || !assignedToUserId) {
      return res.status(400).json({ success: false, message: 'workflowId 和 assignedToUserId 为必填项' });
    }

    const workflow = await PerformanceWorkflow.findById(workflowId);
    if (!workflow) {
      return res.status(404).json({ success: false, message: '绩效核对流程不存在' });
    }
    if (!ensureCompanyAccess(req, workflow.companyId)) {
      return res.status(403).json({ success: false, message: '无权操作其他公司的绩效流程' });
    }
    if (workflow.status === 'archived') {
      return res.status(400).json({ success: false, message: '该流程已归档，不能再次推送' });
    }

    const targetUser = await User.findOne({ _id: assignedToUserId, companyId: workflow.companyId, isActive: true }).lean();
    if (!targetUser) {
      return res.status(400).json({ success: false, message: '被指派员工不存在或不在当前公司' });
    }

    workflow.assignedToUser = assignedToUserId;
    workflow.status = 'pushed';
    workflow.pushNote = pushNote;
    workflow.pushedAt = new Date();
    workflow.confirmedBy = null;
    workflow.confirmedAt = null;
    await workflow.save();

    return res.json({ success: true, message: '已推送给员工核对', data: { workflow } });
  } catch (error) {
    return res.status(500).json({ success: false, message: '推送绩效核对失败', error: error.message });
  }
});

router.patch('/performance/workflows/:workflowId/confirm', async (req, res) => {
  try {
    const workflowId = normalizeObjectId(req.params.workflowId);
    if (!workflowId) {
      return res.status(400).json({ success: false, message: 'workflowId 无效' });
    }

    const workflow = await PerformanceWorkflow.findById(workflowId);
    if (!workflow) {
      return res.status(404).json({ success: false, message: '绩效核对流程不存在' });
    }
    if (!ensureCompanyAccess(req, workflow.companyId)) {
      return res.status(403).json({ success: false, message: '无权操作其他公司的绩效流程' });
    }
    if (String(workflow.assignedToUser || '') !== String(req.user._id || '')) {
      return res.status(403).json({ success: false, message: '仅被指派员工可确认该流程' });
    }
    if (workflow.status !== 'pushed') {
      return res.status(400).json({ success: false, message: '当前流程状态不可确认' });
    }

    workflow.status = 'confirmed';
    workflow.confirmedBy = req.user._id;
    workflow.confirmedAt = new Date();
    await workflow.save();

    return res.json({ success: true, message: '员工核对确认成功', data: { workflow } });
  } catch (error) {
    return res.status(500).json({ success: false, message: '员工确认失败', error: error.message });
  }
});

router.patch('/performance/workflows/:workflowId/archive', async (req, res) => {
  if (!canOperatePerformanceWorkflow(req.user)) {
    return res.status(403).json({ success: false, message: '仅财务或管理员可归档绩效' });
  }

  try {
    const workflowId = normalizeObjectId(req.params.workflowId);
    if (!workflowId) {
      return res.status(400).json({ success: false, message: 'workflowId 无效' });
    }

    const workflow = await PerformanceWorkflow.findById(workflowId);
    if (!workflow) {
      return res.status(404).json({ success: false, message: '绩效核对流程不存在' });
    }
    if (!ensureCompanyAccess(req, workflow.companyId)) {
      return res.status(403).json({ success: false, message: '无权操作其他公司的绩效流程' });
    }
    if (workflow.status !== 'confirmed') {
      return res.status(400).json({ success: false, message: '仅已确认的流程可归档' });
    }

    const archivedRows = projectArchivedRows(workflow.uploadedRows).slice(0, 50000);

    const archivedResult = await PerformanceResult.create({
      companyId: workflow.companyId,
      storeId: workflow.storeId,
      uploadedBy: req.user._id,
      period: workflow.period,
      source: 'finance-reviewed-workflow',
      summary: workflow.summary || {},
      aggregatedRows: archivedRows,
      rowCount: archivedRows.length
    });

    workflow.status = 'archived';
    workflow.archivedBy = req.user._id;
    workflow.archivedAt = new Date();
    await workflow.save();

    return res.json({
      success: true,
      message: '绩效已归档入库',
      data: {
        workflow,
        archivedResult: {
          id: archivedResult._id,
          period: archivedResult.period,
          rowCount: archivedResult.rowCount,
          createdAt: archivedResult.createdAt
        }
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: '归档绩效失败', error: error.message });
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
