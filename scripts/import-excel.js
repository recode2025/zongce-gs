/**
 * 综测总表.xlsx → data/zongce.db 导入脚本
 *
 * 用法: EXCEL_PATH=/path/to/综测总表.xlsx npm run import
 *
 * 说明:
 * - 主表「综测总表」的 品德总分(Q)/学业总分(X)/总分(AF) 是公式且无缓存值，
 *   这里按原始分项重新计算: Q=Σ(G:P), X=Σ(R:W), AF=Q+X+文体总分(AE 静态值)
 * - 排名(A 年级排名 / B 专业排名)为表中静态值，直接采信（与各专业排名 sheet 一致）
 * - 与 5 个专业排名 sheet 的静态总分做交叉校验，差异会打印报告
 * - 脏数据策略: 「缓考」/空 → 按 0 计；无法解析的文本 → 按 0 计并记录备注（页面上可见）
 */
import XLSX from 'xlsx';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '../data/zongce.db');
const EXCEL_PATH = process.env.EXCEL_PATH || 'C:/Users/recode/Desktop/综测总表.xlsx';
const MAIN_SHEET = '综测总表';
const RANK_SHEETS = ['计科排名', '软工排名', '网工排名', '信管排名', '大数据排名'];

const r2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

const warnings = [];

/** 单元格 → 数值；「缓考」→ value:null（不参与计算，页面显示缓考标识）；不可解析文本按 0 计并留备注 */
function toScore(raw, context, label) {
  if (raw === null || raw === undefined || raw === '') return { value: 0, note: null };
  if (typeof raw === 'number' && Number.isFinite(raw)) return { value: r2(raw), note: null };
  const s = String(raw).trim();
  if (s === '') return { value: 0, note: null };
  if (s === '缓考') {
    warnings.push(`${context} ${label}: 缓考，未进行计算`);
    return { value: null, note: '缓考，未进行计算' };
  }
  const n = Number(s);
  if (Number.isFinite(n)) return { value: r2(n), note: null };
  // 「1..7」「.0.5」之类
  const note = `原始值「${s}」无法识别，按 0 分计`;
  warnings.push(`${context} ${label}: ${note}`);
  return { value: 0, note };
}

function toRank(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// ---------- 1. 读主表 ----------
if (!fs.existsSync(EXCEL_PATH)) {
  console.error(`[fatal] Excel 不存在: ${EXCEL_PATH}`);
  process.exit(1);
}
console.log(`[import] 读取 ${EXCEL_PATH}`);
const wb = XLSX.readFile(EXCEL_PATH, { cellDates: false });

const mainRows = XLSX.utils.sheet_to_json(wb.Sheets[MAIN_SHEET], {
  header: 1,
  raw: true,
  defval: null,
  range: 2, // 前两行是表头，数据从第 3 行开始
});

const PINDE_ITEMS = [
  '基础分', '献血', '退役复学', '优秀学生干部、国旗班', '优秀班导生',
  '寝室', '早晚自习', '实践、志愿', '教室卫生', '其他',
];
const XUEYE_ITEMS = [
  '学业成绩加权', '全科额外加分', '不及格学业扣分', '市级以上学术竞赛', '职业技能证书', '科研',
];
const WENTI_ITEMS = [
  '基础分', '学生干部', '非专业领域文体实践', '校园文化活动', '期刊投稿',
];

const students = [];
const seenIds = new Set();
for (const row of mainRows) {
  const studentId = String(row[4] ?? '').trim();
  const name = String(row[5] ?? '').trim();
  if (!studentId && !name) continue; // 空行
  if (!studentId || !name) {
    warnings.push(`跳过不完整行: 学号=${JSON.stringify(row[4])} 姓名=${JSON.stringify(row[5])}`);
    continue;
  }
  if (seenIds.has(studentId)) {
    warnings.push(`学号重复，跳过后者: ${studentId} ${name}`);
    continue;
  }
  seenIds.add(studentId);

  const major = String(row[2] ?? '').trim();
  const clazz = String(row[3] ?? '').trim();
  const ctx = `${studentId} ${name}`;

  const mkItems = (cols, labels, group) =>
    labels.map((label, i) => {
      const { value, note } = toScore(row[cols[i]], ctx, `${group}-${label}`);
      return note ? { label, value, note } : { label, value };
    });
  const sum = (items) => r2(items.reduce((a, b) => a + (b.value ?? 0), 0)); // 缓考(null)按 0 参与合计

  const pindeItems = mkItems([6, 7, 8, 9, 10, 11, 12, 13, 14, 15], PINDE_ITEMS, '品德');
  const xueyeItems = mkItems([17, 18, 19, 20, 21, 22], XUEYE_ITEMS, '学业');
  const wentiItems = mkItems([24, 25, 26, 27, 28], WENTI_ITEMS, '文体');

  const pindeTotal = sum(pindeItems); // Q = Σ(G:P)
  const xueyeTotal = sum(xueyeItems); // X = Σ(R:W)
  // AE 文体总分为静态值（AD 校园文化活动总分已含在 AB+AC 中，不重复累加）
  const wentiStatic = toScore(row[30], ctx, '文体总分(静态)');
  const wentiTotal = wentiStatic.value !== 0 ? wentiStatic.value : sum(wentiItems);
  const total = r2(pindeTotal + xueyeTotal + wentiTotal);

  students.push({
    studentId,
    name,
    major,
    clazz,
    data: {
      pinde: { items: pindeItems, total: pindeTotal },
      xueye: { items: xueyeItems, total: xueyeTotal },
      wenti: { items: wentiItems, total: wentiTotal },
      total,
      majorRank: toRank(row[1]),  // B
      totalRank: toRank(row[0]),  // A（大数据专业为空 → null）
    },
  });
}

// ---------- 2. 读专业排名 sheet 做交叉校验 ----------
const refTotals = new Map(); // 学号 -> {品德, 学业, 文体, 总分}
for (const sheetName of RANK_SHEETS) {
  const ws = wb.Sheets[sheetName];
  if (!ws) {
    warnings.push(`找不到 sheet「${sheetName}」，跳过校验`);
    continue;
  }
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, range: 1 });
  const headerRow = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null })[0] ?? [];
  const col = (want) => headerRow.findIndex((h) => String(h ?? '').trim() === want);
  const cId = col('学号');
  const cP = col('品德总分');
  const cX = col('学业总分');
  const cW = col('文体总分');
  const cT = col('总分');
  if (cId < 0 || cT < 0) {
    warnings.push(`sheet「${sheetName}」表头识别失败，跳过校验`);
    continue;
  }
  for (const row of grid) {
    const id = String(row[cId] ?? '').trim();
    if (!id || !/^\d{6,}$/.test(id)) continue;
    refTotals.set(id, {
      p: r2(Number(row[cP]) || 0),
      x: r2(Number(row[cX]) || 0),
      w: r2(Number(row[cW]) || 0),
      t: r2(Number(row[cT]) || 0),
    });
  }
}

let mismatches = 0;
const mmSamples = [];
for (const s of students) {
  const ref = refTotals.get(s.studentId);
  if (!ref) continue;
  const { pinde, xueye, wenti, total } = s.data;
  const eq = (a, b) => Math.abs(a - b) <= 0.011;
  if (!eq(pinde.total, ref.p) || !eq(xueye.total, ref.x) || !eq(wenti.total, ref.w) || !eq(total, ref.t)) {
    mismatches += 1;
    if (mmSamples.length < 10) {
      mmSamples.push(
        `  ${s.studentId} ${s.name}: 计算(${pinde.total}/${xueye.total}/${wenti.total}/${total}) ` +
        `vs 排名sheet(${ref.p}/${ref.x}/${ref.w}/${ref.t})`
      );
    }
  }
}

// ---------- 3. 专业人数 / 总人数 ----------
const majorCount = {};
for (const s of students) majorCount[s.major] = (majorCount[s.major] ?? 0) + 1;
const totalCount = students.length;
for (const s of students) {
  s.data.majorCount = majorCount[s.major] ?? null;
  s.data.totalCount = totalCount;
}

// ---------- 4. 写库 ----------
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
for (const suffix of ['', '-wal', '-shm']) {
  if (fs.existsSync(DB_PATH + suffix)) fs.rmSync(DB_PATH + suffix);
}
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE students (
    student_id TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    college    TEXT,
    major      TEXT NOT NULL,
    clazz      TEXT,
    data       TEXT NOT NULL
  );
  CREATE INDEX idx_students_major ON students(major);
`);
const insert = db.prepare(
  'INSERT INTO students (student_id, name, college, major, clazz, data) VALUES (?, ?, ?, ?, ?, ?)'
);
const insertMeta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
db.transaction(() => {
  for (const s of students) {
    insert.run(s.studentId, s.name, null, s.major, s.clazz, JSON.stringify(s.data));
  }
  insertMeta.run('imported_at', new Date().toISOString());
  insertMeta.run('student_count', String(totalCount));
  insertMeta.run('source_file', path.basename(EXCEL_PATH));
  insertMeta.run('mismatch_count', String(mismatches));
})();
db.close();

// ---------- 5. 报告 ----------
console.log('──────────────────────────────────────');
console.log(`[import] 完成: ${totalCount} 名学生 → ${DB_PATH}`);
console.log('[import] 专业分布:', JSON.stringify(majorCount));
console.log(`[import] 与排名 sheet 总分校验: ${mismatches} 处不一致（>0 处请人工核对）`);
mmSamples.forEach((l) => console.log(l));
console.log(`[import] 数据警告 ${warnings.length} 条:`);
warnings.forEach((w) => console.log(`  - ${w}`));
if (!refTotals.size) console.log('[import] ⚠ 未读到任何排名 sheet，交叉校验未生效');
