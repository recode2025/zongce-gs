/**
 * 大连外国语大学 CAS 跳转登录（标准 CAS 2.0 协议，浏览器直接在学校认证页输入账号密码）
 *
 * 流程:
 *  1. 浏览器访问 /api/cas/login        → 302 到 {CAS}/login?service={PUBLIC_URL}/api/cas/callback
 *  2. 学生在学校认证页登录              → CAS 302 回 service，并附带 ?ticket=ST-...
 *  3. /api/cas/callback 用 ticket 调 {CAS}/proxyValidate → XML 属性里取学号 / 姓名
 *  4. 签发本站会话 cookie，302 回首页
 *
 * 本服务全程不接触学生密码。service 地址需在学校 CAS 侧登记（白名单）。
 */
import config from '../config.js';

const CAS_BASE = `${config.casBaseUrl.replace(/\/+$/, '')}/cas`; // https://cas.dlufl.edu.cn/cas
const TIMEOUT_MS = 15_000;

export class CasError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
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

/** 学校认证登录页地址 */
export function buildLoginUrl(service) {
  return `${CAS_BASE}/login?service=${encodeURIComponent(service)}`;
}

/** 学校认证登出地址（登出后回到 returnTo） */
export function buildLogoutUrl(returnTo) {
  return `${CAS_BASE}/logout?service=${encodeURIComponent(returnTo)}`;
}

/**
 * 校验 CAS 回调带回的 ticket，取回学生身份。
 * service 必须与跳转登录时的 service 完全一致，否则 CAS 判票据无效。
 * @returns {Promise<{studentId: string, name: string}>}
 * @throws {CasError} code ∈ BAD_INPUT | TICKET_INVALID | CAS_UNAVAILABLE | NO_USER_ID
 */
export async function validateTicket(service, ticket) {
  if (!ticket || !/^[\w.-]+$/.test(ticket)) {
    throw new CasError('BAD_INPUT', '登录票据缺失或格式错误，请重新登录');
  }
  const url = `${CAS_BASE}/proxyValidate?${new URLSearchParams({ service, ticket })}`;
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new CasError('CAS_UNAVAILABLE', '无法连接学校统一认证服务，请稍后再试');
  }
  if (!res.ok) {
    throw new CasError('CAS_UNAVAILABLE', `学校统一认证服务异常 (${res.status})，请稍后再试`);
  }
  const xml = await res.text();
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
      'XML头部:', JSON.stringify(xml.slice(0, 260).replace(/\s+/g, ' '))
    );
    throw new CasError('NO_USER_ID', '认证成功但未获取到学号信息，请联系管理员查看日志');
  }
  const name = (attrs.user_name ?? attrs.userName ?? attrs.name ?? '').trim();
  return { studentId: String(studentId).trim(), name };
}
