# Example usage scripts for R2 cleanup worker with multiple buckets

# ========================================
# 1. 健康检查 - 查看所有可用存储桶
# ========================================
curl https://your-worker.your-subdomain.workers.dev/health

# ========================================
# 2. 清理主存储桶 (ai-news-main)
# ========================================

# 试运行 - 扫描主存储桶中没有环境前缀的数据
curl -X POST https://your-worker.your-subdomain.workers.dev/cleanup \
  -H "Content-Type: application/json" \
  -d '{
    "dryRun": true,
    "mode": "no-prefix",
    "bucket": "main"
  }'

# 实际删除 - 清理主存储桶中没有环境前缀的数据
curl -X POST https://your-worker.your-subdomain.workers.dev/cleanup \
  -H "Content-Type: application/json" \
  -d '{
    "dryRun": false,
    "mode": "no-prefix",
    "bucket": "main",
    "paths": ["news/", "prefix_news_list:"],
    "batchSize": 50
  }'

# ========================================
# 3. 清理备份存储桶 (ai-news-backup)
# ========================================

# 试运行 - 删除备份存储桶中指定路径的数据
curl -X POST https://your-worker.your-subdomain.workers.dev/cleanup \
  -H "Content-Type: application/json" \
  -d '{
    "dryRun": true,
    "mode": "all-under-path",
    "bucket": "backup",
    "paths": ["old-backups/", "temp/"],
    "maxObjects": 5000
  }'

# 实际删除 - 清理备份存储桶中的旧数据
curl -X POST https://your-worker.your-subdomain.workers.dev/cleanup \
  -H "Content-Type: application/json" \
  -d '{
    "dryRun": false,
    "mode": "all-under-path",
    "bucket": "backup",
    "paths": ["old-backups/2024/"],
    "batchSize": 100
  }'

# ========================================
# 4. 清理临时存储桶 (ai-news-temp)
# ========================================

# 试运行 - 删除临时存储桶中的特定文件
curl -X POST https://your-worker.your-subdomain.workers.dev/cleanup \
  -H "Content-Type: application/json" \
  -d '{
    "dryRun": true,
    "mode": "specific-paths",
    "bucket": "temp",
    "paths": [
      "upload/temp1.json",
      "upload/temp2.json",
      "cache/expired.dat"
    ]
  }'

# 实际删除 - 清理临时存储桶中的所有临时文件
curl -X POST https://your-worker.your-subdomain.workers.dev/cleanup \
  -H "Content-Type: application/json" \
  -d '{
    "dryRun": false,
    "mode": "all-under-path",
    "bucket": "temp",
    "paths": ["upload/", "cache/", "tmp/"],
    "batchSize": 200
  }'

# ========================================
# 5. 跨存储桶操作示例
# ========================================

# 清理所有存储桶中的特定路径（需要分别调用）
for bucket in main backup temp; do
  echo "Cleaning bucket: $bucket"
  curl -X POST https://your-worker.your-subdomain.workers.dev/cleanup \
    -H "Content-Type: application/json" \
    -d "{
      \"dryRun\": true,
      \"mode\": \"all-under-path\",
      \"bucket\": \"$bucket\",
      \"paths\": [\"debug/\", \"test/\"]
    }"
done

# ========================================
# 参数说明
# ========================================
# bucket: 目标存储桶选择
#   - "main": ai-news-main (主存储桶)
#   - "backup": ai-news-backup (备份存储桶)
#   - "temp": ai-news-temp (临时存储桶)
# dryRun: true/false - 试运行模式，true时不会真正删除
# mode:
#   - "no-prefix": 清理没有环境前缀的数据
#   - "all-under-path": 删除指定路径下的所有数据
#   - "specific-paths": 删除指定的具体文件路径
# paths: 路径数组
# batchSize: 批处理大小，建议50-200
# maxObjects: 最大处理对象数量限制，防止超时

# ========================================
# 存储桶用途说明
# ========================================
# main (ai-news-main): 生产数据，谨慎操作
# backup (ai-news-backup): 备份数据，可定期清理旧备份
# temp (ai-news-temp): 临时数据，可频繁清理