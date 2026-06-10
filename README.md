# workbench-tenant-server

工作台独立后端服务（从 `dianxiaomi-auth-server` 拆分）。

## 作用

提供工作台相关 API：
- 公司管理
- 用户管理
- 店铺管理
- 员工管理
- 绩效最终结果上传与查询

所有接口前缀：`/api/tenant/*`

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
- `JWT_SECRET`
- `ALLOWED_ORIGINS`

3. 启动

```bash
npm run dev
```

默认端口：`3100`

## 部署建议

1. 使用单独项目/单独实例部署，避免影响认证主服务。
2. 与认证服务共享同一个用户体系时，需保证两边 `JWT_SECRET` 一致。
3. 前端将工作台 API 指向本服务域名，例如：`https://your-workbench-server.com/api`。
