/**
 * 无状态图形验证码（cluster 安全）
 *
 * 性能设计：不落任何服务端存储 —— 答案 + 过期时间经 AES-256-GCM 加密后随 SVG
 * 一起发给客户端（加密而非仅签名：客户端拿不到答案明文），4 个 worker 无需共享状态。
 * 生成一张 SVG 仅 ~0.1ms 级 CPU。
 *
 * 防重放：5 分钟有效期 + 一次一用（进程内记录已用 token 至过期）。
 * cluster 下各 worker 不共享该记录，同一 token 最多被每个 worker 各用一次；
 * 再叠加登录接口的 IP 限速（10 次/分），不足以支撑撞库。
 */
import crypto from 'node:crypto';
import svgCaptcha from 'svg-captcha';
import config from '../config.js';

const TTL_MS = 5 * 60 * 1000;
const CHARS = '23456789abcdefghjkmnpqrstuvwxyz'; // 去掉易混淆的 0/o/1/l/i
const KEY = crypto.createHash('sha256').update(`captcha:${config.jwtSecret}`).digest();
const IV_LEN = 12;
const TAG_LEN = 16;

// 已使用的 token → 过期时间（过期后解密校验本身就会失败，可以删）
const used = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [token, exp] of used) if (exp <= now) used.delete(token);
}, 60_000).unref();

function seal(obj) {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, enc, cipher.getAuthTag()]).toString('base64url');
}

function open(token) {
  const buf = Buffer.from(token, 'base64url');
  if (buf.length <= IV_LEN + TAG_LEN) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, buf.subarray(0, IV_LEN));
    decipher.setAuthTag(buf.subarray(buf.length - TAG_LEN));
    const dec = Buffer.concat([decipher.update(buf.subarray(IV_LEN, buf.length - TAG_LEN)), decipher.final()]);
    return JSON.parse(dec.toString('utf8'));
  } catch {
    return null; // 被篡改 / 伪造
  }
}

/** @returns {{svg: string, token: string}} */
export function createCaptcha() {
  const c = svgCaptcha.create({
    size: 4,
    noise: 2,
    color: true,
    background: '#f3f1ec',
    width: 108,
    height: 40,
    fontSize: 46,
    charPreset: CHARS,
    ignoreChars: '0o1li',
  });
  return { svg: c.data, token: seal({ t: c.text.toLowerCase(), e: Date.now() + TTL_MS }) };
}

/** @returns {boolean} 校验用户输入与 token 是否一致、未过期且未使用过 */
export function verifyCaptcha(token, input) {
  if (!token || !input || token.length > 512) return false;
  const data = open(token);
  if (!data || typeof data.e !== 'number' || data.e <= Date.now() || used.has(token)) return false;
  used.set(token, data.e); // 无论答对答错都作废，防止对同一张图反复试
  return data.t === String(input).trim().toLowerCase();
}
