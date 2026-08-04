// ═══════════════════════════════════════════════════════════════
// متحكّم تقييم الأداء 360°
// يشمل: حفظ درجات كل طرف، منطق تقييم الزملاء المتعدّد وإخفاء الهوية
// ═══════════════════════════════════════════════════════════════
const { db } = require('../db');

const PEER_MIN_RATERS = 2;   // لا تظهر درجة الزملاء إلا بمُقيّمَين فأكثر

// ─── قراءة تقييم موظف (كل الأطراف) ───
// GET /api/evals/:employeeId
// تُعيد الدرجات منظّمة: { self:{comp:{idx:score}}, peer:{...avg}, supervisor:{...}, stage_mgr:{...} }
// مع peerRaters (التفصيل) فقط لمن يملك صلاحية (المديرون)
function getEmployeeEval(req, res) {
  const empId = req.params.employeeId;
  const rows = db.prepare('SELECT party, rater_id, comp_key, item_index, score FROM eval_scores WHERE employee_id = ?').all(empId);

  const result = { self:{}, peer:{}, supervisor:{}, stage_mgr:{}, subordinate:{}, beneficiary:{} };
  // الأطراف مجهولة الهوية (متعددة المُقيّمين): تُجمَّع تحت المُقيّم لحساب المتوسط
  const ANON = ['peer','subordinate','beneficiary'];
  const raters = { peer:{}, subordinate:{}, beneficiary:{} };  // { party: { raterId: { comp:{idx:score} } } }

  for (const r of rows) {
    if (ANON.includes(r.party)) {
      const R = raters[r.party];
      if (!R[r.rater_id]) R[r.rater_id] = {};
      if (!R[r.rater_id][r.comp_key]) R[r.rater_id][r.comp_key] = {};
      R[r.rater_id][r.comp_key][r.item_index] = r.score;
    } else {
      if (!result[r.party][r.comp_key]) result[r.party][r.comp_key] = {};
      result[r.party][r.comp_key][r.item_index] = r.score;
    }
  }

  // متوسط كل طرف مجهول لكل بند (بشرط الحد الأدنى) — يظهر للجميع دون كشف الهوية
  ANON.forEach(p => { result[p] = computePeerAvg(raters[p]); });

  // التفصيل (اسم كل مُقيّم ودرجته) للمديرين فقط
  const canSeeDetail = ['stage_mgr', 'branch_mgr', 'admin'].includes(req.user.role);
  const payload = { eval: result };
  if (canSeeDetail) {
    payload.peerRaters = raters.peer;
    payload.subordinateRaters = raters.subordinate;
    payload.beneficiaryRaters = raters.beneficiary;
  }
  // العدد يظهر للجميع (يعرف كم قيّمه دون من)
  payload.peerCount = Object.keys(raters.peer).length;
  payload.subordinateCount = Object.keys(raters.subordinate).length;
  payload.beneficiaryCount = Object.keys(raters.beneficiary).length;

  res.json(payload);
}

// حساب متوسط تقييمات الزملاء لكل بند (لا يظهر بند قيّمه أقل من الحد)
function computePeerAvg(peerRaters) {
  const raterIds = Object.keys(peerRaters);
  const result = {};
  const comps = new Set();
  raterIds.forEach(rid => Object.keys(peerRaters[rid]).forEach(ck => comps.add(ck)));
  comps.forEach(ck => {
    const byItem = {};
    raterIds.forEach(rid => {
      const cs = peerRaters[rid][ck] || {};
      Object.keys(cs).forEach(idx => {
        const v = Number(cs[idx]);
        if (v > 0) (byItem[idx] = byItem[idx] || []).push(v);
      });
    });
    const itemAvgs = {};
    Object.keys(byItem).forEach(idx => {
      const arr = byItem[idx];
      if (arr.length >= PEER_MIN_RATERS)
        itemAvgs[idx] = Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100;
    });
    if (Object.keys(itemAvgs).length) result[ck] = itemAvgs;
  });
  return result;
}

// ─── حفظ تقييم طرف ───
// POST /api/evals/:employeeId
// body: { party, scores:{comp:{idx:score}}, witnesses:{comp:text}, raterId? }
// للزملاء: raterId = المستخدم الحالي (يؤخذ من الرمز، لا يُوثق به من الطلب)
function saveEval(req, res) {
  const empId = req.params.employeeId;
  const { party, scores = {}, witnesses = {} } = req.body || {};
  if (!['self', 'peer', 'supervisor', 'stage_mgr'].includes(party)) {
    return res.status(400).json({ error: 'طرف تقييم غير صالح' });
  }
  // للزملاء: المُقيّم هو المستخدم الحالي دائماً (أمان — لا ينتحل غيره)
  const raterId = party === 'peer' ? req.user.id : null;

  const tx = db.transaction(() => {
    // نحذف درجات هذا الطرف (وهذا المُقيّم للزملاء) ثم نُدرج الجديدة
    if (party === 'peer') {
      db.prepare('DELETE FROM eval_scores WHERE employee_id=? AND party=? AND rater_id=?').run(empId, party, raterId);
    } else {
      db.prepare('DELETE FROM eval_scores WHERE employee_id=? AND party=?').run(empId, party);
    }
    const ins = db.prepare('INSERT INTO eval_scores (employee_id,party,rater_id,comp_key,item_index,score) VALUES (?,?,?,?,?,?)');
    for (const comp of Object.keys(scores)) {
      for (const idx of Object.keys(scores[comp])) {
        const v = Number(scores[comp][idx]);
        if (v > 0) ins.run(empId, party, raterId, comp, Number(idx), v);
      }
    }
    // الشواهد (للمتابع/المدير المباشر)
    if (party === 'supervisor' || party === 'stage_mgr') {
      const insW = db.prepare('INSERT OR REPLACE INTO eval_witnesses (employee_id,party,comp_key,witness_text) VALUES (?,?,?,?)');
      for (const comp of Object.keys(witnesses)) {
        if (witnesses[comp]) insW.run(empId, party, comp, witnesses[comp]);
      }
    }
  });
  tx();
  res.json({ ok: true });
}

// ─── قفل التقييم (حفظ نهائي = "تم") ───
// POST /api/evals/:employeeId/lock  body:{ party, raterId? }
function lockEval(req, res) {
  const empId = req.params.employeeId;
  const { party } = req.body || {};
  const raterId = party === 'peer' ? req.user.id : null;
  const key = party === 'peer' ? `${empId}__peer__${raterId}` : `${empId}__${party}`;
  db.prepare('INSERT OR REPLACE INTO eval_locks (lock_key, locked_at) VALUES (?, datetime(\'now\'))').run(key);
  res.json({ ok: true, lockKey: key });
}

// ─── قراءة كل الأقفال (لحساب حالات "تم") ───
// GET /api/evals/locks
function getLocks(req, res) {
  const rows = db.prepare('SELECT lock_key, locked_at FROM eval_locks').all();
  const locks = {};
  rows.forEach(r => { locks[r.lock_key] = { lockedAt: r.locked_at }; });
  res.json({ locks });
}

module.exports = { getEmployeeEval, saveEval, lockEval, getLocks };
