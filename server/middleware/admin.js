const { env } = require('../config/env');

const ADMIN_ROLES = ['support', 'ops', 'finance', 'superadmin'];
const DELETE_CONFIRMATION_TEXT = 'DELETE';

const POLICY_TABLE = [
  { methods: ['GET'], pattern: /^\/overview$/, roles: ['support', 'ops', 'finance', 'superadmin'], capability: 'overview.read' },
  { methods: ['GET'], pattern: /^\/system\/health$/, roles: ['support', 'ops', 'finance', 'superadmin'], capability: 'system.read' },

  { methods: ['GET'], pattern: /^\/users$/, roles: ['support', 'ops', 'finance', 'superadmin'], capability: 'users.read' },
  { methods: ['GET'], pattern: /^\/users\/[^/]+$/, roles: ['support', 'ops', 'finance', 'superadmin'], capability: 'users.read' },
  { methods: ['PATCH'], pattern: /^\/users\/[^/]+$/, roles: ['ops', 'superadmin'], capability: 'users.update' },
  { methods: ['DELETE'], pattern: /^\/users\/[^/]+$/, roles: ['superadmin'], capability: 'users.delete', destructive: true },

  { methods: ['GET'], pattern: /^\/products$/, roles: ['support', 'ops', 'finance', 'superadmin'], capability: 'products.read' },
  { methods: ['PATCH'], pattern: /^\/products\/[^/]+$/, roles: ['ops', 'superadmin'], capability: 'products.update' },
  { methods: ['DELETE'], pattern: /^\/products\/[^/]+$/, roles: ['ops', 'superadmin'], capability: 'products.delete', destructive: true },

  { methods: ['GET'], pattern: /^\/orders$/, roles: ['support', 'ops', 'finance', 'superadmin'], capability: 'orders.read' },
  { methods: ['GET'], pattern: /^\/orders\/[^/]+$/, roles: ['support', 'ops', 'finance', 'superadmin'], capability: 'orders.read' },
  { methods: ['PATCH'], pattern: /^\/orders\/[^/]+$/, roles: ['ops', 'superadmin'], capability: 'orders.update' },
  { methods: ['PATCH'], pattern: /^\/orders\/[^/]+\/items\/\d+$/, roles: ['ops', 'superadmin'], capability: 'orders.items.update' },
  { methods: ['DELETE'], pattern: /^\/orders\/[^/]+$/, roles: ['ops', 'superadmin'], capability: 'orders.delete', destructive: true },

  { methods: ['GET'], pattern: /^\/payouts$/, roles: ['support', 'ops', 'finance', 'superadmin'], capability: 'payouts.read' },
  { methods: ['GET'], pattern: /^\/payouts\/[^/]+$/, roles: ['support', 'ops', 'finance', 'superadmin'], capability: 'payouts.read' },
  { methods: ['PATCH'], pattern: /^\/payouts\/[^/]+$/, roles: ['finance', 'ops', 'superadmin'], capability: 'payouts.update' },
  { methods: ['POST'], pattern: /^\/payouts\/process-due$/, roles: ['finance', 'ops', 'superadmin'], capability: 'payouts.process_due' },
  { methods: ['POST'], pattern: /^\/payouts\/claim$/, roles: ['finance', 'ops', 'superadmin'], capability: 'payouts.claim' },

  { methods: ['GET'], pattern: /^\/reviews$/, roles: ['support', 'ops', 'finance', 'superadmin'], capability: 'reviews.read' },
  { methods: ['PATCH'], pattern: /^\/reviews\/[^/]+$/, roles: ['support', 'ops', 'superadmin'], capability: 'reviews.update' },
  { methods: ['DELETE'], pattern: /^\/reviews\/[^/]+$/, roles: ['support', 'ops', 'superadmin'], capability: 'reviews.delete', destructive: true },

  { methods: ['GET'], pattern: /^\/chats\/conversations$/, roles: ['support', 'ops', 'finance', 'superadmin'], capability: 'chats.read' },
  { methods: ['GET'], pattern: /^\/chats\/conversations\/[^/]+\/messages$/, roles: ['support', 'ops', 'finance', 'superadmin'], capability: 'chats.read' },
  { methods: ['DELETE'], pattern: /^\/chats\/messages\/[^/]+$/, roles: ['support', 'ops', 'superadmin'], capability: 'chats.messages.delete', destructive: true },
  { methods: ['DELETE'], pattern: /^\/chats\/conversations\/[^/]+$/, roles: ['support', 'ops', 'superadmin'], capability: 'chats.conversations.delete', destructive: true },

  { methods: ['GET'], pattern: /^\/audit-logs$/, roles: ['support', 'ops', 'finance', 'superadmin'], capability: 'audit.read' },

  // Legacy admin payout routes under /api/payouts/admin/*
  { methods: ['GET'], pattern: /^\/admin\/dashboard$/, roles: ['finance', 'ops', 'superadmin'], capability: 'payouts.dashboard.read' },
  { methods: ['POST'], pattern: /^\/admin\/process-due$/, roles: ['finance', 'ops', 'superadmin'], capability: 'payouts.process_due' },
  { methods: ['POST'], pattern: /^\/admin\/claim$/, roles: ['finance', 'ops', 'superadmin'], capability: 'payouts.claim' },
];

function normalizeRole(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!ADMIN_ROLES.includes(normalized)) {
    return '';
  }
  return normalized;
}

function getDefaultRole() {
  const configured = normalizeRole(env?.admin?.defaultRole);
  if (configured) {
    return configured;
  }
  return 'superadmin';
}

function resolveActorRole(req) {
  const explicitRole = normalizeRole(req.user?.adminRole);
  if (explicitRole) {
    return explicitRole;
  }

  const email = String(req.user?.email || '').trim().toLowerCase();
  const superEmails = Array.isArray(env?.admin?.superEmails) ? env.admin.superEmails : [];
  if (email && superEmails.includes(email)) {
    return 'superadmin';
  }

  // Backward compatibility: existing admin users without role metadata remain operable.
  return getDefaultRole();
}

function normalizePath(pathValue) {
  const raw = String(pathValue || '/').trim();
  if (!raw) {
    return '/';
  }

  const normalized = raw.replace(/\/+$/, '');
  return normalized || '/';
}

function resolvePolicy(method, pathValue) {
  const normalizedMethod = String(method || 'GET').toUpperCase();
  const normalizedPath = normalizePath(pathValue);

  for (const policy of POLICY_TABLE) {
    if (!policy.methods.includes(normalizedMethod)) {
      continue;
    }
    if (policy.pattern.test(normalizedPath)) {
      return policy;
    }
  }

  return null;
}

function resolveDeleteMode(req) {
  const incoming = String(
    req.body?.deleteMode
      || req.query?.deleteMode
      || req.headers['x-admin-delete-mode']
      || env?.admin?.defaultDeleteMode
      || 'soft'
  ).trim().toLowerCase();

  return incoming === 'hard' ? 'hard' : 'soft';
}

function resolveDeleteReason(req) {
  return String(
    req.body?.reason
      || req.body?.note
      || req.headers['x-admin-reason']
      || ''
  ).trim();
}

function resolveDeleteConfirmation(req) {
  return String(
    req.body?.confirmationText
      || req.headers['x-admin-confirmation']
      || ''
  ).trim().toUpperCase();
}

module.exports = function (req, res, next) {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({ message: 'Admin access required' });
  }

  const actorRole = resolveActorRole(req);
  const policy = resolvePolicy(req.method, req.path);

  if (!policy) {
    if (actorRole !== 'superadmin') {
      return res.status(403).json({
        message: `Role ${actorRole} is not allowed for this admin action`,
      });
    }

    req.adminRole = actorRole;
    req.adminCapability = 'superadmin.unmapped';
    req.adminDeleteMode = null;
    req.adminDeleteReason = '';
    return next();
  }

  if (!policy.roles.includes(actorRole)) {
    return res.status(403).json({
      message: `Role ${actorRole} cannot perform ${policy.capability}`,
    });
  }

  if (policy.destructive) {
    const confirmation = resolveDeleteConfirmation(req);
    if (confirmation !== DELETE_CONFIRMATION_TEXT) {
      return res.status(400).json({
        message: `Destructive action confirmation is required. Send confirmationText=${DELETE_CONFIRMATION_TEXT}`,
      });
    }

    const reason = resolveDeleteReason(req);
    const minReasonLength = Number(env?.admin?.deleteReasonMinLength || 12);
    if (reason.length < minReasonLength) {
      return res.status(400).json({
        message: `Deletion reason is required (minimum ${minReasonLength} characters)`,
      });
    }

    req.adminDeleteMode = resolveDeleteMode(req);
    req.adminDeleteReason = reason;
  } else {
    req.adminDeleteMode = null;
    req.adminDeleteReason = '';
  }

  req.adminRole = actorRole;
  req.adminCapability = policy.capability;
  return next();
};
