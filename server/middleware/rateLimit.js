/**
 * 轻量限流（进程内存实现，无外部依赖）
 * - 登录接口: 按 IP 限速 + 全局并发闸门（保护学校 CAS 上游，这是最脆弱的环节）
 * - 查询接口: 按 IP 限速（正常用户根本碰不到上限）
 *
 * 注意: 生产环境经 nginx/DCDN 代理时已配置 trust proxy，取 X-Forwarded-For 首个 IP。
 */

const WINDOW_MS = 60_000;

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  return req.socket.remoteAddress ?? 'unknown';
}

export function makeIpLimiter({ windowMs = WINDOW_MS, max = 30, message = '请求过于频繁，请稍后再试' } = {}) {
  const buckets = new Map(); // ip -> { count, resetAt }

  // 定期清理，防内存缓慢增长
  setInterval(() => {
    const now = Date.now();
    for (const [ip, b] of buckets) if (b.resetAt <= now) buckets.delete(ip);
  }, windowMs).unref();

  return function ipLimiter(req, res, next) {
    const ip = clientIp(req);
    const now = Date.now();
    let b = buckets.get(ip);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(ip, b);
    }
    b.count += 1;
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - b.count));
    if (b.count > max) {
      res.setHeader('Retry-After', Math.ceil((b.resetAt - now) / 1000));
      return res.status(429).json({ ok: false, code: 'RATE_LIMITED', message });
    }
    next();
  };
}

/**
 * 全局并发闸门：同一时刻最多 maxConcurrent 个请求在打 CAS，
 * 超出的排队等待（上限 burst，防止请求无限堆积）。
 * 300 并发涌入时按闸门节流，学校 CAS 无感知。
 */
export function makeConcurrencyGate({ maxConcurrent = 20, burst = 200, waitMs = 15_000 } = {}) {
  let active = 0;
  const queue = [];

  const settle = () => {
    while (active < maxConcurrent && queue.length > 0) {
      const { resolve, timer } = queue.shift();
      clearTimeout(timer);
      active += 1;
      resolve();
    }
  };

  return function concurrencyGate(req, res, next) {
    if (queue.length >= burst) {
      return res.status(503).json({ ok: false, code: 'BUSY', message: '当前查询人数较多，请稍后再试' });
    }
    const done = () => {
      res.on('finish', () => {
        active -= 1;
        settle();
      });
      next();
    };
    const timer = setTimeout(() => {
      const i = queue.findIndex((q) => q.timer === timer);
      if (i >= 0) queue.splice(i, 1);
      res.status(503).json({ ok: false, code: 'BUSY', message: '当前查询人数较多，请稍后再试' });
    }, waitMs);
    queue.push({ resolve: done, timer });
    settle();
  };
}
