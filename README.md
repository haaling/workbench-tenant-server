# workbench-tenant-server

工作台独立后端服务（从 `dianxiaomi-auth-server` 拆分）。

## 作用

提供工作台相关 API：
- 认证登录（独立，不依赖 dianxiaomi-auth-server）
- 公司管理
- 用户管理
- 店铺管理
- 员工管理
- 绩效最终结果上传与查询

接口前缀：
- 认证：`/api/auth/*`
- 工作台：`/api/tenant/*`

## 快速开始

1. 安装依赖

```bash
npm install
```

2. 配置环境变量

```bash
cp .env.example .env
```

至少配置：
- `MONGODB_URI`
- `WORKBENCH_DB_NAME`（建议默认：`workbench_tenant`）
- `WORKBENCH_USER_COLLECTION`（建议默认：`workbench_users`）
- `JWT_SECRET`
- `ALLOWED_ORIGINS`

3. 启动

```bash
npm run dev
```

默认端口：`3100`

## 生产地址

已部署地址：`https://workbench-tenant-server-production.up.railway.app`

接口基址：`https://workbench-tenant-server-production.up.railway.app/api`

前端建议配置：
- `VITE_WORKBENCH_API_BASE_URL=https://workbench-tenant-server-production.up.railway.app/api`

登录接口示例：

```bash
curl -X POST "https://workbench-tenant-server-production.up.railway.app/api/auth/login" \
	-H "Content-Type: application/json" \
	-d '{
		"email": "admin@example.com",
		"password": "your-password"
	}'
```

## 部署建议

1. 使用单独项目/单独实例部署，避免影响认证主服务。
2. 与认证服务不共享数据库。工作台请使用独立数据库名（`WORKBENCH_DB_NAME`）。
3. 用户集合使用独立名（`WORKBENCH_USER_COLLECTION`），避免误连同库时读取到其他项目账号。
4. 前端将工作台 API 指向本服务域名，例如：`https://your-workbench-server.com/api`。

## 新公司开通与授权 SOP

### 前提

1. `workbench-tenant-server` 与认证服务使用同一套 `JWT_SECRET`。
2. 工作台服务使用独立数据库名（`WORKBENCH_DB_NAME`），不要与其他项目共库共集合。
3. 你有一个 `super_admin` 账号可登录认证服务。

### 流程总览

1. 用 `super_admin` 登录认证服务，获取 Bearer Token。
2. 用该 Token 在工作台服务创建公司。
3. 为新公司创建首个 `company_admin` 账号。
4. 把管理员账号交付客户，客户即可登录工作台。

### 步骤 1：登录获取 Token（认证服务）

```bash
curl -X POST "https://dianxiaomi-auth-server-production.up.railway.app/api/auth/login" \
	-H "Content-Type: application/json" \
	-d '{
		"email": "super-admin@example.com",
		"password": "your-password"
	}'
```

从响应中取 `data.token`。

### 步骤 2：创建公司（工作台服务）

```bash
curl -X POST "https://workbench-tenant-server-production.up.railway.app/api/tenant/companies" \
	-H "Authorization: Bearer YOUR_TOKEN" \
	-H "Content-Type: application/json" \
	-d '{
		"companyName": "杭州示例贸易有限公司",
		"expireDate": "2027-06-10T00:00:00.000Z",
		"maxUsers": 20,
		"notes": "{\"companyCode\":\"HZ20260610\",\"legalRepresentative\":\"张三\"}"
	}'
```

从返回结果记录 `data.company._id`。

### 步骤 3：创建公司管理员（工作台服务）

```bash
curl -X POST "https://workbench-tenant-server-production.up.railway.app/api/tenant/users" \
	-H "Authorization: Bearer YOUR_TOKEN" \
	-H "Content-Type: application/json" \
	-d '{
		"username": "hangzhou_admin",
		"email": "admin@customer.com",
		"password": "InitPass123",
		"role": "company_admin",
		"companyId": "COMPANY_ID_FROM_STEP_2"
	}'
```

### 步骤 4：交付与后续管理

1. 把 `company_admin` 账号交给客户。
2. 客户登录后可在其公司范围内添加 `finance`、`readonly`、`employee`。
3. 需要停用或续期时：
	 - 更新公司状态/到期：`PATCH /api/tenant/companies/:companyId`
	 - 启停用户：`PATCH /api/tenant/users/:userId`

## 常见问题

1. 报错“仅超级管理员可创建公司”：当前 token 对应账号不是 `super_admin`。
2. 报错“无效的令牌”：确认 `JWT_SECRET` 与认证服务一致。
3. 报错“companyId 无效或缺失”：创建公司管理员时 companyId 必须传公司 `_id`。

## 运营手册

上线后给新客户开通账号，请直接使用：

- CUSTOMER_ONBOARDING_RUNBOOK.md

## 文档维护要求（强制）

从现在开始，每次功能改动都必须同步更新文档，至少包含：

1. 在 `CHANGELOG.md` 追加一条变更记录（日期、影响范围、接口/页面、回滚点）。
2. 如涉及接口变更，同步更新本 README 对应接口说明与示例。
3. 如涉及角色权限变更，同步补充权限说明（谁可见、谁可操作）。

未更新文档的改动，视为未完成交付。
