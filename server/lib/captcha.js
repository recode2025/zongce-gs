/**
 * 无状态图形验证码（cluster 安全）
 *
 * 性能设计：不落任何服务端存储 —— 答案 + 过期时间经 HMAC 签名后随 SVG
 * 一起发给客户端，校验 = 一次 timingSafeEqual，4 个 worker 无需共享状态，
 * 无内存增长、无锁、无缓存失效问题。生成一张 SVG 仅 ~0.1ms 级 CPU。
 *
 * 防重放：5 分钟有效期；配合登录接口已有的 IP 限速（10 次/分）与 CAS
 * 并发闸门，窗口内重放无实际收益。
 */
import crypto from 'node:crypto';
import svgCaptcha from 'svg-captcha';
import config from '../config.js';

const TTL_MS = 5 * 60 * 1000;
const CHARS = '23456789abcdefghjkmnpqrstuvwxyz'; // 去掉易混淆的 0/o/1/l/i

const sign = (data) => crypto.createHmac('sha256', config.jwtSecret).update(data).digest('base64url');

/** @returns {{svg: string, token: string}} */
export function createCaptcha() {
  const c = svgCaptcha.create({
    size: 4,
    noise: 2,
    color: true,
    background: '#eef2f9',
    width: 108,
    height: 40,
    fontSize: 46,
    charPreset: CHARS,
    ignoreChars: '0o1li',
  });
  const payload = Buffer.from(
    JSON.stringify({ t: c.text.toLowerCase(), e: Date.now() + TTL_MS })
  ).toString('base64url');
  return { svg: c.data, token: `${payload}.${sign(payload)}` };
}

/** @returns {boolean} 校验用户输入与签名 token 是否一致且未过期 */
export function verifyCaptcha(token, input) {
  if (!token || !input) return false;
  const dot = token.indexOf('.');
  if (dot <= 0) return false;
  const payload = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expect = sign(payload);
  const a = Buffer.from(mac);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const { t, e } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof e === 'number' && e > Date.now() && t === String(input).trim().toLowerCase();
  } catch {
    return false;
  }
}
