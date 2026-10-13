# 综合素质评价成绩查询系统

大连外国语大学综测成绩查询：学号 + 统一身份认证密码 + 图形验证码登录（服务端代为向学校 CAS 核验，不保存密码），学生只能查到自己的一条记录。
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
   └─ 登录：验证码 → 服务端向学校 CAS 提交账号密码换 ticket → 取学号（并发闸门保护上游）
```

**为什么 300 并发不卡**：查询路径 = JWT 校验 + 内存 Map 取值 + JSON 序列化，
无数据库 IO、无外部调用；压测（4 worker，本机）：

| 场景 | 吞吐 | p50 | p99 | 错误 |
|---|---|---|---|---|
| 1000 请求 / 300 并发 | 2083 req/s | 92ms | 243ms | 0 |
| 10000 请求 / 300 并发 | 5342 req/s | 47ms | 216ms | 0 |

**排名**：专业排名与年级排名全部公布（不遮蔽任何名次），并列名次标注「并列」；大数据专业按原表单独排名、
不参与年级总排名，其年级排名分母为本专业人数，页面附说明。

## 目录

```
server/            Express 服务（cluster 入口 index.js）
  lib/cas.js       学校 CAS 账号密码登录 + ticket 校验（proxyValidate）
  lib/des.js       学校 CAS 登录页使用的 DES 加密（strEnc）
  lib/captcha.js   无状态图形验证码（AES-GCM 加密 token，一次一用）
  routes/          auth（验证码/登录/登出）、score（查询）
  session.js       JWT 会话（httpOnly cookie）
  middleware/      IP 限速 + CAS 并发闸门
scripts/
  import-excel.js  学年度综测总表.xlsx → data/zongce.db（复核分数与排名，与各专业排名 sheet 交叉校验）
  loadtest.mjs     压测脚本
web/               React + antd 前端（手机/电脑自适应）
deploy/            nginx.conf、systemd 服务文件
data/zongce.db     SQLite 数据（导入生成）
```

## 本地开发

```bash
pnpm install                       # 服务端 + 前端依赖（better-sqlite3 无预编译包时会用 node-gyp 源码编译）
node scripts/import-excel.js       # 导入 Excel（默认读项目根目录「大一学年度综测总表.xlsx」，可用 EXCEL_PATH=... 指定）
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

### 数据更新（换新的综测总表）

```bash
cd /opt/zongce
EXCEL_PATH=/path/大一学年度综测总表.xlsx node scripts/import-excel.js   # 重写 zongce.db
systemctl kill -s HUP zongce                                  # 热重载，不停服
```

## 登录流程

1. 首页加载时 `GET /api/captcha` 取验证码（SVG + 加密 token；答案不出现在 token 明文里，5 分钟有效、一次一用）
2. 学生填学号、统一身份认证密码、验证码 → `POST /api/login`
3. 服务端先校验验证码（错了不打学校上游），再向 `CAS_BASE_URL/cas/login` 提交加密后的账号密码，
   拿到 CASTGC 后换 ticket，`proxyValidate` 取学号（`id_number`）与姓名，签发会话 cookie
4. 退出 `POST /api/logout`：清本站会话

密码只在内存中转发给学校 CAS，不落盘、不进日志。登录接口有 IP 限速（10 次/分）+ 全局 CAS 并发闸门。
学校若改版登录页（表单字段/加密方式变化），登录会报 `CAS_PAGE_CHANGED`，需要同步更新 `server/lib/cas.js`。

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
| `ROUND_LABEL` | 大一学年度 | 公示名称（页面标签、总分标题） |
| `CAS_BASE_URL` | https://cas.dlufl.edu.cn | 学校 CAS 地址 |
| `EXCEL_PATH` | 项目根目录/大一学年度综测总表.xlsx | 导入脚本用，Excel 路径 |

## 数据说明

- 主表「学年度总表」：年级排名、专业排名、专业、班级、学号、姓名、各学期（大一上/大一下）的
  品德/学业/文体/综测总分、学年总分、奖学金、备注。学期按两行表头自动识别，换成大二等学期无需改代码。
- 分数与排名全部采信原表；导入时复核 综测=三项之和、学年=各学期之和、排名=按学年总分并列排名，
  并与各「xx排名」sheet 交叉校验（本表：分数 0 差异、排名 0 差异、5 个排名 sheet 0 差异）。
- 主表分隔行「大数据专业（单独排名，不参与年级总排名）」之后的学生单独成一个年级排名组：
  年级排名分母为该组人数（30），分隔行文字作为排名说明显示。
- 某学期无成绩（备注「无大一上综测成绩」等）：该学期显示「无成绩」，学年总分照原表。
- 奖学金、备注（如转专业）原样显示；多项奖学金按「、」拆分展示。
