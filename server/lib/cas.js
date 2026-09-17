/**
 * 大连外国语大学 CAS 登录（复刻自 dlufl 参考项目 cas-login.ts）
 *
 * 流程:
 *  1. GET  /cas/login?service=...        → 拿 JSESSIONID cookie + 隐藏表单域 lt / execution
 *  2. POST /cas/login?service=...        → rsa = strEnc(用户名+密码+lt, "1","2","3")，
 *                                          成功后 Set-Cookie 出现 CASTGC（TGT）
 *  3. GET  /cas/login?service=... (带 CASTGC, 不跟随跳转) → Location 里取 ticket
 *  4. POST /cas/proxyValidate            → XML 属性里取 user_id(学号) / user_name(姓名)
 *
 * 全程原生 fetch + 手工维护 Cookie，无额外依赖。
 */
import { strEnc } from './des.js';
import fs from 'node:fs';
import config from '../config.js';

const CAS_BASE = `${config.casBaseUrl.replace(/\/+$/, '')}/cas`; // https://cas.dlufl.edu.cn/cas
const SERVICE_URL = 'https://i.dlufl.edu.cn/dcp/'; // 只用于换取 ticket，不会真的访问
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const TIMEOUT_MS = 15_000;

export class CasError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** 简易 Cookie 容器：只按名覆盖（CAS 单域使用，够用且无歧义） */
class CookieBag {
  constructor() {
    this.map = new Map();
  }
  absorb(res) {
    const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    for (const line of list) {
      const [pair] = line.split(';');
      const eq = pair.indexOf('=');
      if (eq > 0) {
        const name = pair.slice(0, eq).trim();
        const value = pair.slice(eq + 1).trim();
        if (name.toLowerCase() === 'language') continue; // 参考实现同样过滤
        this.map.set(name, value);
      }
    }
  }
  has(name) {
    return this.map.has(name);
  }
  toString() {
    return [...this.map.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

function decodeEntities(s) {
  return String(s ?? '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** 从登录页 HTML 提取隐藏表单域 */
function parseLoginForm(html) {
  const inputs = html.match(/<input\b[^>]*>/gi) ?? [];
  let lt = null;
  let execution = null;
  for (const tag of inputs) {
    const nameM = tag.match(/name="([^"]*)"/i) ?? tag.match(/name='([^']*)'/i);
    const idM = tag.match(/id="([^"]*)"/i);
    const valueM = tag.match(/value="([^"]*)"/i) ?? tag.match(/value='([^']*)'/i);
    const name = nameM?.[1];
    const id = idM?.[1];
    if ((name === 'lt' || id === 'lt') && valueM) lt = decodeEntities(valueM[1]);
    if (name === 'execution' && valueM) execution = decodeEntities(valueM[1]);
  }
  return { lt, execution };
}

/** 从登录页提取报错文案（错在凭证时 CAS 原样返回登录页） */
function parseLoginError(html) {
  const m =
    html.match(/id="errormsghide"[^>]*>\s*([\s\S]*?)\s*</i) ??
    html.match(/id="msg"[^>]*>\s*([\s\S]*?)\s*</i);
  return m ? decodeEntities(m[1]).replace(/<[^>]+>/g, '').trim() : '';
}

/** 从 proxyValidate 的 XML 里取属性（命名空间不敏感、name/value 顺序不敏感） */
function parseCasAttributes(xml) {
  if (/<(?:\w+:)?authenticationFailure/i.test(xml)) {
    throw new CasError('TICKET_INVALID', 'CAS 票据校验失败');
  }
  const attrs = {};
  const tags = xml.match(/<(?:\w+:)?attribute\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const name = tag.match(/\bname="([^"]*)"/i)?.[1];
    const value = tag.match(/\bvalue="([^"]*)"/i)?.[1];
    if (name) attrs[decodeEntities(name)] = value === undefined ? '' : decodeEntities(value);
  }
  // 部分 CAS 版本返回 <cas:user>学号</cas:user> 而非属性列表
  const userTag = xml.match(/<(?:\w+:)?user>\s*([^<]+?)\s*<\/(?:\w+:)?user>/i);
  if (userTag && !attrs.user_id) attrs.user_id = decodeEntities(userTag[1]);
  return attrs;
}

async function casFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'User-Agent': UA,
      ...(options.body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      ...(options.cookie ? { Cookie: options.cookie } : {}),
      ...(options.headers ?? {}),
    },
    redirect: options.redirect ?? 'manual', // 全程手工跟 Cookie/跳转
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return res;
}

/**
 * CAS 登录并取回学生身份。
 * @returns {Promise<{studentId: string, name: string}>}
 * @throws {CasError} code ∈ WRONG_CREDENTIALS | CAPTCHA_REQUIRED | CAS_UNAVAILABLE | NO_USER_ID
 */
export async function casLogin(username, password) {
  if (!username || !password) {
    throw new CasError('BAD_INPUT', '请输入学号和密码');
  }
  const loginUrl = `${CAS_BASE}/login?service=${encodeURIComponent(SERVICE_URL)}&renew=true&_=${Date.now()}`;

  // ---- Step 1: 登录页（lt / execution） ----
  const bag = new CookieBag();
  let res;
  try {
    res = await casFetch(loginUrl);
  } catch (e) {
    throw new CasError('CAS_UNAVAILABLE', '无法连接学校统一认证服务，请稍后再试');
  }
  bag.absorb(res);
  const html = await res.text();
  if (process.env.DEBUG_CAS) fs.writeFileSync(process.env.DEBUG_CAS, html);
  const { lt, execution } = parseLoginForm(html);
  if (!lt || !execution) {
    throw new CasError('CAS_PAGE_CHANGED', '学校认证登录页解析失败，请联系管理员');
  }

  // ---- Step 2: 提交加密凭证 ----
  const rsa = strEnc(`${username}${password}${lt}`, '1', '2', '3');
  const form = new URLSearchParams({
    rsa,
    ul: String(username.length),
    pl: String(password.length),
    lt,
    execution,
    _eventId: 'submit',
  }).toString();

  try {
    res = await casFetch(loginUrl, { method: 'POST', body: form, cookie: bag.toString() });
  } catch (e) {
    throw new CasError('CAS_UNAVAILABLE', '无法连接学校统一认证服务，请稍后再试');
  }
  bag.absorb(res);

  if (!bag.has('CASTGC')) {
    // 该 CAS 皮肤不渲染服务端错误文案：无 CASTGC 即凭证被拒。
    // 仅当页面出现真实验证码元素时按验证码处理（普通页只是引用了 captcha 的 js 库，不算）。
    const body = await res.text();
    const hasCaptchaEl =
      /<input[^>]+name=["']captcha["']/i.test(body) ||
      /id=["']captcha["']/i.test(body) ||
      /class=["'][^"']*\bgeetest\b/i.test(body);
    if (hasCaptchaEl) {
      throw new CasError('CAPTCHA_REQUIRED', '学校认证要求验证码，请先在浏览器中登录一次学校门户后再试');
    }
    const msg = parseLoginError(body); // 某些皮肤会在 #errormsghide / #msg 里渲染文案
    throw new CasError('WRONG_CREDENTIALS', msg || '学号或密码错误');
  }

  // ---- Step 3: 换 service ticket ----
  try {
    res = await casFetch(`${CAS_BASE}/login?service=${encodeURIComponent(SERVICE_URL)}`, {
      cookie: bag.toString(),
    });
  } catch (e) {
    throw new CasError('CAS_UNAVAILABLE', '无法连接学校统一认证服务，请稍后再试');
  }
  const location = res.headers.get('location') ?? '';
  const ticketM = location.match(/[?&]ticket=([^&#]+)/);
  if (!ticketM) {
    throw new CasError('TICKET_INVALID', '获取登录票据失败，请重试');
  }
  const ticket = decodeURIComponent(ticketM[1]);

  // ---- Step 4: proxyValidate 取身份 ----
  try {
    res = await casFetch(`${CAS_BASE}/proxyValidate`, {
      method: 'POST',
      body: new URLSearchParams({ service: SERVICE_URL, ticket }).toString(),
      redirect: 'follow',
    });
  } catch (e) {
    throw new CasError('CAS_UNAVAILABLE', '无法连接学校统一认证服务，请稍后再试');
  }
  const xml = await res.text();
  if (process.env.DEBUG_CAS) fs.writeFileSync(`${process.env.DEBUG_CAS}.xml`, xml);
  const attrs = parseCasAttributes(xml);
  if (process.env.DEBUG_CAS) {
    console.log('[cas][debug] proxyValidate 属性全量:', JSON.stringify(attrs));
  }
  // DLUFL 实测（2026-09）：user_id 是 12 位内部 ID，学号在 id_number（type_name 同值）
  let studentId = attrs.id_number ?? attrs.type_name ?? attrs.user_id ?? attrs.uid ?? attrs.username ?? '';
  // 兜底：若命名字段不是 9 位学号格式，则在全部属性里找符合格式的值
  if (!/^\d{9}$/.test(String(studentId))) {
    const hit = Object.values(attrs).find((v) => /^\d{9}$/.test(String(v ?? '').trim()));
    if (hit) studentId = String(hit).trim();
  }
  if (!studentId) {
    // 诊断：只记属性名和 XML 结构，不落任何属性值（避免 PII 进日志）
    console.error(
      '[cas] proxyValidate 未解析到学号; 属性名:', JSON.stringify(Object.keys(attrs)),
      '状态:', res.status, 'XML头部:', JSON.stringify(xml.slice(0, 260).replace(/\s+/g, ' '))
    );
    throw new CasError('NO_USER_ID', '认证成功但未获取到学号信息，请联系管理员查看日志');
  }
  const name = (attrs.user_name ?? attrs.userName ?? attrs.name ?? '').trim();
  return { studentId: String(studentId).trim(), name };
}
