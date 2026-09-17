/**
 * 压测脚本：模拟 1000 名学生、300 并发查询 /api/score
 *
 * 用法（在服务器或本机，服务已启动）:
 *   node scripts/loadtest.mjs                # 默认 http://localhost:3000, 1000 请求 / 300 并发
 *   CONCURRENCY=300 TOTAL=10000 node scripts/loadtest.mjs
 *
 * 直打 /api/score（跳过 CAS 登录，那是学校上游的瓶颈，已由并发闸门保护），
 * 验证的是本系统自身的查询吞吐与延迟。
 */
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE || 'http://localhost:3000';
const TOTAL = Number(process.env.TOTAL || 1000);
const CONCURRENCY = Number(process.env.CONCURRENCY || 300);
const SECRET = process.env.JWT_SECRET || 'dev-only-secret';

// 从库里取学号（压测真实数据量：1021 人）
const db = new Database(path.resolve(__dirname, '../data/zongce.db'), { readonly: true });
const ids = db.prepare('SELECT student_id FROM students').all().map((r) => r.student_id);
db.close();

const tokens = ids.map((sid) => jwt.sign({ sid, name: 'load' }, SECRET, { expiresIn: '2h' }));
console.log(`目标: ${BASE}  请求 ${TOTAL}  并发 ${CONCURRENCY}  学号池 ${tokens.length}`);

const latencies = [];
let done = 0;
let errors = 0;
const t0 = performance.now();

async function worker() {
  while (done < TOTAL) {
    done += 1;
    const token = tokens[done % tokens.length];
    const s = performance.now();
    try {
      const res = await fetch(`${BASE}/api/score`, {
        headers: {
          Cookie: `zc_token=${token}`,
          // 模拟 1000 名不同学生（真实场景经 DCDN 回源，每请求不同 X-Forwarded-For）
          'X-Forwarded-For': `10.${(done >> 8) % 256}.${done % 256}.${(done * 7) % 254 + 1}`,
        },
        signal: AbortSignal.timeout(30_000),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) errors += 1;
    } catch {
      errors += 1;
    }
    latencies.push(performance.now() - s);
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

const secs = (performance.now() - t0) / 1000;
latencies.sort((a, b) => a - b);
const pct = (p) => latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))];

console.log('──────────────────────────────────────');
console.log(`完成: ${latencies.length} 请求 in ${secs.toFixed(2)}s → ${(latencies.length / secs).toFixed(0)} req/s`);
console.log(`延迟: p50=${pct(50).toFixed(1)}ms  p95=${pct(95).toFixed(1)}ms  p99=${pct(99).toFixed(1)}ms  max=${latencies[latencies.length - 1].toFixed(1)}ms`);
console.log(`错误: ${errors}`);
process.exit(errors > 0 ? 1 : 0);
