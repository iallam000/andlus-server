// ═══════════════════════════════════════════════════════════════
// طبقة API الوسيطة لنظام الأندلس
// تحاكي واجهة st القديمة (get/set/getShared/setShared) لكن تنادي
// خادم Express بدل window.storage — فتتحوّل الواجهة بأقل تعديل.
// ═══════════════════════════════════════════════════════════════
(function () {
  const BASE = window.ANDLUS_API_BASE || '/api';
  let TOKEN = localStorage.getItem('andlus_token') || null;

  // ─── أداة النداء ───
  async function call(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (TOKEN) headers['Authorization'] = 'Bearer ' + TOKEN;
    const res = await fetch(BASE + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) {
      const hadToken = !!TOKEN;
      TOKEN = null; localStorage.removeItem('andlus_token');
      if (hadToken && !path.includes('/auth/login')) window.location.reload();
      throw new Error('انتهت الجلسة');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'خطأ في الخادم');
    return data;
  }

  // ─── المصادقة ───
  const auth = {
    async login(username, password) {
      const d = await call('POST', '/auth/login', { username, password });
      TOKEN = d.token; localStorage.setItem('andlus_token', d.token);
      return d.user;
    },
    logout() { TOKEN = null; localStorage.removeItem('andlus_token'); },
    isLoggedIn() { return !!TOKEN; },
    async me() { return (await call('GET', '/auth/me')).user; },
  };

  // ─── تحويل مفاتيح st إلى نداءات API ───
  // القراءة: تُعيد نفس بنية البيانات التي كانت في window.storage
  async function get(key) {
    switch (key) {
      case 'users_360c': {
        const { users } = await call('GET', '/users');
        // نحوّل snake_case → camelCase لتوافق الواجهة
        return users.map(mapUserToClient);
      }
      case 'evals_360c': {
        // نبني كائن { empId: { self, peer, ... , peerRaters } } لكل الموظفين
        const { users } = await call('GET', '/users');
        const out = {};
        for (const u of users) {
          if (u.role !== 'employee') continue;
          const d = await call('GET', '/evals/' + u.id);
          out[u.id] = { ...d.eval };
          if (d.peerRaters) out[u.id].peerRaters = d.peerRaters;
          out[u.id].__peerCount = d.peerCount;
        }
        return out;
      }
      case 'idps_360c': {
        const { idps } = await call('GET', '/idps');
        // نحوّل لصيغة { empId: { approved, plan:[...] } }
        const out = {};
        for (const [id, v] of Object.entries(idps)) {
          out[id] = {
            approved: !!v.approved, approvedBy: v.approved_by, approvedAt: v.approved_at,
            needsBranchApproval: !!v.needs_branch_approval, branchApprovedAt: v.branch_approved_at,
            editUnlocked: !!v.edit_unlocked, editUnlockedRow: v.edit_unlocked_row,
            plan: v.plan || [],
          };
        }
        return out;
      }
      case 'impact_360c': return (await call('GET', '/impact')).impact;
      case 'approvals_360c': return (await call('GET', '/approvals')).approvals;
      case 'evalwindow_360c': return await call('GET', '/windows');
      case 'editreq_360c': return (await call('GET', '/edit-requests')).editRequests;
      case 'twiceeval_360c': return (await call('GET', '/twice')).twice;
      case 'intcourses_360c': return (await call('GET', '/courses')).courses;
      case 'locks_360c': return (await call('GET', '/evals/locks')).locks;
      case 'readings_360c': return (await call('GET', '/readings')).readings;
      default: return null;
    }
  }

  // الكتابة: تُترجم إلى نداء API المناسب.
  // ملاحظة: الواجهة القديمة تكتب الكائن كاملاً؛ نحن نرسل ما يلزم فقط.
  // لتقليل التعديل، نوفّر دوالّ مباشرة أدق (setX) تُستدعى من الواجهة المعدّلة.
  async function set(key, value) {
    // للحفاظ على التوافق: بعض المفاتيح تُكتب ككل. نتعامل مع الأهم.
    switch (key) {
      case 'evalwindow_360c':
        // value = { branches: { br: {isOpen,openDate,closeDate} } }
        for (const [br, w] of Object.entries(value.branches || {}))
          await call('POST', '/windows', { branch: br, ...w });
        return;
      case 'twiceeval_360c':
        return void await call('POST', '/twice', { list: value });
      default:
        // المفاتيح المعقّدة (evals/idps/impact) تُحفظ عبر دوال api.* المباشرة
        console.warn('[api] set(' + key + ') يُفضّل استخدام دالة API مباشرة');
        return;
    }
  }

  // ─── الإعدادات المشتركة ───
  async function getShared(key) {
    const map = {
      customComps_360c: 'comps', customJobs_360c: 'jobs',
      customSources_360c: 'sources', customSourceMap_360c: 'sourceMap',
      customWeights_360c: 'weights',
    };
    const skey = map[key]; if (!skey) return null;
    const { settings } = await call('GET', '/settings');
    return settings[skey] ?? null;
  }
  async function setShared(key, value) {
    const map = {
      customComps_360c: 'comps', customJobs_360c: 'jobs',
      customSources_360c: 'sources', customSourceMap_360c: 'sourceMap',
      customWeights_360c: 'weights',
    };
    const skey = map[key]; if (!skey) return;
    await call('POST', '/settings', { key: skey, value });
  }

  // ─── دوال API مباشرة (للعمليات الدقيقة) ───
  const direct = {
    // المستخدمون
    createUser: (u) => call('POST', '/users', u),
    updateUser: (id, u) => call('PUT', '/users/' + id, u),
    deleteUser: (id) => call('DELETE', '/users/' + id),
    // التقييمات
    saveEval: (empId, party, scores, witnesses) =>
      call('POST', '/evals/' + empId, { party, scores, witnesses }),
    lockEval: (empId, party) => call('POST', '/evals/' + empId + '/lock', { party }),
    getEval: (empId) => call('GET', '/evals/' + empId),
    // الخطط
    saveIdp: (empId, idp) => call('PUT', '/idps/' + empId, idp),
    // قياس الأثر
    saveImpact: (empId, rowId, data) => call('PUT', '/impact/' + empId + '/' + rowId, data),
    // الاعتمادات وطلبات التعديل والدورات والقراءات
    setApproval: (key, approved) => call('POST', '/approvals', { key, approved }),
    setEditRequest: (b) => call('POST', '/edit-requests', b),
    setCourse: (b) => call('POST', '/courses', b),
    setReading: (key) => call('POST', '/readings', { key }),
  };

  function mapUserToClient(u) {
    return {
      id: u.id, username: u.username, name: u.name, nationalId: u.national_id,
      role: u.role, job: u.job, branch: u.branch, stage: u.stage,
      supervisorType: u.supervisor_type, supervisorId: u.supervisor_id,
      stageManagerId: u.stage_manager_id,
      branches: u.branches || [], stages: u.stages || [], peerIds: u.peerIds || [],
    };
  }

  // نكشف الواجهة عالمياً
  window.andlusAPI = { auth, get, set, getShared, setShared, ...direct, mapUserToClient };
})();
