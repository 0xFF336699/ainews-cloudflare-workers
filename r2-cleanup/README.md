# R2 Cleanup Worker

🔐 **安全的**R2存储清理工具，支持多种删除模式和企业级安全保护的Cloudflare Worker。

## 🔐 安全特性

- ✅ **API Key认证** - 支持Bearer token和X-API-Key
- ✅ **IP白名单** - 支持精确IP和CIDR范围限制
- ✅ **速率限制** - 防止暴力攻击和滥用
- ✅ **操作审计** - 完整的操作日志记录
- ✅ **多层验证** - 可配置的安全等级

## 📋 功能特性

- ✅ **三种清理模式**：
  - 清理没有环境前缀的旧数据
  - 删除指定路径下的所有数据
  - 删除指定的具体文件路径
- ✅ **多存储桶支持** - 支持main/backup/temp三个存储桶
- ✅ **安全的试运行模式**：默认只扫描不删除，确保安全
- ✅ **批量处理**：支持大量对象的高效删除
- ✅ **智能限制**：防止超时的最大对象数量限制
- ✅ **详细报告**：返回扫描和删除的详细结果
- ✅ **错误容错**：单个批次失败不会影响整体处理

## 🚀 快速开始

### 1. 安装依赖
```bash
cd C:\work\ai-news-dog\cf-workers\r2-cleanup
npm install
```

### 2. 安全配置
⚠️ **重要**: 部署前必须配置安全设置！

```bash
# 1. 生成API密钥
openssl rand -hex 32

# 2. 设置密钥
wrangler secret put API_KEY
# 输入生成的密钥
实际是 ab38e96714492f3f6f0739f501047c01508638772162204ed951f0d5b85a6462

# 3. 设置IP白名单
wrangler secret put IP_WHITELIST
# 例如: 127.0.0.1,192.168.1.0/24
实际是 104.225.232.227
```

### 3. 配置存储桶
存储桶已配置为：
- `main`: ai-news-main (主存储桶)
- `backup`: droid (备份存储桶)
- `temp`: emc-zh-cn (临时存储桶)

### 4. 部署Worker
```bash
wrangler deploy
```

## 📝 使用方法

### 🔐 带认证的请求

⚠️ **所有请求都需要认证**

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

### 🔍 模式说明

| 模式 | 说明 | 用途 |
|------|------|------|
| `no-prefix` | 清理没有环境前缀的数据 | 清理迁移前的旧数据 |
| `all-under-path` | 删除指定路径下所有数据 | 批量清理目录 |
| `specific-paths` | 删除指定的具体文件 | 精确删除文件 |

### 1️⃣ 清理没有环境前缀的数据

```bash
curl -X POST https://your-worker.workers.dev/cleanup \
  -H "X-API-Key: your-secret-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "dryRun": true,
    "mode": "no-prefix",
    "bucket": "main",
    "paths": ["news/", "prefix_news_list:"],
    "maxObjects": 5000
  }'
```

### 2️⃣ 删除指定路径下的所有数据

```bash
curl -X POST https://your-worker.workers.dev/cleanup \
  -H "X-API-Key: your-secret-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "dryRun": false,
    "mode": "all-under-path",
    "bucket": "backup",
    "paths": ["old-backups/2024/"],
    "batchSize": 50,
    "maxObjects": 1000
  }'

  https://bucket.wocker.cloudflare.shangwoa.top/r2-cleanup-worker


curl -X POST https://r2-cleanup-worker.mailregios.workers.dev \
  -H "X-API-Key: ab38e96714492f3f6f0739f501047c01508638772162204ed951f0d5b85a6462" \
  -H "Content-Type: application/json" \
  -d '{
    "dryRun": false,
    "mode": "all-under-path",
    "bucket": "ai-news-main",
    "paths": ["news/"],
    "batchSize": 50,
    "maxObjects": 1000
  }'


```

### 3️⃣ 删除指定的具体文件

```bash
curl -X POST https://your-worker.workers.dev/cleanup \
  -H "X-API-Key: your-secret-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "dryRun": false,
    "mode": "specific-paths",
    "bucket": "temp",
    "paths": ["upload/temp1.json", "cache/expired.dat"]
  }'

  curl -X POST https://your-worker.workers.dev/cleanup \
  -H "X-API-Key: your-secret-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "dryRun": false,
    "mode": "specific-paths",
    "bucket": "temp",
    "paths": ["upload/temp1.json", "cache/expired.dat"]
  }'
```

## 📊 请求参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|-------|------|
| `dryRun` | boolean | true | 试运行模式，只扫描不删除 |
| `mode` | string | "no-prefix" | 清理模式 |
| `bucket` | string | "main" | 目标存储桶: main/backup/temp |
| `paths` | array | [] | 要处理的路径列表 |
| `batchSize` | number | 100 | 批处理大小 |
| `maxObjects` | number | 10000 | 最大处理对象数量限制 |

## 🛡️ 安全配置

### 环境变量配置
```toml
[vars]
REQUIRE_AUTH = "true"           # 启用API密钥验证
REQUIRE_IP_WHITELIST = "true"   # 启用IP白名单
MAX_DAILY_OPERATIONS = "50"     # 每日操作限制
```

### 安全等级建议

#### 生产环境（最高安全）
- ✅ API Key认证
- ✅ IP白名单限制
- ✅ 低速率限制 (10-50次/天)

#### 测试环境（中等安全）
- ✅ API Key认证
- ❌ IP白名单（如果不可行）
- ✅ 中等速率限制 (100次/天)

详细安全配置请参考 [SECURITY.md](./SECURITY.md)

## 🔍 健康检查

```bash
curl https://your-worker.workers.dev/health
curl https://r2-cleanup-worker.mailregios.workers.dev/health \
  -H "X-API-Key: ab38e96714492f3f6f0739f501047c01508638772162204ed951f0d5b85a6462"
curl bucket.wocker.cloudflare.shangwoa.top/r2-cleanup-worker
```

返回存储桶信息和服务状态：
```json
{
  "status": "healthy",
  "service": "r2-cleanup-worker",
  "buckets": {
    "main": "ai-news-main",
    "backup": "droid",
    "temp": "emc-zh-cn"
  },
  "available_buckets": ["main", "backup", "temp"]
}
```

## 📄 响应格式

```json
{
  "success": true,
  "dryRun": true,
  "mode": "all-under-path",
  "bucket": "main",
  "totalFound": 150,
  "totalProcessed": 150,
  "totalDeleted": 0,
  "processedPaths": [
    {
      "path": "news/2025/09/26/",
      "found": 100,
      "processed": 100,
      "deleted": 0,
      "truncated": false
    }
  ],
  "deletedObjects": [
    {
      "key": "news/2025/09/26/site1/123",
      "action": "would_delete"
    }
  ],
  "errors": [],
  "truncated": false
}
```

## 🚨 错误处理

### 认证错误
```json
{
  "success": false,
  "error": "Invalid or missing API key",
  "code": "UNAUTHORIZED"
}
```

### IP限制错误
```json
{
  "success": false,
  "error": "IP address 1.2.3.4 not allowed",
  "code": "IP_FORBIDDEN"
}
```

### 速率限制错误
```json
{
  "success": false,
  "error": "Rate limit exceeded: Daily limit of 50 operations exceeded",
  "code": "RATE_LIMITED"
}
```

## ⚠️ 安全注意事项

1. **先试运行**：务必先使用 `dryRun: true` 检查要删除的对象
2. **保护API密钥**：不要在代码中硬编码，使用Wrangler secrets
3. **限制IP访问**：配置严格的IP白名单
4. **监控操作**：定期检查操作日志
5. **设置限制**：使用 `maxObjects` 限制单次处理的对象数量
6. **分批执行**：大量数据建议分多次执行

## 📁 项目结构

```
cf-workers/r2-cleanup/
├── package.json          # npm配置
├── wrangler.toml         # Worker配置
├── src/
│   └── index.js          # Worker代码(含安全验证)
├── examples.sh           # 使用示例
├── README.md             # 本文档
└── SECURITY.md           # 详细安全配置指南
```

## 🎯 存储桶用途

- **main (ai-news-main)**: 生产数据，谨慎操作
- **backup (droid)**: 备份数据，可定期清理旧备份
- **temp (emc-zh-cn)**: 临时数据，可频繁清理

## 📞 紧急情况

如果需要紧急禁用Worker：
```bash
wrangler delete
```

Worker现在具备企业级安全保护，可以安全地管理R2存储！