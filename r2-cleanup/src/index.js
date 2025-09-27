/**
 * R2 Cleanup Worker
 * 清理R2中指定路径下的所有数据 - 带安全验证
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 健康检查端点
    if (url.pathname === '/health' && request.method === 'GET') {
      return handleHealthCheck();
    }

    // 安全验证
    const authResult = await authenticateRequest(request, env);
    if (!authResult.success) {
      return new Response(JSON.stringify({
        success: false,
        error: authResult.error,
        code: authResult.code
      }), {
        status: authResult.status,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 只允许 POST 请求进行清理操作
    if (request.method !== 'POST') {
      return new Response('Method not allowed. Use POST to trigger cleanup.', {
        status: 405,
        headers: { 'Content-Type': 'text/plain' }
      });
    }

    // 验证路径
    if (url.pathname !== '/cleanup') {
      return new Response('Not found. Use /cleanup endpoint.', {
        status: 404,
        headers: { 'Content-Type': 'text/plain' }
      });
    }

    try {
      // 解析请求体获取清理参数
      const body = await request.json();
      const {
        dryRun = true,           // 默认为试运行模式
        paths = [],             // 要清理的具体路径列表
        mode = 'no-prefix',     // 清理模式: 'no-prefix' | 'specific-paths' | 'all-under-path'
        batchSize = 100,        // 批处理大小
        maxObjects = 10000,     // 最大处理对象数量限制
        bucket = 'main'         // 目标存储桶: 'main' | 'backup' | 'temp'
      } = body;

      // 记录操作（用于审计和速率限制）
      await logOperation(env, {
        clientIP: request.headers.get('CF-Connecting-IP'),
        operation: { dryRun, mode, bucket, pathCount: paths.length },
        timestamp: Date.now()
      });

      console.log('Starting R2 cleanup', { dryRun, paths, mode, batchSize, maxObjects, bucket });

      // 验证参数
      if (paths.length === 0 && mode !== 'no-prefix') {
        return new Response(JSON.stringify({
          success: false,
          error: 'paths parameter is required when mode is not "no-prefix"'
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // 选择目标存储桶
      const targetBucket = getBucket(env, bucket);
      if (!targetBucket) {
        return new Response(JSON.stringify({
          success: false,
          error: `Invalid bucket: ${bucket}. Available buckets: main, backup, temp`
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const results = await cleanupR2Objects(targetBucket, {
        paths,
        mode,
        dryRun,
        batchSize,
        maxObjects
      });

      return new Response(JSON.stringify({
        success: true,
        dryRun,
        mode,
        bucket,
        ...results
      }), {
        headers: { 'Content-Type': 'application/json' }
      });

    } catch (error) {
      console.error('Cleanup failed:', error);
      return new Response(JSON.stringify({
        success: false,
        error: error.message
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
};

/**
 * 安全验证函数
 */
async function authenticateRequest(request, env) {
  const clientIP = request.headers.get('CF-Connecting-IP');
  const authHeader = request.headers.get('Authorization');
  const apiKey = request.headers.get('X-API-Key');

  // 1. API Key验证
  if (env.REQUIRE_AUTH === 'true') {
    const expectedApiKey = env.API_KEY;
    if (!expectedApiKey) {
      return {
        success: false,
        error: 'API_KEY not configured on server',
        code: 'SERVER_MISCONFIGURED',
        status: 500
      };
    }

    const providedKey = apiKey || (authHeader && authHeader.replace('Bearer ', ''));
    if (!providedKey || providedKey !== expectedApiKey) {
      return {
        success: false,
        error: 'Invalid or missing API key',
        code: 'UNAUTHORIZED',
        status: 401
      };
    }
  }

  // 2. IP白名单验证
  if (env.REQUIRE_IP_WHITELIST === 'true') {
    const ipWhitelist = env.IP_WHITELIST;
    if (!ipWhitelist) {
      return {
        success: false,
        error: 'IP_WHITELIST not configured on server',
        code: 'SERVER_MISCONFIGURED',
        status: 500
      };
    }

    if (!isIPAllowed(clientIP, ipWhitelist)) {
      return {
        success: false,
        error: `IP address ${clientIP} not allowed`,
        code: 'IP_FORBIDDEN',
        status: 403
      };
    }
  }

  // 3. 速率限制验证
  const rateLimitResult = await checkRateLimit(env, clientIP);
  if (!rateLimitResult.allowed) {
    return {
      success: false,
      error: `Rate limit exceeded: ${rateLimitResult.message}`,
      code: 'RATE_LIMITED',
      status: 429
    };
  }

  return { success: true };
}

/**
 * IP白名单检查
 */
function isIPAllowed(clientIP, whitelist) {
  if (!clientIP || !whitelist) return false;

  const allowedIPs = whitelist.split(',').map(ip => ip.trim());

  for (const allowedIP of allowedIPs) {
    if (allowedIP.includes('/')) {
      // CIDR notation
      if (isIPInCIDR(clientIP, allowedIP)) {
        return true;
      }
    } else {
      // Exact IP match
      if (clientIP === allowedIP) {
        return true;
      }
    }
  }

  return false;
}

/**
 * CIDR IP范围检查
 */
function isIPInCIDR(ip, cidr) {
  const [network, prefixLength] = cidr.split('/');
  const prefix = parseInt(prefixLength, 10);

  // 简化版本，支持IPv4
  if (ip.includes(':')) return false; // Skip IPv6 for now

  const ipParts = ip.split('.').map(Number);
  const networkParts = network.split('.').map(Number);

  const ipBinary = (ipParts[0] << 24) + (ipParts[1] << 16) + (ipParts[2] << 8) + ipParts[3];
  const networkBinary = (networkParts[0] << 24) + (networkParts[1] << 16) + (networkParts[2] << 8) + networkParts[3];

  const mask = (-1 << (32 - prefix)) >>> 0;

  return (ipBinary & mask) === (networkBinary & mask);
}

/**
 * 速率限制检查
 */
async function checkRateLimit(env, clientIP) {
  const maxDaily = parseInt(env.MAX_DAILY_OPERATIONS || '100', 10);
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const key = `rate_limit:${clientIP}:${today}`;

  try {
    // 这里需要一个持久化存储，可以使用KV或Durable Objects
    // 简化版本：假设有一个全局计数器
    const currentCount = await getCurrentOperationCount(env, key);

    if (currentCount >= maxDaily) {
      return {
        allowed: false,
        message: `Daily limit of ${maxDaily} operations exceeded`
      };
    }

    return { allowed: true };
  } catch (error) {
    console.error('Rate limit check failed:', error);
    // 在检查失败时允许操作，但记录错误
    return { allowed: true };
  }
}

/**
 * 获取当前操作计数（简化版本）
 */
async function getCurrentOperationCount(env, key) {
  // 这里应该使用 KV 或 Durable Objects 来持久化计数器
  // 简化版本：返回0（在实际部署时需要实现真正的持久化）
  return 0;
}

/**
 * 记录操作（用于审计和速率限制）
 */
async function logOperation(env, operationData) {
  try {
    console.log('Operation logged:', JSON.stringify(operationData));
    // 这里可以发送到外部日志系统或存储到KV
  } catch (error) {
    console.error('Failed to log operation:', error);
  }
}

/**
 * 根据名称获取对应的存储桶
 */
function getBucket(env, bucketName) {
  switch (bucketName) {
    case 'main':
      return env.R2_BUCKET_MAIN;
    case 'backup':
      return env.R2_BUCKET_BACKUP;
    case 'temp':
      return env.R2_BUCKET_TEMP;
    default:
      return null;
  }
}

/**
 * 清理R2对象
 */
async function cleanupR2Objects(bucket, options) {
  const { paths, mode, dryRun, batchSize, maxObjects } = options;

  const results = {
    mode,
    totalFound: 0,
    totalProcessed: 0,
    totalDeleted: 0,
    processedPaths: [],
    deletedObjects: [],
    errors: [],
    truncated: false
  };

  if (mode === 'no-prefix') {
    // 原有功能：清理没有环境前缀的对象
    return await cleanupObjectsWithoutEnvPrefix(bucket, paths, dryRun, batchSize, maxObjects);
  } else if (mode === 'specific-paths') {
    // 删除指定的具体路径
    return await deleteSpecificPaths(bucket, paths, dryRun, batchSize);
  } else if (mode === 'all-under-path') {
    // 删除指定路径下的所有对象
    return await deleteAllUnderPaths(bucket, paths, dryRun, batchSize, maxObjects);
  } else {
    throw new Error(`Unknown mode: ${mode}`);
  }
}

/**
 * 删除指定路径下的所有对象
 */
async function deleteAllUnderPaths(bucket, paths, dryRun, batchSize, maxObjects) {
  const results = {
    mode: 'all-under-path',
    totalFound: 0,
    totalProcessed: 0,
    totalDeleted: 0,
    processedPaths: [],
    deletedObjects: [],
    errors: [],
    truncated: false
  };

  for (const path of paths) {
    console.log(`Processing path: ${path}`);

    try {
      const pathResult = await processPathForDeletion(bucket, path, dryRun, batchSize, maxObjects);

      results.totalFound += pathResult.found;
      results.totalProcessed += pathResult.processed;
      results.totalDeleted += pathResult.deleted;
      results.processedPaths.push({
        path,
        found: pathResult.found,
        processed: pathResult.processed,
        deleted: pathResult.deleted,
        truncated: pathResult.truncated
      });
      results.deletedObjects.push(...pathResult.objects);

      if (pathResult.truncated) {
        results.truncated = true;
      }

      // 如果达到了最大对象限制，停止处理
      if (results.totalProcessed >= maxObjects) {
        console.log(`Reached maxObjects limit (${maxObjects}), stopping`);
        results.truncated = true;
        break;
      }

    } catch (error) {
      console.error(`Error processing path ${path}:`, error);
      results.errors.push({
        path,
        error: error.message
      });
    }
  }

  return results;
}

/**
 * 处理单个路径的删除
 */
async function processPathForDeletion(bucket, path, dryRun, batchSize, maxObjects) {
  const result = {
    found: 0,
    processed: 0,
    deleted: 0,
    objects: [],
    truncated: false
  };

  try {
    let cursor;
    let processedCount = 0;

    do {
      const listResult = await bucket.list({
        prefix: path,
        cursor: cursor,
        limit: Math.min(1000, maxObjects - processedCount)
      });

      const objectsInBatch = listResult.objects;
      result.found += objectsInBatch.length;

      if (objectsInBatch.length > 0) {
        console.log(`Found ${objectsInBatch.length} objects under path "${path}"`);

        if (dryRun) {
          // 试运行模式：只记录，不删除
          result.objects.push(...objectsInBatch.map(obj => ({
            key: obj.key,
            size: obj.size,
            lastModified: obj.uploaded,
            action: 'would_delete'
          })));
          result.processed += objectsInBatch.length;
        } else {
          // 实际删除
          const objectKeys = objectsInBatch.map(obj => obj.key);
          const deleted = await batchDeleteObjects(bucket, objectKeys, batchSize);
          result.deleted += deleted.length;
          result.processed += deleted.length;
          result.objects.push(...deleted.map(key => ({
            key,
            action: 'deleted'
          })));
        }
      }

      cursor = listResult.cursor;
      processedCount += objectsInBatch.length;

      // 检查是否达到最大对象限制
      if (processedCount >= maxObjects) {
        console.log(`Reached maxObjects limit for path ${path}`);
        result.truncated = true;
        break;
      }

    } while (cursor);

  } catch (error) {
    console.error(`Error processing path ${path}:`, error);
    throw error;
  }

  return result;
}

/**
 * 删除指定的具体路径
 */
async function deleteSpecificPaths(bucket, paths, dryRun, batchSize) {
  const results = {
    mode: 'specific-paths',
    totalFound: paths.length,
    totalProcessed: 0,
    totalDeleted: 0,
    processedPaths: [],
    deletedObjects: [],
    errors: []
  };

  if (dryRun) {
    // 试运行模式：检查路径是否存在
    for (const path of paths) {
      try {
        const head = await bucket.head(path);
        if (head) {
          results.deletedObjects.push({
            key: path,
            size: head.size,
            lastModified: head.uploaded,
            action: 'would_delete'
          });
          results.totalProcessed++;
        }
      } catch (error) {
        if (error.message.includes('NotFound')) {
          results.errors.push({
            path,
            error: 'Object not found'
          });
        } else {
          results.errors.push({
            path,
            error: error.message
          });
        }
      }
    }
  } else {
    // 实际删除
    const deleted = await batchDeleteObjects(bucket, paths, batchSize);
    results.totalDeleted = deleted.length;
    results.totalProcessed = deleted.length;
    results.deletedObjects = deleted.map(key => ({
      key,
      action: 'deleted'
    }));
  }

  return results;
}

/**
 * 清理没有环境前缀的对象（原有功能）
 */
async function cleanupObjectsWithoutEnvPrefix(bucket, prefixes, dryRun, batchSize, maxObjects) {
  const results = {
    mode: 'no-prefix',
    totalFound: 0,
    totalProcessed: 0,
    totalDeleted: 0,
    processedPaths: [],
    deletedObjects: [],
    errors: [],
    truncated: false
  };

  // 如果没有指定前缀，扫描常见的无前缀数据
  if (prefixes.length === 0) {
    prefixes = [
      'news/',              // 新闻数据
      'prefix_news_list:',  // 新闻列表
      'reports/',           // 报告数据
      'feeds/',             // Feed数据
      'cache/'              // 缓存数据
    ];
  }

  let totalProcessed = 0;

  for (const prefix of prefixes) {
    console.log(`Scanning prefix: ${prefix}`);

    try {
      const objectsToDelete = await findObjectsWithoutEnvPrefix(bucket, prefix, maxObjects - totalProcessed);
      results.totalFound += objectsToDelete.length;
      totalProcessed += objectsToDelete.length;

      console.log(`Found ${objectsToDelete.length} objects with prefix "${prefix}"`);

      if (objectsToDelete.length > 0) {
        if (dryRun) {
          // 试运行模式：只记录，不删除
          results.deletedObjects.push(...objectsToDelete.map(obj => ({
            key: obj.key,
            size: obj.size,
            lastModified: obj.uploaded,
            action: 'would_delete'
          })));
          results.totalProcessed += objectsToDelete.length;
        } else {
          // 实际删除
          const objectKeys = objectsToDelete.map(obj => obj.key);
          const deleted = await batchDeleteObjects(bucket, objectKeys, batchSize);
          results.totalDeleted += deleted.length;
          results.totalProcessed += deleted.length;
          results.deletedObjects.push(...deleted.map(key => ({
            key,
            action: 'deleted'
          })));
        }
      }

      results.processedPaths.push({
        path: prefix,
        found: objectsToDelete.length,
        processed: objectsToDelete.length
      });

      // 检查是否达到最大对象限制
      if (totalProcessed >= maxObjects) {
        console.log(`Reached maxObjects limit (${maxObjects})`);
        results.truncated = true;
        break;
      }

    } catch (error) {
      console.error(`Error processing prefix ${prefix}:`, error);
      results.errors.push({
        path: prefix,
        error: error.message
      });
    }
  }

  return results;
}

/**
 * 查找没有环境前缀的对象
 */
async function findObjectsWithoutEnvPrefix(bucket, prefix, maxObjects = 10000) {
  const objects = [];
  const envPrefixes = ['dev/', 'staging/', 'prod/']; // 已知的环境前缀

  try {
    let cursor;
    let processedCount = 0;

    do {
      const listResult = await bucket.list({
        prefix: prefix,
        cursor: cursor,
        limit: Math.min(1000, maxObjects - processedCount)
      });

      for (const obj of listResult.objects) {
        // 检查对象键是否以任何环境前缀开头
        const hasEnvPrefix = envPrefixes.some(envPrefix => obj.key.startsWith(envPrefix));

        if (!hasEnvPrefix) {
          // 这是一个没有环境前缀的对象
          objects.push({
            key: obj.key,
            size: obj.size,
            uploaded: obj.uploaded
          });
        }
      }

      cursor = listResult.cursor;
      processedCount += listResult.objects.length;

      // 如果找到了对象，记录进度
      if (listResult.objects.length > 0) {
        console.log(`Scanned ${listResult.objects.length} objects, found ${objects.length} without env prefix so far`);
      }

      // 检查是否达到最大对象限制
      if (processedCount >= maxObjects) {
        console.log(`Reached maxObjects limit while scanning prefix ${prefix}`);
        break;
      }

    } while (cursor);

  } catch (error) {
    console.error(`Error listing objects with prefix ${prefix}:`, error);
    throw error;
  }

  return objects;
}

/**
 * 批量删除对象
 */
async function batchDeleteObjects(bucket, objectKeys, batchSize = 100) {
  const deletedKeys = [];

  for (let i = 0; i < objectKeys.length; i += batchSize) {
    const batch = objectKeys.slice(i, i + batchSize);
    console.log(`Deleting batch ${Math.floor(i/batchSize) + 1}, ${batch.length} objects`);

    try {
      // R2 支持批量删除
      await bucket.delete(batch);
      deletedKeys.push(...batch);

      console.log(`Successfully deleted ${batch.length} objects`);

      // 添加延迟避免过快请求
      if (i + batchSize < objectKeys.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

    } catch (error) {
      console.error(`Error deleting batch:`, error);
      // 继续处理下一批，不要因为一批失败就停止
    }
  }

  return deletedKeys;
}

/**
 * 健康检查端点
 */
async function handleHealthCheck() {
  return new Response(JSON.stringify({
    status: 'healthy',
    service: 'r2-cleanup-worker',
    timestamp: new Date().toISOString(),
    buckets: {
      main: 'ai-news-main',
      backup: 'droid',
      temp: 'emc-zh-cn'
    },
    available_buckets: ['main', 'backup', 'temp']
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}