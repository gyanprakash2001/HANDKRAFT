const BASE_URL = process.env.ADMIN_SMOKE_BASE_URL || 'http://127.0.0.1:5000/api';
const ADMIN_EMAIL = process.env.ADMIN_SMOKE_ADMIN_EMAIL || 'admin@handkraft.local';
const ADMIN_PASSWORD = process.env.ADMIN_SMOKE_ADMIN_PASSWORD || 'Admin@12345';

function nowTag() {
  return String(Date.now());
}

async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  return {
    status: response.status,
    body,
  };
}

async function run() {
  const smokeEmail = `smoke_user_${nowTag()}@example.com`;
  const smokePassword = 'User@12345';

  const result = {
    baseUrl: BASE_URL,
    smokeUserEmail: smokeEmail,
  };

  const signup = await request('/auth/signup', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Smoke User',
      email: smokeEmail,
      password: smokePassword,
    }),
  });
  result.signupStatus = signup.status;

  const login = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    }),
  });
  result.adminLoginStatus = login.status;

  const token = login.body?.token || '';
  result.adminTokenPresent = Boolean(token);
  if (!token) {
    result.error = 'Admin login failed';
    console.log(JSON.stringify(result, null, 2));
    process.exit(1);
  }

  const authHeader = { Authorization: `Bearer ${token}` };

  const overview = await request('/admin/overview', {
    method: 'GET',
    headers: authHeader,
  });
  result.overviewStatus = overview.status;

  const users = await request('/admin/users?limit=200', {
    method: 'GET',
    headers: authHeader,
  });
  result.usersStatus = users.status;

  const createdUser = Array.isArray(users.body?.users)
    ? users.body.users.find((entry) => String(entry?.email || '').toLowerCase() === smokeEmail.toLowerCase())
    : null;

  result.createdUserFound = Boolean(createdUser?._id);
  if (!createdUser?._id) {
    result.error = 'Created smoke user not found in admin user list';
    console.log(JSON.stringify(result, null, 2));
    process.exit(1);
  }

  const deleteMissingReason = await request(`/admin/users/${createdUser._id}`, {
    method: 'DELETE',
    headers: authHeader,
    body: JSON.stringify({
      confirmationText: 'DELETE',
      deleteMode: 'soft',
    }),
  });
  result.deleteMissingReasonStatus = deleteMissingReason.status;
  result.deleteMissingReasonMessage = deleteMissingReason.body?.message || '';

  const deleteSoft = await request(`/admin/users/${createdUser._id}`, {
    method: 'DELETE',
    headers: authHeader,
    body: JSON.stringify({
      confirmationText: 'DELETE',
      reason: 'Smoke test soft delete validation',
      deleteMode: 'soft',
    }),
  });
  result.deleteSoftStatus = deleteSoft.status;
  result.deleteSoftMode = deleteSoft.body?.mode || '';

  const audit = await request('/admin/audit-logs?action=soft_delete_user&limit=5', {
    method: 'GET',
    headers: authHeader,
  });
  result.auditStatus = audit.status;
  result.auditSoftDeleteEntries = Array.isArray(audit.body?.logs) ? audit.body.logs.length : 0;

  const checks = [
    result.signupStatus === 200,
    result.adminLoginStatus === 200,
    result.overviewStatus === 200,
    result.usersStatus === 200,
    result.deleteMissingReasonStatus === 400,
    result.deleteSoftStatus === 200,
    result.deleteSoftMode === 'soft',
    result.auditStatus === 200,
  ];

  result.ok = checks.every(Boolean);

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('ADMIN_SMOKE_FAILED', err?.message || err);
  process.exit(1);
});