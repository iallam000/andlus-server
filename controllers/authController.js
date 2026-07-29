// ═══════════════════════════════════════════════════════════════
// متحكّم المصادقة: تسجيل الدخول
// ═══════════════════════════════════════════════════════════════
const { db } = require('../db');
const { verifyPassword, issueToken } = require('../config/auth');

// POST /api/auth/login  { username, password }
async function login(req, res) {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبان' });
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  // رسالة موحّدة سواء المستخدم غير موجود أو كلمة المرور خاطئة (عدم كشف وجود الحساب)
  if (!user) {
    return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });
  }
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });
  }
  // سجل تدقيق
  db.prepare('INSERT INTO audit_log (user_id, action, ip) VALUES (?, ?, ?)')
    .run(user.id, 'login', req.ip);

  const token = issueToken(user);
  // لا نُعيد password_hash إطلاقاً
  const { password_hash, ...safeUser } = user;
  res.json({ token, user: safeUser });
}

// GET /api/auth/me  — بيانات المستخدم الحالي من الرمز
function me(req, res) {
  const user = db.prepare('SELECT id, username, name, role, job, branch, stage, national_id, supervisor_type, supervisor_id, stage_manager_id FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
  res.json({ user });
}

module.exports = { login, me };
