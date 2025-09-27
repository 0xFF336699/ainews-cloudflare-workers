# R2 Cleanup Worker 安全配置指南

## 🔐 安全特性

Worker现在包含多层安全保护，防止未授权访问和恶意删除操作。

### 1. API Key认证
- 支持 `Authorization: Bearer <token>` 头部
- 支持 `X-API-Key: <token>` 头部
- 可以通过环境变量启用/禁用

### 2. IP白名单
- 支持精确IP匹配
- 支持CIDR范围 (如 `192.168.1.0/24`)
- 可以配置多个IP地址或范围

### 3. 速率限制
- 每IP每日操作次数限制
- 防止暴力攻击和滥用
- 可配置的限制阈值

### 4. 操作审计
- 记录所有操作请求
- 包含IP地址、时间戳和操作详情
- 便于安全分析和问题排查

## 🚀 部署安全配置

### 第一步：设置API密钥
```bash
# 生成一个强密钥
openssl rand -hex 32

# 设置到Worker secrets
wrangler secret put API_KEY
# 输入刚才生成的密钥
```

### 第二步：配置IP白名单
```bash
# 设置允许的IP地址或范围
wrangler secret put IP_WHITELIST
# 例如: 127.0.0.1,192.168.1.0/24,10.0.0.100
```

### 第三步：调整安全配置
编辑 `wrangler.toml`:
```toml
[vars]
# 启用/禁用各项安全功能
REQUIRE_AUTH = "true"           # 启用API密钥验证
REQUIRE_IP_WHITELIST = "true"   # 启用IP白名单
MAX_DAILY_OPERATIONS = "50"     # 每日操作限制
```

### 第四步：部署Worker
```bash
wrangler deploy
```

## 📝 使用方法

### 带认证的请求示例

#### 使用Authorization头部
```bash
curl -X POST https://your-worker.workers.dev/cleanup \
  -H "Authorization: Bearer your-secret-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "dryRun": true,
    "mode": "no-prefix",
    "bucket": "main"
  }'
```

#### 使用X-API-Key头部
```bash
curl -X POST https://your-worker.workers.dev/cleanup \
  -H "X-API-Key: your-secret-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "dryRun": true,
    "mode": "no-prefix",
    "bucket": "main"
  }'
```

## 🛡️ 安全等级配置

### 最高安全等级（推荐生产环境）
```toml
[vars]
REQUIRE_AUTH = "true"
REQUIRE_IP_WHITELIST = "true"
MAX_DAILY_OPERATIONS = "10"
```

### 中等安全等级
```toml
[vars]
REQUIRE_AUTH = "true"
REQUIRE_IP_WHITELIST = "false"
MAX_DAILY_OPERATIONS = "50"
```

### 开发环境（仅限内网）
```toml
[vars]
REQUIRE_AUTH = "false"
REQUIRE_IP_WHITELIST = "true"  # 限制为内网IP
MAX_DAILY_OPERATIONS = "100"
```

## 🚨 错误响应

### 401 - 未授权
```json
{
  "success": false,
  "error": "Invalid or missing API key",
  "code": "UNAUTHORIZED"
}
```

### 403 - IP被禁止
```json
{
  "success": false,
  "error": "IP address 1.2.3.4 not allowed",
  "code": "IP_FORBIDDEN"
}
```

### 429 - 速率限制
```json
{
  "success": false,
  "error": "Rate limit exceeded: Daily limit of 50 operations exceeded",
  "code": "RATE_LIMITED"
}
```

## 📊 IP白名单配置示例

### 单个IP地址
```
127.0.0.1
```

### 多个IP地址
```
127.0.0.1,192.168.1.100,10.0.0.50
```

### CIDR网络范围
```
192.168.1.0/24,10.0.0.0/8,172.16.0.0/12
```

### 混合配置
```
127.0.0.1,192.168.1.0/24,10.0.0.100,203.0.113.0/24
```

## 🔧 高级安全配置

### 使用Cloudflare Access
如果需要更高级的身份验证，可以在Worker前配置Cloudflare Access：

1. 在Cloudflare Dashboard中设置Access策略
2. 配置允许的用户或组
3. Worker会收到验证后的请求

### 集成外部认证系统
可以修改 `authenticateRequest` 函数来集成：
- OAuth 2.0
- JWT tokens
- 企业LDAP
- 第三方身份提供商

## 💡 安全最佳实践

### 1. 密钥管理
- 使用强随机密钥（32字节以上）
- 定期轮换API密钥
- 不要在代码中硬编码密钥
- 使用Wrangler secrets管理敏感信息

### 2. 网络安全
- 尽可能使用最严格的IP白名单
- 考虑使用VPN或专用网络
- 监控异常访问模式

### 3. 操作安全
- 始终先使用 `dryRun: true` 测试
- 设置合理的速率限制
- 定期审查操作日志
- 为重要操作设置审批流程

### 4. 监控和告警
- 监控失败的认证尝试
- 设置速率限制告警
- 跟踪大量删除操作
- 配置异常IP访问通知

## 🔄 禁用安全功能（仅限开发）

如果在开发环境中需要临时禁用安全功能：

```toml
[vars]
REQUIRE_AUTH = "false"
REQUIRE_IP_WHITELIST = "false"
MAX_DAILY_OPERATIONS = "1000"
```

**⚠️ 警告**: 生产环境绝不要禁用安全功能！

## 📞 紧急情况

如果需要紧急禁用Worker：
```bash
# 删除Worker
wrangler delete

# 或者设置维护模式
wrangler secret put MAINTENANCE_MODE
# 输入: "true"
```

安全配置完成后，Worker将提供企业级的安全保护！