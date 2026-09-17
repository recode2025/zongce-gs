/**
 * 入口：cluster 多进程。
 * - 4 核机器 → 4 个 worker，各自全量加载数据进内存（每份仅 ~2MB，4G 内存毫无压力）
 * - worker 崩溃自动重启；SIGHUP 热重载数据（导入新 Excel 后 kill -HUP 即可，不用停服）
 */
import cluster from 'node:cluster';
import os from 'node:os';
import config from './config.js';
import { store } from './db.js';
import { createApp } from './app.js';

const workerCount = config.workers > 0 ? config.workers : Math.min(4, os.availableParallelism());

if (!config.jwtSecret || config.jwtSecret === 'change-me-to-a-long-random-string') {
  if (config.isProd) {
    console.error('[fatal] 生产环境必须设置 JWT_SECRET（.env 里改成 openssl rand -hex 32 生成的随机串）');
    process.exit(1);
  }
  console.warn('[warn] 未设置 JWT_SECRET，使用开发默认值 —— 生产环境必须配置');
}

if (cluster.isPrimary) {
  console.log(`[master] 启动 ${workerCount} 个 worker (pid=${process.pid})`);
  for (let i = 0; i < workerCount; i += 1) cluster.fork();
  cluster.on('exit', (worker, code, signal) => {
    console.error(`[master] worker ${worker.process.pid} 退出 (${signal ?? code})，重启`);
    cluster.fork();
  });
  // 热重载：导入新数据后 kill -HUP <master pid>
  process.on('SIGHUP', () => {
    console.log('[master] SIGHUP → 通知所有 worker 重载数据');
    for (const worker of Object.values(cluster.workers)) worker.send({ cmd: 'reload' });
  });
} else {
  store.load(); // 启动即全量进内存，查询期零 DB 访问
  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`[worker ${process.pid}] listening on :${config.port}`);
  });
  // 温和应对瞬时重启（systemd restart / 部署）
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  process.on('message', (msg) => {
    if (msg?.cmd === 'reload') {
      try {
        store.load();
        console.log(`[worker ${process.pid}] 数据已热重载 (${store.size} 条)`);
      } catch (e) {
        console.error(`[worker ${process.pid}] 热重载失败:`, e.message);
      }
    }
  });
}
