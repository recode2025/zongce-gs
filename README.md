# 综合素质评价成绩查询系统

大连外国语大学综测成绩查询：学校 CAS 统一认证登录，学生只能查到自己的一条记录。
Node.js + Express + SQLite + React(antd 5)，单机部署，面向 1000 人查询 / 300 并发设计。

## 架构

```
学生手机/电脑
   │ HTTPS
   ▼
阿里云 DCDN（全站加速）──── 静态资源边缘缓存（immutable 1 年）
   │ 动态回源
   ▼
nginx（可选层：压缩 / 慢客户端缓冲 / 兜底限流）
   ▼
Node cluster × 4 worker（4 核）
   ├─ 查询：启动时全量加载 SQLite → 内存 Map，O(1) 命中，零 DB 竞争
   └─ 登录：学校 CAS（并发闸门保护上游，最多 20 个并发打 CAS）
```

**为什么 300 并发不卡**：查询路径 = JWT 校验 + 内存 Map 取值 + JSON 序列化，
无数据库 IO、无外部调用；压测（4 worker，本机）：

| 场景 | 吞吐 | p50 | p99 | 错误 |
|---|---|---|---|---|
| 1000 请求 / 300 并发 | 2083 req/s | 92ms | 243ms | 0 |
| 10000 请求 / 300 并发 | 5342 req/s | 47ms | 216ms | 0 |

**排名保密**：第一轮综测总排名前 30 名（`HIDE_TOP_N`），其专业排名与总排名在
**服务端**被替换为空（`rankHidden: true`），真实名次不出现在任何响应里，
抓包/改前端都拿不到。大数据专业按原表不参与年级排名。

## 目录

```
server/            Express 服务（cluster 入口 index.js）
  lib/cas.js       学校 CAS 登录（复刻 dlufl 项目，含 DES 加密 des.js）
  routes/          auth（登录/登出）、score（查询）
  session.js       JWT 会话（httpOnly cookie）
  middleware/      IP 限速 + CAS 并发闸门
scripts/
  import-excel.js  综测总表.xlsx → data/zongce.db（自动算总分，与排名 sheet 交叉校验）
  loadtest.mjs     压测脚本
web/               React + antd 前端（手机/电脑自适应）
deploy/            nginx.conf、systemd 服务文件
data/zongce.db     SQLite 数据（导入生成）
```

## 本地开发

```bash
npm install                        # 服务端依赖
npm --prefix web install           # 前端依赖
node scripts/import-excel.js       # 导入 Excel（默认读桌面路径，可用 EXCEL_PATH=... 指定）
npm run dev                        # 服务 :3000
npm --prefix web run dev           # 前端 :5173（/api 代理到 3000）
```

## 生产部署（Linux 4c4g）

```bash
# 1. 代码放到 /opt/zongce
apt install -y nginx
cd /opt/zongce
npm install --omit=dev
npm --prefix web install
npm --prefix web run build         # 生成 web/dist，服务端直接托管

# 2. 配置
cp .env.example .env
vim .env                           # 必改 JWT_SECRET=$(openssl rand -hex 32)
node scripts/import-excel.js       # 首次导入（EXCEL_PATH 指向 xlsx）

# 3. systemd
cp deploy/zongce.service /etc/systemd/system/
#   （确认文件内 User/路径，需要 chown -R www-data:www-data /opt/zongce）
systemctl daemon-reload && systemctl enable --now zongce

# 4. nginx
cp deploy/nginx.conf /etc/nginx/conf.d/zongce.conf
#   修改 server_name 后 nginx -t && systemctl reload nginx
```

### 数据更新（第二轮成绩）

```bash
cd /opt/zongce
EXCEL_PATH=/path/第二轮.xlsx node scripts/import-excel.js   # 重写 zongce.db
systemctl kill -s HUP zongce                                  # 热重载，不停服
```

## 阿里云 DCDN 配置

控制台 → 全站加速 DCDN → 添加域名：

1. **业务类型**：全站加速；**源站**：`http://<服务器IP>`（80 走 nginx；无 nginx 可直接 `:3000`）
2. **HTTPS**：上传/托管证书，开启「强制 HTTPS 跳转」+ HTTP/2
3. **缓存规则**（重要，服务端响应头已配好，控制台按此对齐）：
   - `/assets/*`（带 hash 的 js/css）→ 缓存 1 年（源站已发 `immutable`）
   - `/`、`/index.html` → 不缓存（源站 `no-cache`，保证发版即生效）
   - `/api/*`、`/healthz` → 不缓存（源站 `no-store`）
4. **性能**：开启 Brotli 智能压缩
5. **安全**（兜底，服务端已有一层）：频次访问拦截 ~60 次/分钟/IP；可再开 CC 防护
6. **回源头**：确认传递 `X-Forwarded-For`（默认开启）——限流按真实学生 IP 计数依赖它

回源网段写入 nginx 的 `set_real_ip_from`（网段列表见阿里云文档「DCDN 回源 IP」），
避免伪造 XFF 绕过限流。

## 配置项（.env）

| 变量 | 默认 | 说明 |
|---|---|---|
| `JWT_SECRET` | 无（生产必填） | 会话签名密钥 |
| `WORKERS` | 4 | cluster 进程数 |
| `HIDE_TOP_N` | 30 | 前 N 名不公布排名 |
| `HIDE_RULE` | total | `total`=按总排名判前 N；`major`=按专业排名判前 N |
| `ROUND_LABEL` | 第一轮 | 轮次名称 |
| `EXCEL_PATH` | – | 导入脚本用，Excel 路径 |

## 数据说明

- 品德/学业总分由分项重算（原表公式无缓存值），与各专业「排名 sheet」静态总分
  **交叉校验 0 差异**；排名直接采信原表静态值。
- 「缓考」：该项显示 *缓考，未进行计算*，按 0 分计入合计（与官方排名口径一致）。
- 无法识别的脏数据（如 `1..7`）：按 0 计，导入日志会逐条列出。
