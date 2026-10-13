/**
 * 学年度综测总表.xlsx → data/zongce.db 导入脚本
 *
 * 用法: EXCEL_PATH=/path/to/大一学年度综测总表.xlsx npm run import
 *       （不传则读项目根目录下的「大一学年度综测总表.xlsx」）
 *
 * 主表「学年度总表」前两行是表头:
 *   年级排名 | 专业排名 | 专业 | 班级 | 学号 | 姓名 | 大一上(品德/学业/文体/综测总分) | 大一下(同) | 学年总分 | 奖学金 | 备注
 * - 学期按表头识别：第 1 行（合并单元格）为学期名，第 2 行为分项 → 换成大二上/下等学期无需改代码
 * - 分数、排名全部采信原表（公式均有缓存值）；导入时复核 综测=三项之和、学年=各学期之和、
 *   排名=按学年总分并列排名（1,2,2,4…），并与各「xx排名」sheet 交叉校验，差异打印报告
 * - 主表中的分隔行（如「大数据专业（单独排名，不参与年级总排名）」）之后的学生单独成一个年级排名组：
 *   年级排名分母按组计人数，分隔行文字作为排名说明显示在页面上
 * - 某学期四项全空（备注「无大一上综测成绩」等）→ 该学期记为无成绩，学年总分照原表
 */
import XLSX from 'xlsx';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '../data/zongce.db');
const EXCEL_PATH = process.env.EXCEL_PATH || path.resolve(__dirname, '../大一学年度综测总表.xlsx');
const MAIN_SHEET = '学年度总表';
// 第 2 行表头的分项名 → 字段
const SEMESTER_FIELDS = { 品德总分: 'pinde', 学业总分: 'xueye', 文体总分: 'wenti', 综测总分: 'total' };

const r2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const text = (v) => String(v ?? '').trim();
const eq = (a, b) => Math.abs(a - b) <= 0.011;

const warnings = [];

/** 单元格 → 数值；空 → null；无法解析的文本按 null 计并记录 */
function toNum(raw, context, label) {
  if (typeof raw === 'number' && Number.isFinite(raw)) return r2(raw);
  const s = text(raw);
  if (s === '') return null;
  const n = Number(s);
  if (Number.isFinite(n)) return r2(n);
  warnings.push(`${context} ${label}: 原始值「${s}」无法识别，按空值处理`);
  return null;
}

function toRank(raw) {
  const n = Number(raw);
  return text(raw) !== '' && Number.isInteger(n) && n > 0 ? n : null;
}

/** 解析两行表头：基础列按名字找，学期分组按合并单元格向右延续 */
function parseHeader(h1, h2, sheetName) {
  const col = (name) => h1.findIndex((h) => text(h) === name);
  const cols = {
    gradeRank: col('年级排名'),
    majorRank: col('专业排名'),
    major: col('专业'),
    clazz: col('班级'),
    id: col('学号'),
    name: col('姓名'),
    yearTotal: col('学年总分'),
    scholarship: col('奖学金'),
    remark: col('备注'),
  };
  const missing = ['gradeRank', 'majorRank', 'major', 'id', 'name', 'yearTotal'].filter((k) => cols[k] < 0);
  if (missing.length) throw new Error(`sheet「${sheetName}」表头缺少列: ${missing.join(', ')}`);

  const semesters = [];
  let current = null;
  for (let c = 0; c < h2.length; c += 1) {
    const field = SEMESTER_FIELDS[text(h2[c])];
    if (!field) {
      current = null;
      continue;
    }
    if (text(h1[c])) {
      current = { label: text(h1[c]), cols: {} };
      semesters.push(current);
    }
    if (current) current.cols[field] = c;
  }
  for (const s of semesters) {
    const lack = Object.values(SEMESTER_FIELDS).filter((f) => s.cols[f] === undefined);
    if (lack.length) throw new Error(`sheet「${sheetName}」学期「${s.label}」缺少分项列: ${lack.join(', ')}`);
  }
  if (!semesters.length) throw new Error(`sheet「${sheetName}」未识别到学期分组（第 2 行应为 品德总分/学业总分/文体总分/综测总分）`);
  return { cols, semesters };
}

/** 并列排名（1,2,2,4…）：名次 = 1 + 学年总分严格更高的人数 */
function competitionRanks(list) {
  const totals = list.map((s) => s.data.yearTotal).sort((a, b) => b - a);
  return list.map((s) => 1 + totals.findIndex((t) => t <= s.data.yearTotal + 1e-9));
}

// ---------- 1. 读主表 ----------
if (!fs.existsSync(EXCEL_PATH)) {
  console.error(`[fatal] Excel 不存在: ${EXCEL_PATH}`);
  process.exit(1);
}
console.log(`[import] 读取 ${EXCEL_PATH}`);
const wb = XLSX.readFile(EXCEL_PATH, { cellDates: false });
if (!wb.Sheets[MAIN_SHEET]) {
  console.error(`[fatal] 找不到主表 sheet「${MAIN_SHEET}」，现有: ${wb.SheetNames.join(', ')}`);
  process.exit(1);
}

const [h1 = [], h2 = [], ...mainRows] = XLSX.utils.sheet_to_json(wb.Sheets[MAIN_SHEET], {
  header: 1,
  raw: true,
  defval: null,
});
const { cols: C, semesters: SEMESTERS } = parseHeader(h1, h2, MAIN_SHEET);
console.log(`[import] 识别到学期: ${SEMESTERS.map((s) => s.label).join(' / ')}`);

// 年级排名分组：分隔行之前为第 0 组（全年级），每遇到一条分隔行开启新组
const groups = [{ scope: null, students: [] }];
const students = [];
const seenIds = new Set();
let sumMismatches = 0;

for (const row of mainRows) {
  const studentId = text(row[C.id]);
  const name = text(row[C.name]);
  if (!/^\d{6,}$/.test(studentId)) {
    const caption = row.map(text).find((v) => v !== '');
    if (!caption) continue; // 空行
    if (name) {
      warnings.push(`跳过学号异常的行: 学号=${JSON.stringify(row[C.id])} 姓名=${name}`);
      continue;
    }
    // 「大数据专业（单独排名，不参与年级总排名）」→「大数据专业单独排名，不参与年级总排名」
    const scope = caption.replace(/[（()）]/g, '');
    groups.push({ scope, students: [] });
    console.log(`[import] 分隔行「${caption}」：其后学生单独计年级排名`);
    continue;
  }
  if (!name) {
    warnings.push(`跳过缺少姓名的行: 学号=${studentId}`);
    continue;
  }
  if (seenIds.has(studentId)) {
    warnings.push(`学号重复，跳过后者: ${studentId} ${name}`);
    continue;
  }
  seenIds.add(studentId);
  const ctx = `${studentId} ${name}`;

  const semesters = SEMESTERS.map(({ label, cols }) => {
    const v = Object.fromEntries(
      Object.entries(cols).map(([field, c]) => [field, toNum(row[c], ctx, `${label}-${field}`)])
    );
    if (Object.values(v).every((x) => x === null)) return { label, missing: true };
    const parts = [v.pinde, v.xueye, v.wenti];
    if (parts.some((x) => x === null) || v.total === null) {
      warnings.push(`${ctx} ${label}: 分项不完整（品德/学业/文体/综测 = ${parts.join('/')}/${v.total}）`);
    } else if (!eq(r2(parts.reduce((a, b) => a + b, 0)), v.total)) {
      sumMismatches += 1;
      warnings.push(`${ctx} ${label}: 综测总分 ${v.total} ≠ 三项之和 ${r2(parts.reduce((a, b) => a + b, 0))}，采信原表`);
    }
    return { label, ...v };
  });

  const semesterSum = r2(semesters.reduce((a, s) => a + (s.total ?? 0), 0));
  let yearTotal = toNum(row[C.yearTotal], ctx, '学年总分');
  if (yearTotal === null) {
    warnings.push(`${ctx} 学年总分为空，按各学期综测总分之和 ${semesterSum} 计`);
    yearTotal = semesterSum;
  } else if (!eq(yearTotal, semesterSum)) {
    sumMismatches += 1;
    warnings.push(`${ctx} 学年总分 ${yearTotal} ≠ 各学期之和 ${semesterSum}，采信原表`);
  }

  const student = {
    studentId,
    name,
    major: text(row[C.major]),
    clazz: C.clazz >= 0 ? text(row[C.clazz]) : '',
    data: {
      semesters,
      yearTotal,
      gradeRank: toRank(row[C.gradeRank]),
      majorRank: toRank(row[C.majorRank]),
      scholarship: C.scholarship >= 0 ? text(row[C.scholarship]) || null : null,
      remark: C.remark >= 0 ? text(row[C.remark]) || null : null,
    },
  };
  if (student.data.gradeRank === null) warnings.push(`${ctx} 年级排名为空`);
  if (student.data.majorRank === null) warnings.push(`${ctx} 专业排名为空`);
  students.push(student);
  groups.at(-1).students.push(student);
}

// ---------- 2. 人数分母 + 并列标记 + 排名复核 ----------
let rankMismatches = 0;
function annotate(list, rankKey, countKey, tiedKey, label) {
  const freq = new Map();
  for (const s of list) freq.set(s.data[rankKey], (freq.get(s.data[rankKey]) ?? 0) + 1);
  const calc = competitionRanks(list);
  list.forEach((s, i) => {
    s.data[countKey] = list.length;
    s.data[tiedKey] = s.data[rankKey] !== null && freq.get(s.data[rankKey]) > 1;
    if (s.data[rankKey] !== calc[i]) {
      rankMismatches += 1;
      warnings.push(`${s.studentId} ${s.name} ${label}: 原表 ${s.data[rankKey]}，按学年总分应为 ${calc[i]}，采信原表`);
    }
  });
}

for (const g of groups) {
  annotate(g.students, 'gradeRank', 'gradeCount', 'gradeTied', '年级排名');
  for (const s of g.students) s.data.gradeScope = g.scope;
}
const byMajor = new Map();
for (const s of students) {
  if (!byMajor.has(s.major)) byMajor.set(s.major, []);
  byMajor.get(s.major).push(s);
}
for (const [major, list] of byMajor) annotate(list, 'majorRank', 'majorCount', 'majorTied', `专业排名(${major})`);

// ---------- 3. 与各专业「xx排名」sheet 交叉校验 ----------
const byId = new Map(students.map((s) => [s.studentId, s]));
let crossMismatches = 0;
const crossReport = [];
for (const sheetName of wb.SheetNames.filter((n) => n !== MAIN_SHEET && n.endsWith('排名'))) {
  const [s1 = [], s2 = [], ...grid] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
    header: 1,
    raw: true,
    defval: null,
  });
  let cols;
  try {
    ({ cols } = parseHeader(s1, s2, sheetName));
  } catch (e) {
    warnings.push(`${e.message}，跳过交叉校验`);
    continue;
  }
  let checked = 0;
  let diff = 0;
  for (const row of grid) {
    const id = text(row[cols.id]);
    if (!/^\d{6,}$/.test(id)) continue;
    const s = byId.get(id);
    if (!s) {
      diff += 1;
      warnings.push(`「${sheetName}」中的 ${id} ${text(row[cols.name])} 不在主表`);
      continue;
    }
    checked += 1;
    const t = toNum(row[cols.yearTotal], id, '学年总分');
    if (t === null || !eq(t, s.data.yearTotal) || toRank(row[cols.gradeRank]) !== s.data.gradeRank || toRank(row[cols.majorRank]) !== s.data.majorRank) {
      diff += 1;
      warnings.push(
        `${id} ${s.name}: 主表(学年 ${s.data.yearTotal} / 年级 ${s.data.gradeRank} / 专业 ${s.data.majorRank}) ` +
        `vs「${sheetName}」(${t} / ${toRank(row[cols.gradeRank])} / ${toRank(row[cols.majorRank])})`
      );
    }
  }
  crossMismatches += diff;
  crossReport.push(`${sheetName} ${checked} 人/${diff} 处不一致`);
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
const mismatchTotal = sumMismatches + rankMismatches + crossMismatches;
db.transaction(() => {
  for (const s of students) {
    insert.run(s.studentId, s.name, null, s.major, s.clazz, JSON.stringify(s.data));
  }
  insertMeta.run('imported_at', new Date().toISOString());
  insertMeta.run('student_count', String(students.length));
  insertMeta.run('source_file', path.basename(EXCEL_PATH));
  insertMeta.run('mismatch_count', String(mismatchTotal));
})();
db.close();

// ---------- 5. 报告 ----------
console.log('──────────────────────────────────────');
console.log(`[import] 完成: ${students.length} 名学生 → ${DB_PATH}`);
console.log('[import] 专业分布:', JSON.stringify(Object.fromEntries([...byMajor].map(([m, l]) => [m, l.length]))));
console.log(
  '[import] 年级排名分组:',
  groups.filter((g) => g.students.length).map((g) => `${g.scope ?? '全年级'} ${g.students.length} 人`).join('；')
);
console.log(`[import] 分数复核（综测=三项之和、学年=各学期之和）: ${sumMismatches} 处不一致`);
console.log(`[import] 排名复核（按学年总分并列排名）: ${rankMismatches} 处不一致`);
console.log(`[import] 排名 sheet 交叉校验: ${crossReport.length ? crossReport.join('；') : '⚠ 未找到任何排名 sheet'}`);
if (mismatchTotal > 0) console.log('[import] ⚠ 存在不一致，请对照下方警告人工核对');
console.log(`[import] 数据警告 ${warnings.length} 条:`);
warnings.forEach((w) => console.log(`  - ${w}`));
