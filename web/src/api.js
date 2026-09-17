/** 统一 API 封装：非 2xx 或 body.ok=false 都抛 Error（带 code/message） */
export async function api(path, options = {}) {
  let res;
  try {
    res = await fetch(path, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
  } catch {
    throw Object.assign(new Error('网络异常，请检查网络后重试'), { code: 'NETWORK' });
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* ignore */
  }
  if (!res.ok || !body?.ok) {
    throw Object.assign(new Error(body?.message || `请求失败 (${res.status})`), {
      code: body?.code ?? `HTTP_${res.status}`,
      status: res.status,
    });
  }
  return body.data;
}
