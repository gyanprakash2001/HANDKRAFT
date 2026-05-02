import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  AppBar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  CssBaseline,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Collapse,
  Drawer,
  FormControl,
  Grid,
  IconButton,
  InputLabel,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  MenuItem,
  Pagination,
  Paper,
  Select,
  Snackbar,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Toolbar,
  Typography,
} from '@mui/material';
import LogoutIcon from '@mui/icons-material/Logout';
import RefreshIcon from '@mui/icons-material/Refresh';
import DeleteIcon from '@mui/icons-material/Delete';
import VisibilityIcon from '@mui/icons-material/Visibility';
import EditIcon from '@mui/icons-material/Edit';
import {
  BrowserRouter,
  HashRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import './App.css';

import { fetchProfile, loginAdmin, logoutAdmin } from './api/auth';
import { getStoredToken } from './api';
import {
  createCsrActivity,
  claimPayouts,
  deleteConversation,
  deleteMessage,
  deleteOrder,
  deleteProduct,
  deleteReview,
  deleteUser,
  fetchAdminOverview,
  fetchAuditLogs,
  fetchCsrActivities,
  fetchCsrSummary,
  fetchConversationMessages,
  fetchConversations,
  fetchOrderDetail,
  fetchOrders,
  fetchPayouts,
  fetchProducts,
  fetchReviews,
  fetchSystemHealth,
  fetchUsers,
  processDuePayouts,
  setCsrActivityPublishState,
  updateCsrActivity,
  updateOrder,
  updateOrderItem,
  updatePayout,
  updateProduct,
  updateReview,
  updateUser,
} from './api/admin';

const drawerWidth = 260;

const ORDER_STATUS_OPTIONS = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];
const PAYMENT_STATUS_OPTIONS = ['pending', 'completed', 'failed', 'refunded'];
const ITEM_STATUS_OPTIONS = ['new', 'processing', 'packed', 'shipped', 'delivered', 'cancelled'];
const PAYOUT_STATUS_OPTIONS = ['awaiting_delivery', 'on_hold', 'ready_for_payout', 'paid', 'failed', 'reversed', 'cancelled'];
const KYC_STATUS_OPTIONS = ['pending', 'verified', 'rejected'];
const ADMIN_ROLE_OPTIONS = ['support', 'ops', 'finance', 'superadmin'];
const AppRouter = import.meta.env.PROD ? HashRouter : BrowserRouter;

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
}

function safeError(error, fallback = 'Request failed') {
  return error?.response?.data?.message || error?.message || fallback;
}

const defaultRowId = (row) => row?._id || row?.id;

function promptDeletePayload(targetLabel) {
  // Simplified single-step confirmation flow used by default.
  // Keep this helper for backward compatibility, but default to a single confirm.
  const ok = window.confirm(`Are you sure you want to delete ${targetLabel}? This will permanently remove it.`);
  if (!ok) return null;
  return { deleteMode: 'hard', reason: 'Admin confirmed single-step delete', confirmationText: 'DELETE' };
}

function useBulkSelection(rows, getId = defaultRowId) {
  const rowIds = useMemo(() => rows.map((row) => getId(row)).filter(Boolean), [rows, getId]);
  const rowIdSet = useMemo(() => new Set(rowIds), [rowIds]);
  const [selectedIdsState, setSelectedIdsState] = useState([]);

  const selectedIds = useMemo(() => selectedIdsState.filter((id) => rowIdSet.has(id)), [selectedIdsState, rowIdSet]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allSelected = rowIds.length > 0 && rowIds.every((id) => selectedSet.has(id));
  const indeterminate = selectedIds.length > 0 && !allSelected;

  const toggleOne = useCallback((id) => {
    setSelectedIdsState((current) => (
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id]
    ));
  }, []);

  const toggleAll = useCallback(() => {
    setSelectedIdsState(() => (allSelected ? [] : rowIds.filter(Boolean)));
  }, [allSelected, rowIds]);

  const clearSelection = useCallback(() => setSelectedIdsState([]), []);

  return {
    selectedIds,
    selectedSet,
    allSelected,
    indeterminate,
    toggleOne,
    toggleAll,
    clearSelection,
  };
}

function BulkActionBar({ count, label, onClear, onDelete, deleting }) {
  return (
    <Collapse in={count > 0} mountOnEnter unmountOnExit>
      <Paper className="admin-bulk-bar" sx={{ px: 2, py: 1.5, mb: 2, borderRadius: 3 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Chip label={`${count} selected`} color="primary" size="small" />
            <Typography variant="body2" color="text.secondary">Bulk actions for {label}</Typography>
          </Stack>
          <Stack direction="row" spacing={1}>
            <Button variant="text" onClick={onClear}>Clear</Button>
            <Button variant="contained" color="error" onClick={onDelete} disabled={deleting}>
              {deleting ? 'Deleting...' : `Delete selected ${label}`}
            </Button>
          </Stack>
        </Stack>
      </Paper>
    </Collapse>
  );
}

function useNotifier() {
  const [toast, setToast] = useState({ open: false, message: '', severity: 'info' });

  const showToast = useCallback((message, severity = 'info') => {
    setToast({ open: true, message, severity });
  }, []);

  const toastNode = (
    <Snackbar
      open={toast.open}
      autoHideDuration={3500}
      onClose={() => setToast((prev) => ({ ...prev, open: false }))}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
    >
      <Alert
        onClose={() => setToast((prev) => ({ ...prev, open: false }))}
        severity={toast.severity}
        variant="filled"
      >
        {toast.message}
      </Alert>
    </Snackbar>
  );

  return { showToast, toastNode };
}

function PageHeader({ title, subtitle, actions }) {
  return (
    <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', md: 'center' }} spacing={2} sx={{ mb: 2.5 }}>
      <Box>
        <Typography variant="h5" fontWeight={700}>{title}</Typography>
        {subtitle ? <Typography color="text.secondary">{subtitle}</Typography> : null}
      </Box>
      <Stack direction="row" spacing={1}>{actions}</Stack>
    </Stack>
  );
}

function LoginPage({ onLoggedIn }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      await loginAdmin(email, password);
      const profileRes = await fetchProfile();
      if (!profileRes?.user?.isAdmin) {
        logoutAdmin();
        throw new Error('This account is not an admin account.');
      }
      onLoggedIn();
      navigate('/');
    } catch (err) {
      setError(safeError(err, 'Login failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container maxWidth="sm" sx={{ mt: 12 }}>
      <Card className="admin-panel">
        <CardContent>
          <Stack spacing={2} component="form" onSubmit={handleSubmit}>
            <Typography variant="h5" fontWeight={700}>HANDKRAFT Admin Login</Typography>
            <Typography color="text.secondary">
              Sign in with an admin account to manage users, products, orders, payouts, reviews, chat moderation, and platform operations.
            </Typography>
            {error ? <Alert severity="error">{error}</Alert> : null}
            <TextField
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              fullWidth
            />
            <TextField
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              fullWidth
            />
            <Button type="submit" variant="contained" size="large" disabled={loading}>
              {loading ? 'Signing In...' : 'Sign In'}
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </Container>
  );
}

function DashboardPage({ showToast }) {
  const [overview, setOverview] = useState(null);
  const [systemData, setSystemData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [overviewRes, systemRes] = await Promise.allSettled([
        fetchAdminOverview(),
        fetchSystemHealth(),
      ]);

      if (overviewRes.status === 'fulfilled') {
        setOverview(overviewRes.value);
      } else {
        throw overviewRes.reason;
      }

      if (systemRes.status === 'fulfilled') {
        setSystemData(systemRes.value);
      } else {
        setSystemData({
          health: { ok: false, message: systemRes.reason?.message || 'System health unavailable' },
          readiness: { ok: false, message: systemRes.reason?.message || 'Readiness check unavailable' },
        });
        showToast('System readiness check is currently unavailable', 'warning');
      }
    } catch (err) {
      const message = safeError(err, 'Failed to load dashboard');
      setError(message);
      showToast(message, 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const readiness = systemData?.readiness;
  const health = systemData?.health;

  return (
    <Box>
      <PageHeader
        title="Operations Dashboard"
        subtitle="Live control summary for your online HANDKRAFT platform"
        actions={[
          <Button key="refresh" startIcon={<RefreshIcon />} variant="outlined" onClick={load} disabled={loading}>Refresh</Button>,
        ]}
      />

      {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
      ) : null}

      {!loading && overview ? (
        <Stack spacing={2.5}>
          <Grid container spacing={2}>
            <Grid item xs={12} md={3}>
              <Card><CardContent><Typography color="text.secondary">Users</Typography><Typography variant="h4">{overview.users?.total || 0}</Typography><Typography variant="body2">Active: {overview.users?.active || 0} | Suspended: {overview.users?.suspended || 0}</Typography></CardContent></Card>
            </Grid>
            <Grid item xs={12} md={3}>
              <Card><CardContent><Typography color="text.secondary">Products</Typography><Typography variant="h4">{overview.products?.total || 0}</Typography><Typography variant="body2">Active: {overview.products?.active || 0} | Inactive: {overview.products?.inactive || 0}</Typography></CardContent></Card>
            </Grid>
            <Grid item xs={12} md={3}>
              <Card><CardContent><Typography color="text.secondary">Orders</Typography><Typography variant="h4">{overview.orders?.total || 0}</Typography><Typography variant="body2">Total order records in MongoDB</Typography></CardContent></Card>
            </Grid>
            <Grid item xs={12} md={3}>
              <Card><CardContent><Typography color="text.secondary">Conversations</Typography><Typography variant="h4">{overview.chats?.conversations || 0}</Typography><Typography variant="body2">Messages: {overview.chats?.messages || 0}</Typography></CardContent></Card>
            </Grid>
          </Grid>

          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 1.5 }}>Integration Readiness</Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Chip label={`Health: ${health?.ok ? 'OK' : 'Unknown'}`} color={health?.ok ? 'success' : 'default'} />
                <Chip label={`Razorpay: ${readiness?.readiness?.razorpay?.ready ? 'Ready' : 'Not Ready'}`} color={readiness?.readiness?.razorpay?.ready ? 'success' : 'warning'} />
                <Chip label={`NimbusPost: ${readiness?.readiness?.nimbuspost?.ready ? 'Ready' : 'Not Ready'}`} color={readiness?.readiness?.nimbuspost?.ready ? 'success' : 'warning'} />
                <Chip label={`Nimbus Mode: ${readiness?.readiness?.nimbuspost?.mode || '-'}`} variant="outlined" />
                <Chip label={`Mongo ReadyState: ${overview.system?.mongoReadyState ?? '-'}`} variant="outlined" />
                <Chip label={`Uptime: ${overview.system?.uptimeSeconds || 0}s`} variant="outlined" />
              </Stack>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 1.5 }}>Payout Status Snapshot</Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {Object.entries(overview.payouts || {}).length === 0 ? (
                  <Typography color="text.secondary">No payout records yet</Typography>
                ) : Object.entries(overview.payouts || {}).map(([status, count]) => (
                  <Chip key={status} label={`${status}: ${count}`} />
                ))}
              </Stack>
            </CardContent>
          </Card>
        </Stack>
      ) : null}
    </Box>
  );
}

function UsersPage({ showToast }) {
  const [filters, setFilters] = useState({ search: '', status: '', role: '', kycStatus: '', page: 1, limit: 20 });
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [editUser, setEditUser] = useState(null);
  const [form, setForm] = useState(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const { selectedIds, selectedSet, allSelected, indeterminate, toggleOne, toggleAll, clearSelection } = useBulkSelection(rows);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchUsers(filters);
      setRows(data.users || []);
      setPagination(data.pagination || { page: 1, limit: 20, total: 0, totalPages: 1 });
    } catch (err) {
      showToast(safeError(err, 'Failed to load users'), 'error');
    } finally {
      setLoading(false);
    }
  }, [filters, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const openEdit = (user) => {
    setEditUser(user);
    setForm({
      name: user.name || '',
      phoneNumber: user.phoneNumber || '',
      emailVerified: Boolean(user.emailVerified),
      isAdmin: Boolean(user.isAdmin),
      adminRole: user.adminRole || 'support',
      accountStatus: user.accountStatus || 'active',
      suspensionReason: user.suspensionReason || '',
      kycStatus: user?.sellerPayoutProfile?.kycStatus || 'pending',
      minimumPayoutAmount: Number(user?.sellerPayoutSettings?.minimumPayoutAmount || 0),
      reservePercent: Number(user?.sellerPayoutSettings?.reservePercent || 0),
      note: '',
    });
  };

  const handleSave = async () => {
    try {
      await updateUser(editUser._id, {
        name: form.name,
        phoneNumber: form.phoneNumber,
        emailVerified: form.emailVerified,
        isAdmin: form.isAdmin,
        adminRole: form.isAdmin ? form.adminRole : 'support',
        accountStatus: form.accountStatus,
        suspensionReason: form.suspensionReason,
        sellerPayoutProfile: { kycStatus: form.kycStatus },
        sellerPayoutSettings: {
          minimumPayoutAmount: Number(form.minimumPayoutAmount || 0),
          reservePercent: Number(form.reservePercent || 0),
        },
        note: form.note,
      });
      showToast('User updated', 'success');
      setEditUser(null);
      setForm(null);
      load();
    } catch (err) {
      showToast(safeError(err, 'Failed to update user'), 'error');
    }
  };

  const handleDelete = async (user) => {
    const payload = promptDeletePayload(`user ${user.email}`);
    if (!payload) return;
    try {
      const result = await deleteUser(user._id, payload);
      showToast(result?.mode === 'soft' ? 'User soft deleted' : 'User deleted', 'success');
      load();
    } catch (err) {
      showToast(safeError(err, 'Failed to delete user'), 'error');
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    const payload = promptDeletePayload(`${selectedIds.length} selected users`);
    if (!payload) return;
    setBulkDeleting(true);
    try {
      let successCount = 0;
      for (const id of selectedIds) {
        await deleteUser(id, payload);
        successCount += 1;
      }
      showToast(`Deleted ${successCount} users`, 'success');
      clearSelection();
      load();
    } catch (err) {
      showToast(safeError(err, 'Failed to bulk delete users'), 'error');
    } finally {
      setBulkDeleting(false);
    }
  };

  return (
    <Box>
      <PageHeader
        title="Users"
        subtitle="Manage account status, admin roles, and seller payout/KYC settings"
        actions={[
          <Button key="refresh" startIcon={<RefreshIcon />} onClick={load} variant="outlined" disabled={loading}>Refresh</Button>,
        ]}
      />

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
        <TextField label="Search name/email/phone" value={filters.search} onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value, page: 1 }))} fullWidth />
        <FormControl sx={{ minWidth: 140 }}>
          <InputLabel>Status</InputLabel>
          <Select label="Status" value={filters.status} onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value, page: 1 }))}>
            <MenuItem value="">All</MenuItem>
            <MenuItem value="active">Active</MenuItem>
            <MenuItem value="suspended">Suspended</MenuItem>
          </Select>
        </FormControl>
        <FormControl sx={{ minWidth: 140 }}>
          <InputLabel>Role</InputLabel>
          <Select label="Role" value={filters.role} onChange={(e) => setFilters((prev) => ({ ...prev, role: e.target.value, page: 1 }))}>
            <MenuItem value="">All</MenuItem>
            <MenuItem value="admin">Admin</MenuItem>
            <MenuItem value="user">User</MenuItem>
          </Select>
        </FormControl>
        <FormControl sx={{ minWidth: 140 }}>
          <InputLabel>KYC</InputLabel>
          <Select label="KYC" value={filters.kycStatus} onChange={(e) => setFilters((prev) => ({ ...prev, kycStatus: e.target.value, page: 1 }))}>
            <MenuItem value="">All</MenuItem>
            {KYC_STATUS_OPTIONS.map((status) => (<MenuItem key={status} value={status}>{status}</MenuItem>))}
          </Select>
        </FormControl>
      </Stack>

      <BulkActionBar count={selectedIds.length} label="users" onClear={clearSelection} onDelete={handleBulkDelete} deleting={bulkDeleting} />

      <TableContainer component={Paper} className="admin-table-wrap">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox">
                <Checkbox size="small" indeterminate={indeterminate} checked={allSelected} onChange={toggleAll} />
              </TableCell>
              <TableCell>Name</TableCell>
              <TableCell>Email</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Admin</TableCell>
              <TableCell>KYC</TableCell>
              <TableCell>Created</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={8} align="center"><CircularProgress size={26} /></TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={8} align="center">No users found</TableCell></TableRow>
            ) : rows.map((user) => (
              <TableRow key={user._id} hover selected={selectedSet.has(user._id)}>
                <TableCell padding="checkbox">
                  <Checkbox size="small" checked={selectedSet.has(user._id)} onChange={() => toggleOne(user._id)} />
                </TableCell>
                <TableCell>{user.name || '-'}</TableCell>
                <TableCell>{user.email}</TableCell>
                <TableCell>
                  <Chip label={user.accountStatus || 'active'} color={(user.accountStatus || 'active') === 'suspended' ? 'warning' : 'success'} size="small" />
                </TableCell>
                <TableCell>{user.isAdmin ? 'Yes' : 'No'}</TableCell>
                <TableCell>{user?.sellerPayoutProfile?.kycStatus || '-'}</TableCell>
                <TableCell>{formatDate(user.createdAt)}</TableCell>
                <TableCell align="right">
                  <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                    <IconButton size="small" onClick={() => openEdit(user)}><EditIcon fontSize="small" /></IconButton>
                    <IconButton size="small" color="error" onClick={() => handleDelete(user)}><DeleteIcon fontSize="small" /></IconButton>
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 1.5 }}>
        <Typography variant="body2" color="text.secondary">Total: {pagination.total || 0}</Typography>
        <Pagination
          page={pagination.page || 1}
          count={pagination.totalPages || 1}
          onChange={(_, page) => setFilters((prev) => ({ ...prev, page }))}
          color="primary"
        />
      </Stack>

      <Dialog open={Boolean(editUser)} onClose={() => setEditUser(null)} fullWidth maxWidth="sm">
        <DialogTitle>Edit User</DialogTitle>
        <DialogContent dividers>
          {form ? (
            <Stack spacing={1.5} sx={{ pt: 1 }}>
              <TextField label="Name" value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} fullWidth />
              <TextField label="Phone" value={form.phoneNumber} onChange={(e) => setForm((prev) => ({ ...prev, phoneNumber: e.target.value }))} fullWidth />
              <FormControl fullWidth>
                <InputLabel>Account Status</InputLabel>
                <Select label="Account Status" value={form.accountStatus} onChange={(e) => setForm((prev) => ({ ...prev, accountStatus: e.target.value }))}>
                  <MenuItem value="active">active</MenuItem>
                  <MenuItem value="suspended">suspended</MenuItem>
                </Select>
              </FormControl>
              {form.accountStatus === 'suspended' ? (
                <TextField label="Suspension Reason" value={form.suspensionReason} onChange={(e) => setForm((prev) => ({ ...prev, suspensionReason: e.target.value }))} fullWidth multiline minRows={2} />
              ) : null}
              <FormControl fullWidth>
                <InputLabel>KYC Status</InputLabel>
                <Select label="KYC Status" value={form.kycStatus} onChange={(e) => setForm((prev) => ({ ...prev, kycStatus: e.target.value }))}>
                  {KYC_STATUS_OPTIONS.map((status) => (<MenuItem key={status} value={status}>{status}</MenuItem>))}
                </Select>
              </FormControl>
              <TextField label="Minimum Payout Amount" type="number" value={form.minimumPayoutAmount} onChange={(e) => setForm((prev) => ({ ...prev, minimumPayoutAmount: e.target.value }))} fullWidth />
              <TextField label="Reserve Percent" type="number" value={form.reservePercent} onChange={(e) => setForm((prev) => ({ ...prev, reservePercent: e.target.value }))} fullWidth />
              <Stack direction="row" spacing={1.5}>
                <FormControl fullWidth>
                  <InputLabel>Email Verified</InputLabel>
                  <Select label="Email Verified" value={form.emailVerified ? 'yes' : 'no'} onChange={(e) => setForm((prev) => ({ ...prev, emailVerified: e.target.value === 'yes' }))}>
                    <MenuItem value="yes">Yes</MenuItem>
                    <MenuItem value="no">No</MenuItem>
                  </Select>
                </FormControl>
                <FormControl fullWidth>
                  <InputLabel>Admin Access</InputLabel>
                  <Select label="Admin Access" value={form.isAdmin ? 'yes' : 'no'} onChange={(e) => setForm((prev) => ({ ...prev, isAdmin: e.target.value === 'yes' }))}>
                    <MenuItem value="yes">Yes</MenuItem>
                    <MenuItem value="no">No</MenuItem>
                  </Select>
                </FormControl>
              </Stack>
              {form.isAdmin ? (
                <FormControl fullWidth>
                  <InputLabel>Admin Role</InputLabel>
                  <Select label="Admin Role" value={form.adminRole} onChange={(e) => setForm((prev) => ({ ...prev, adminRole: e.target.value }))}>
                    {ADMIN_ROLE_OPTIONS.map((role) => (<MenuItem key={role} value={role}>{role}</MenuItem>))}
                  </Select>
                </FormControl>
              ) : null}
              <TextField label="Audit Note" value={form.note} onChange={(e) => setForm((prev) => ({ ...prev, note: e.target.value }))} fullWidth />
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditUser(null)}>Cancel</Button>
          <Button onClick={handleSave} variant="contained">Save</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function ProductsPage({ showToast }) {
  const [filters, setFilters] = useState({ search: '', status: '', page: 1, limit: 20 });
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [editProduct, setEditProduct] = useState(null);
  const [form, setForm] = useState(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const { selectedIds, selectedSet, allSelected, indeterminate, toggleOne, toggleAll, clearSelection } = useBulkSelection(rows);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchProducts(filters);
      setRows(data.products || []);
      setPagination(data.pagination || { page: 1, limit: 20, total: 0, totalPages: 1 });
    } catch (err) {
      showToast(safeError(err, 'Failed to load products'), 'error');
    } finally {
      setLoading(false);
    }
  }, [filters, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const openEdit = (product) => {
    setEditProduct(product);
    setForm({
      title: product.title || '',
      category: product.category || '',
      price: Number(product.price || 0),
      stock: Number(product.stock || 0),
      isActive: Boolean(product.isActive),
      note: '',
    });
  };

  const handleSave = async () => {
    try {
      await updateProduct(editProduct._id, {
        title: form.title,
        category: form.category,
        price: Number(form.price || 0),
        stock: Number(form.stock || 0),
        isActive: form.isActive,
        note: form.note,
      });
      showToast('Product updated', 'success');
      setEditProduct(null);
      setForm(null);
      load();
    } catch (err) {
      showToast(safeError(err, 'Failed to update product'), 'error');
    }
  };

  const handleDelete = async (product) => {
    const payload = promptDeletePayload(`product ${product.title || product._id}`);
    if (!payload) return;
    try {
      const result = await deleteProduct(product._id, payload);
      showToast(result?.mode === 'soft' ? 'Product soft deleted' : 'Product deleted', 'success');
      load();
    } catch (err) {
      showToast(safeError(err, 'Failed to delete product'), 'error');
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    const payload = promptDeletePayload(`${selectedIds.length} selected products`);
    if (!payload) return;
    setBulkDeleting(true);
    try {
      let successCount = 0;
      for (const id of selectedIds) {
        await deleteProduct(id, payload);
        successCount += 1;
      }
      showToast(`Deleted ${successCount} products`, 'success');
      clearSelection();
      load();
    } catch (err) {
      showToast(safeError(err, 'Failed to bulk delete products'), 'error');
    } finally {
      setBulkDeleting(false);
    }
  };

  return (
    <Box>
      <PageHeader
        title="Products"
        subtitle="Moderate listings, stock, pricing, and active state"
        actions={[
          <Button key="refresh" startIcon={<RefreshIcon />} onClick={load} variant="outlined" disabled={loading}>Refresh</Button>,
        ]}
      />

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
        <TextField label="Search title/description/seller" value={filters.search} onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value, page: 1 }))} fullWidth />
        <FormControl sx={{ minWidth: 160 }}>
          <InputLabel>Status</InputLabel>
          <Select label="Status" value={filters.status} onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value, page: 1 }))}>
            <MenuItem value="">All</MenuItem>
            <MenuItem value="active">Active</MenuItem>
            <MenuItem value="inactive">Inactive</MenuItem>
          </Select>
        </FormControl>
      </Stack>

      <BulkActionBar count={selectedIds.length} label="products" onClear={clearSelection} onDelete={handleBulkDelete} deleting={bulkDeleting} />

      <TableContainer component={Paper} className="admin-table-wrap">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox">
                <Checkbox size="small" indeterminate={indeterminate} checked={allSelected} onChange={toggleAll} />
              </TableCell>
              <TableCell>Title</TableCell>
              <TableCell>Seller</TableCell>
              <TableCell>Price</TableCell>
              <TableCell>Stock</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Created</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={8} align="center"><CircularProgress size={26} /></TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={8} align="center">No products found</TableCell></TableRow>
            ) : rows.map((product) => (
              <TableRow key={product._id} hover selected={selectedSet.has(product._id)}>
                <TableCell padding="checkbox">
                  <Checkbox size="small" checked={selectedSet.has(product._id)} onChange={() => toggleOne(product._id)} />
                </TableCell>
                <TableCell>{product.title}</TableCell>
                <TableCell>{product?.seller?.name || product.sellerName || '-'}</TableCell>
                <TableCell>{Number(product.price || 0).toFixed(2)}</TableCell>
                <TableCell>{product.stock ?? 0}</TableCell>
                <TableCell><Chip label={product.isActive ? 'active' : 'inactive'} size="small" color={product.isActive ? 'success' : 'default'} /></TableCell>
                <TableCell>{formatDate(product.createdAt)}</TableCell>
                <TableCell align="right">
                  <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                    <IconButton size="small" onClick={() => openEdit(product)}><EditIcon fontSize="small" /></IconButton>
                    <IconButton size="small" color="error" onClick={() => handleDelete(product)}><DeleteIcon fontSize="small" /></IconButton>
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 1.5 }}>
        <Typography variant="body2" color="text.secondary">Total: {pagination.total || 0}</Typography>
        <Pagination page={pagination.page || 1} count={pagination.totalPages || 1} onChange={(_, page) => setFilters((prev) => ({ ...prev, page }))} color="primary" />
      </Stack>

      <Dialog open={Boolean(editProduct)} onClose={() => setEditProduct(null)} fullWidth maxWidth="sm">
        <DialogTitle>Edit Product</DialogTitle>
        <DialogContent dividers>
          {form ? (
            <Stack spacing={1.5} sx={{ pt: 1 }}>
              <TextField label="Title" value={form.title} onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))} fullWidth />
              <TextField label="Category" value={form.category} onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))} fullWidth />
              <Stack direction="row" spacing={1.5}>
                <TextField label="Price" type="number" value={form.price} onChange={(e) => setForm((prev) => ({ ...prev, price: e.target.value }))} fullWidth />
                <TextField label="Stock" type="number" value={form.stock} onChange={(e) => setForm((prev) => ({ ...prev, stock: e.target.value }))} fullWidth />
              </Stack>
              <FormControl fullWidth>
                <InputLabel>Status</InputLabel>
                <Select label="Status" value={form.isActive ? 'active' : 'inactive'} onChange={(e) => setForm((prev) => ({ ...prev, isActive: e.target.value === 'active' }))}>
                  <MenuItem value="active">active</MenuItem>
                  <MenuItem value="inactive">inactive</MenuItem>
                </Select>
              </FormControl>
              <TextField label="Audit Note" value={form.note} onChange={(e) => setForm((prev) => ({ ...prev, note: e.target.value }))} fullWidth />
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditProduct(null)}>Cancel</Button>
          <Button onClick={handleSave} variant="contained">Save</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function OrdersPage({ showToast }) {
  const [filters, setFilters] = useState({ search: '', status: '', paymentStatus: '', page: 1, limit: 20 });
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [selectedOrderForm, setSelectedOrderForm] = useState(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const { selectedIds, selectedSet, allSelected, indeterminate, toggleOne, toggleAll, clearSelection } = useBulkSelection(rows);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchOrders(filters);
      setRows(data.orders || []);
      setPagination(data.pagination || { page: 1, limit: 20, total: 0, totalPages: 1 });
    } catch (err) {
      showToast(safeError(err, 'Failed to load orders'), 'error');
    } finally {
      setLoading(false);
    }
  }, [filters, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const openOrder = async (row) => {
    try {
      const data = await fetchOrderDetail(row._id);
      const order = data.order;
      setSelectedOrder(order);
      setSelectedOrderForm({
        status: order.status,
        paymentStatus: order.paymentStatus,
        notes: order.notes || '',
      });
    } catch (err) {
      showToast(safeError(err, 'Failed to fetch order details'), 'error');
    }
  };

  const saveOrder = async () => {
    try {
      await updateOrder(selectedOrder._id, {
        status: selectedOrderForm.status,
        paymentStatus: selectedOrderForm.paymentStatus,
        notes: selectedOrderForm.notes,
        note: 'Admin updated order from control panel',
      });
      showToast('Order updated', 'success');
      openOrder({ _id: selectedOrder._id });
      load();
    } catch (err) {
      showToast(safeError(err, 'Failed to update order'), 'error');
    }
  };

  const updateItemStatus = async (itemIndex, status) => {
    try {
      await updateOrderItem(selectedOrder._id, itemIndex, {
        fulfillmentStatus: status,
        note: 'Admin item status override',
      });
      showToast('Order item status updated', 'success');
      openOrder({ _id: selectedOrder._id });
      load();
    } catch (err) {
      showToast(safeError(err, 'Failed to update item status'), 'error');
    }
  };

  const handleDelete = async (order) => {
    const payload = promptDeletePayload(`order ${order._id}`);
    if (!payload) return;
    try {
      const result = await deleteOrder(order._id, payload);
      showToast(result?.mode === 'soft' ? 'Order soft deleted' : 'Order deleted', 'success');
      if (selectedOrder && selectedOrder._id === order._id) {
        setSelectedOrder(null);
      }
      load();
    } catch (err) {
      showToast(safeError(err, 'Failed to delete order'), 'error');
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    const payload = promptDeletePayload(`${selectedIds.length} selected orders`);
    if (!payload) return;
    setBulkDeleting(true);
    try {
      let successCount = 0;
      for (const id of selectedIds) {
        await deleteOrder(id, payload);
        successCount += 1;
      }
      showToast(`Deleted ${successCount} orders`, 'success');
      clearSelection();
      if (selectedOrder && selectedIds.includes(selectedOrder._id)) {
        setSelectedOrder(null);
      }
      load();
    } catch (err) {
      showToast(safeError(err, 'Failed to bulk delete orders'), 'error');
    } finally {
      setBulkDeleting(false);
    }
  };

  return (
    <Box>
      <PageHeader
        title="Orders"
        subtitle="Control order, payment, and per-item fulfillment state"
        actions={[
          <Button key="refresh" startIcon={<RefreshIcon />} onClick={load} variant="outlined" disabled={loading}>Refresh</Button>,
        ]}
      />

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
        <TextField label="Search order ID / buyer" value={filters.search} onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value, page: 1 }))} fullWidth />
        <FormControl sx={{ minWidth: 160 }}>
          <InputLabel>Order Status</InputLabel>
          <Select label="Order Status" value={filters.status} onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value, page: 1 }))}>
            <MenuItem value="">All</MenuItem>
            {ORDER_STATUS_OPTIONS.map((status) => (<MenuItem key={status} value={status}>{status}</MenuItem>))}
          </Select>
        </FormControl>
        <FormControl sx={{ minWidth: 160 }}>
          <InputLabel>Payment Status</InputLabel>
          <Select label="Payment Status" value={filters.paymentStatus} onChange={(e) => setFilters((prev) => ({ ...prev, paymentStatus: e.target.value, page: 1 }))}>
            <MenuItem value="">All</MenuItem>
            {PAYMENT_STATUS_OPTIONS.map((status) => (<MenuItem key={status} value={status}>{status}</MenuItem>))}
          </Select>
        </FormControl>
      </Stack>

      <BulkActionBar count={selectedIds.length} label="orders" onClear={clearSelection} onDelete={handleBulkDelete} deleting={bulkDeleting} />

      <TableContainer component={Paper} className="admin-table-wrap">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox">
                <Checkbox size="small" indeterminate={indeterminate} checked={allSelected} onChange={toggleAll} />
              </TableCell>
              <TableCell>Order ID</TableCell>
              <TableCell>Buyer</TableCell>
              <TableCell>Total</TableCell>
              <TableCell>Order Status</TableCell>
              <TableCell>Payment</TableCell>
              <TableCell>Items</TableCell>
              <TableCell>Created</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={9} align="center"><CircularProgress size={26} /></TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={9} align="center">No orders found</TableCell></TableRow>
            ) : rows.map((order) => (
              <TableRow key={order._id} hover selected={selectedSet.has(order._id)}>
                <TableCell padding="checkbox">
                  <Checkbox size="small" checked={selectedSet.has(order._id)} onChange={() => toggleOne(order._id)} />
                </TableCell>
                <TableCell>{order._id}</TableCell>
                <TableCell>{order?.user?.name || order?.user?.email || '-'}</TableCell>
                <TableCell>{Number(order.totalAmount || 0).toFixed(2)}</TableCell>
                <TableCell><Chip label={order.status} size="small" /></TableCell>
                <TableCell><Chip label={order.paymentStatus} size="small" color={order.paymentStatus === 'completed' ? 'success' : 'default'} /></TableCell>
                <TableCell>{Array.isArray(order.items) ? order.items.length : 0}</TableCell>
                <TableCell>{formatDate(order.createdAt)}</TableCell>
                <TableCell align="right">
                  <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                    <IconButton size="small" onClick={() => openOrder(order)}><VisibilityIcon fontSize="small" /></IconButton>
                    <IconButton size="small" color="error" onClick={() => handleDelete(order)}><DeleteIcon fontSize="small" /></IconButton>
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 1.5 }}>
        <Typography variant="body2" color="text.secondary">Total: {pagination.total || 0}</Typography>
        <Pagination page={pagination.page || 1} count={pagination.totalPages || 1} onChange={(_, page) => setFilters((prev) => ({ ...prev, page }))} color="primary" />
      </Stack>

      <Dialog open={Boolean(selectedOrder)} onClose={() => setSelectedOrder(null)} fullWidth maxWidth="lg">
        <DialogTitle>Order Detail</DialogTitle>
        <DialogContent dividers>
          {selectedOrder && selectedOrderForm ? (
            <Stack spacing={2}>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
                <FormControl fullWidth>
                  <InputLabel>Order Status</InputLabel>
                  <Select label="Order Status" value={selectedOrderForm.status} onChange={(e) => setSelectedOrderForm((prev) => ({ ...prev, status: e.target.value }))}>
                    {ORDER_STATUS_OPTIONS.map((status) => (<MenuItem key={status} value={status}>{status}</MenuItem>))}
                  </Select>
                </FormControl>
                <FormControl fullWidth>
                  <InputLabel>Payment Status</InputLabel>
                  <Select label="Payment Status" value={selectedOrderForm.paymentStatus} onChange={(e) => setSelectedOrderForm((prev) => ({ ...prev, paymentStatus: e.target.value }))}>
                    {PAYMENT_STATUS_OPTIONS.map((status) => (<MenuItem key={status} value={status}>{status}</MenuItem>))}
                  </Select>
                </FormControl>
              </Stack>
              <TextField label="Notes" value={selectedOrderForm.notes} onChange={(e) => setSelectedOrderForm((prev) => ({ ...prev, notes: e.target.value }))} fullWidth multiline minRows={2} />

              <Divider />
              <Typography variant="h6">Items Fulfillment</Typography>
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Item</TableCell>
                      <TableCell>Qty</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell align="right">Action</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(selectedOrder.items || []).map((item, index) => (
                      <TableRow key={`${selectedOrder._id}-${index}`}>
                        <TableCell>{item?.product?.title || item?.title || '-'}</TableCell>
                        <TableCell>{item.quantity || 0}</TableCell>
                        <TableCell>{item.fulfillmentStatus}</TableCell>
                        <TableCell align="right">
                          <FormControl size="small" sx={{ minWidth: 180 }}>
                            <InputLabel>Status</InputLabel>
                            <Select
                              label="Status"
                              value={item.fulfillmentStatus || 'new'}
                              onChange={(e) => updateItemStatus(index, e.target.value)}
                            >
                              {ITEM_STATUS_OPTIONS.map((status) => (<MenuItem key={status} value={status}>{status}</MenuItem>))}
                            </Select>
                          </FormControl>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSelectedOrder(null)}>Close</Button>
          <Button onClick={saveOrder} variant="contained">Save Order</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function PayoutsPage({ showToast }) {
  const [filters, setFilters] = useState({ status: '', page: 1, limit: 20 });
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [editPayout, setEditPayout] = useState(null);
  const [form, setForm] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchPayouts(filters);
      setRows(data.payouts || []);
      setPagination(data.pagination || { page: 1, limit: 20, total: 0, totalPages: 1 });
    } catch (err) {
      showToast(safeError(err, 'Failed to load payouts'), 'error');
    } finally {
      setLoading(false);
    }
  }, [filters, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const openEdit = (payout) => {
    setEditPayout(payout);
    setForm({
      status: payout.status,
      holdUntil: payout.holdUntil ? new Date(payout.holdUntil).toISOString().slice(0, 16) : '',
      failureReason: payout?.payout?.failureReason || '',
      note: '',
    });
  };

  const savePayout = async () => {
    try {
      await updatePayout(editPayout.id, {
        status: form.status,
        holdUntil: form.holdUntil || undefined,
        failureReason: form.failureReason,
        note: form.note,
      });
      showToast('Payout updated', 'success');
      setEditPayout(null);
      load();
    } catch (err) {
      showToast(safeError(err, 'Failed to update payout'), 'error');
    }
  };

  const handleProcessDue = async () => {
    try {
      const result = await processDuePayouts({ limit: 150 });
      showToast(`Processed due payouts: ${result?.result?.releasedCount || 0} released`, 'success');
      load();
    } catch (err) {
      showToast(safeError(err, 'Failed to process due payouts'), 'error');
    }
  };

  const handleClaimReady = async () => {
    try {
      const result = await claimPayouts({ claimAll: true, limit: 200 });
      showToast(`Claimed payouts: ${result?.claimResult?.claimedCount || 0}`, 'success');
      load();
    } catch (err) {
      showToast(safeError(err, 'Failed to claim payouts'), 'error');
    }
  };

  return (
    <Box>
      <PageHeader
        title="Payouts"
        subtitle="Run hold-release cycles, claim ready payouts, and override payout states"
        actions={[
          <Button key="process" variant="contained" onClick={handleProcessDue}>Process Due</Button>,
          <Button key="claim" variant="contained" color="secondary" onClick={handleClaimReady}>Claim Ready</Button>,
          <Button key="refresh" startIcon={<RefreshIcon />} onClick={load} variant="outlined" disabled={loading}>Refresh</Button>,
        ]}
      />

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
        <FormControl sx={{ minWidth: 220 }}>
          <InputLabel>Status</InputLabel>
          <Select label="Status" value={filters.status} onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value, page: 1 }))}>
            <MenuItem value="">All</MenuItem>
            {PAYOUT_STATUS_OPTIONS.map((status) => (<MenuItem key={status} value={status}>{status}</MenuItem>))}
          </Select>
        </FormControl>
      </Stack>

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Payout ID</TableCell>
              <TableCell>Seller</TableCell>
              <TableCell>Order</TableCell>
              <TableCell>Net Amount</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Hold Until</TableCell>
              <TableCell>Updated</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={8} align="center"><CircularProgress size={26} /></TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={8} align="center">No payouts found</TableCell></TableRow>
            ) : rows.map((payout) => (
              <TableRow key={payout.id} hover>
                <TableCell>{payout.id}</TableCell>
                <TableCell>{payout?.seller?.name || '-'}</TableCell>
                <TableCell>{payout?.order?.id || '-'}</TableCell>
                <TableCell>{Number(payout?.split?.netPayoutAmount || 0).toFixed(2)}</TableCell>
                <TableCell><Chip label={payout.status} size="small" /></TableCell>
                <TableCell>{formatDate(payout.holdUntil)}</TableCell>
                <TableCell>{formatDate(payout.updatedAt)}</TableCell>
                <TableCell align="right">
                  <IconButton size="small" onClick={() => openEdit(payout)}><EditIcon fontSize="small" /></IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 1.5 }}>
        <Typography variant="body2" color="text.secondary">Total: {pagination.total || 0}</Typography>
        <Pagination page={pagination.page || 1} count={pagination.totalPages || 1} onChange={(_, page) => setFilters((prev) => ({ ...prev, page }))} color="primary" />
      </Stack>

      <Dialog open={Boolean(editPayout)} onClose={() => setEditPayout(null)} fullWidth maxWidth="sm">
        <DialogTitle>Edit Payout</DialogTitle>
        <DialogContent dividers>
          {form ? (
            <Stack spacing={1.5} sx={{ pt: 1 }}>
              <FormControl fullWidth>
                <InputLabel>Status</InputLabel>
                <Select label="Status" value={form.status} onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))}>
                  {PAYOUT_STATUS_OPTIONS.map((status) => (<MenuItem key={status} value={status}>{status}</MenuItem>))}
                </Select>
              </FormControl>
              <TextField
                label="Hold Until"
                type="datetime-local"
                value={form.holdUntil}
                onChange={(e) => setForm((prev) => ({ ...prev, holdUntil: e.target.value }))}
                fullWidth
                InputLabelProps={{ shrink: true }}
              />
              <TextField
                label="Failure Reason"
                value={form.failureReason}
                onChange={(e) => setForm((prev) => ({ ...prev, failureReason: e.target.value }))}
                fullWidth
                multiline
                minRows={2}
              />
              <TextField label="Audit Note" value={form.note} onChange={(e) => setForm((prev) => ({ ...prev, note: e.target.value }))} fullWidth />
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditPayout(null)}>Cancel</Button>
          <Button onClick={savePayout} variant="contained">Save</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function ReviewsPage({ showToast }) {
  const [filters, setFilters] = useState({ search: '', isActive: '', page: 1, limit: 20 });
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const { selectedIds, selectedSet, allSelected, indeterminate, toggleOne, toggleAll, clearSelection } = useBulkSelection(rows);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchReviews(filters);
      setRows(data.reviews || []);
      setPagination(data.pagination || { page: 1, limit: 20, total: 0, totalPages: 1 });
    } catch (err) {
      showToast(safeError(err, 'Failed to load reviews'), 'error');
    } finally {
      setLoading(false);
    }
  }, [filters, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleReview = async (review) => {
    try {
      await updateReview(review._id, { isActive: !review.isActive, note: 'Admin moderation update' });
      showToast('Review visibility updated', 'success');
      load();
    } catch (err) {
      showToast(safeError(err, 'Failed to update review'), 'error');
    }
  };

  const removeReview = async (review) => {
    const payload = promptDeletePayload(`review ${review._id}`);
    if (!payload) return;
    try {
      const result = await deleteReview(review._id, payload);
      showToast(result?.mode === 'soft' ? 'Review soft deleted' : 'Review deleted', 'success');
      load();
    } catch (err) {
      showToast(safeError(err, 'Failed to delete review'), 'error');
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    const payload = promptDeletePayload(`${selectedIds.length} selected reviews`);
    if (!payload) return;
    setBulkDeleting(true);
    try {
      let successCount = 0;
      for (const id of selectedIds) {
        await deleteReview(id, payload);
        successCount += 1;
      }
      showToast(`Deleted ${successCount} reviews`, 'success');
      clearSelection();
      load();
    } catch (err) {
      showToast(safeError(err, 'Failed to bulk delete reviews'), 'error');
    } finally {
      setBulkDeleting(false);
    }
  };

  return (
    <Box>
      <PageHeader
        title="Reviews"
        subtitle="Moderate customer reviews and remove abusive content"
        actions={[
          <Button key="refresh" startIcon={<RefreshIcon />} onClick={load} variant="outlined" disabled={loading}>Refresh</Button>,
        ]}
      />

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
        <TextField label="Search title/comment" value={filters.search} onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value, page: 1 }))} fullWidth />
        <FormControl sx={{ minWidth: 160 }}>
          <InputLabel>Visibility</InputLabel>
          <Select label="Visibility" value={filters.isActive} onChange={(e) => setFilters((prev) => ({ ...prev, isActive: e.target.value, page: 1 }))}>
            <MenuItem value="">All</MenuItem>
            <MenuItem value="true">Visible</MenuItem>
            <MenuItem value="false">Hidden</MenuItem>
          </Select>
        </FormControl>
      </Stack>

      <BulkActionBar count={selectedIds.length} label="reviews" onClear={clearSelection} onDelete={handleBulkDelete} deleting={bulkDeleting} />

      <TableContainer component={Paper} className="admin-table-wrap">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox">
                <Checkbox size="small" indeterminate={indeterminate} checked={allSelected} onChange={toggleAll} />
              </TableCell>
              <TableCell>Product</TableCell>
              <TableCell>User</TableCell>
              <TableCell>Rating</TableCell>
              <TableCell>Comment</TableCell>
              <TableCell>Visible</TableCell>
              <TableCell>Created</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={8} align="center"><CircularProgress size={26} /></TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={8} align="center">No reviews found</TableCell></TableRow>
            ) : rows.map((review) => (
              <TableRow key={review._id} hover selected={selectedSet.has(review._id)}>
                <TableCell padding="checkbox">
                  <Checkbox size="small" checked={selectedSet.has(review._id)} onChange={() => toggleOne(review._id)} />
                </TableCell>
                <TableCell>{review?.product?.title || '-'}</TableCell>
                <TableCell>{review?.user?.name || '-'}</TableCell>
                <TableCell>{review.rating}</TableCell>
                <TableCell sx={{ maxWidth: 340 }}><span className="truncate-inline">{review.comment || '-'}</span></TableCell>
                <TableCell><Switch checked={Boolean(review.isActive)} onChange={() => toggleReview(review)} /></TableCell>
                <TableCell>{formatDate(review.createdAt)}</TableCell>
                <TableCell align="right">
                  <IconButton size="small" color="error" onClick={() => removeReview(review)}><DeleteIcon fontSize="small" /></IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 1.5 }}>
        <Typography variant="body2" color="text.secondary">Total: {pagination.total || 0}</Typography>
        <Pagination page={pagination.page || 1} count={pagination.totalPages || 1} onChange={(_, page) => setFilters((prev) => ({ ...prev, page }))} color="primary" />
      </Stack>
    </Box>
  );
}

function ChatsPage({ showToast }) {
  const [filters, setFilters] = useState({ search: '', page: 1, limit: 20 });
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [conversationView, setConversationView] = useState(null);
  const [conversationMessages, setConversationMessages] = useState([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const { selectedIds, selectedSet, allSelected, indeterminate, toggleOne, toggleAll, clearSelection } = useBulkSelection(rows, (conversation) => conversation?.id);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchConversations(filters);
      setRows(data.conversations || []);
      setPagination(data.pagination || { page: 1, limit: 20, total: 0, totalPages: 1 });
    } catch (err) {
      showToast(safeError(err, 'Failed to load conversations'), 'error');
    } finally {
      setLoading(false);
    }
  }, [filters, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const openConversation = async (conversation) => {
    try {
      const data = await fetchConversationMessages(conversation.id);
      setConversationView(data.conversation);
      setConversationMessages(data.messages || []);
    } catch (err) {
      showToast(safeError(err, 'Failed to fetch conversation messages'), 'error');
    }
  };

  const removeMessage = async (messageId) => {
    if (!conversationView) return;
    const payload = promptDeletePayload(`message ${messageId}`);
    if (!payload) return;
    try {
      const result = await deleteMessage(messageId, payload);
      showToast(result?.mode === 'soft' ? 'Message soft deleted' : 'Message deleted', 'success');
      const data = await fetchConversationMessages(conversationView.id);
      setConversationMessages(data.messages || []);
      load();
    } catch (err) {
      showToast(safeError(err, 'Failed to delete message'), 'error');
    }
  };

  const removeConversation = async (conversation) => {
    const payload = promptDeletePayload(`conversation ${conversation.id}`);
    if (!payload) return;
    try {
      const result = await deleteConversation(conversation.id, payload);
      showToast(result?.mode === 'soft' ? 'Conversation soft deleted' : 'Conversation deleted', 'success');
      if (conversationView?.id === conversation.id) {
        setConversationView(null);
        setConversationMessages([]);
      }
      load();
    } catch (err) {
      showToast(safeError(err, 'Failed to delete conversation'), 'error');
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    const payload = promptDeletePayload(`${selectedIds.length} selected conversations`);
    if (!payload) return;
    setBulkDeleting(true);
    try {
      let successCount = 0;
      for (const id of selectedIds) {
        await deleteConversation(id, payload);
        successCount += 1;
      }
      showToast(`Deleted ${successCount} conversations`, 'success');
      clearSelection();
      if (conversationView && selectedIds.includes(conversationView.id)) {
        setConversationView(null);
        setConversationMessages([]);
      }
      load();
    } catch (err) {
      showToast(safeError(err, 'Failed to bulk delete conversations'), 'error');
    } finally {
      setBulkDeleting(false);
    }
  };

  return (
    <Box>
      <PageHeader
        title="Chats"
        subtitle="Monitor conversations and remove policy-violating messages"
        actions={[
          <Button key="refresh" startIcon={<RefreshIcon />} onClick={load} variant="outlined" disabled={loading}>Refresh</Button>,
        ]}
      />

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
        <TextField label="Search messages, product title, participants" value={filters.search} onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value, page: 1 }))} fullWidth />
      </Stack>

      <BulkActionBar count={selectedIds.length} label="conversations" onClear={clearSelection} onDelete={handleBulkDelete} deleting={bulkDeleting} />

      <TableContainer component={Paper} className="admin-table-wrap">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox">
                <Checkbox size="small" indeterminate={indeterminate} checked={allSelected} onChange={toggleAll} />
              </TableCell>
              <TableCell>Participants</TableCell>
              <TableCell>Product</TableCell>
              <TableCell>Last Message</TableCell>
              <TableCell>Unread Total</TableCell>
              <TableCell>Updated</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={7} align="center"><CircularProgress size={26} /></TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={7} align="center">No conversations found</TableCell></TableRow>
            ) : rows.map((conversation) => (
              <TableRow key={conversation.id} hover selected={selectedSet.has(conversation.id)}>
                <TableCell padding="checkbox">
                  <Checkbox size="small" checked={selectedSet.has(conversation.id)} onChange={() => toggleOne(conversation.id)} />
                </TableCell>
                <TableCell>{(conversation.participants || []).map((p) => p.name || p.email).join(' | ') || '-'}</TableCell>
                <TableCell>{conversation?.product?.title || '-'}</TableCell>
                <TableCell sx={{ maxWidth: 360 }}><span className="truncate-inline">{conversation.lastMessage || '-'}</span></TableCell>
                <TableCell>{conversation.unreadTotal || 0}</TableCell>
                <TableCell>{formatDate(conversation.updatedAt)}</TableCell>
                <TableCell align="right">
                  <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                    <IconButton size="small" onClick={() => openConversation(conversation)}><VisibilityIcon fontSize="small" /></IconButton>
                    <IconButton size="small" color="error" onClick={() => removeConversation(conversation)}><DeleteIcon fontSize="small" /></IconButton>
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 1.5 }}>
        <Typography variant="body2" color="text.secondary">Total: {pagination.total || 0}</Typography>
        <Pagination page={pagination.page || 1} count={pagination.totalPages || 1} onChange={(_, page) => setFilters((prev) => ({ ...prev, page }))} color="primary" />
      </Stack>

      <Dialog open={Boolean(conversationView)} onClose={() => setConversationView(null)} fullWidth maxWidth="md">
        <DialogTitle>Conversation Messages</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.5}>
            {(conversationMessages || []).map((message) => (
              <Paper key={message.id} variant="outlined" sx={{ p: 1.5 }}>
                <Stack direction="row" justifyContent="space-between" spacing={1}>
                  <Box>
                    <Typography variant="body2" fontWeight={600}>{message?.sender?.name || message?.sender?.email || 'Unknown sender'}</Typography>
                    <Typography variant="caption" color="text.secondary">{formatDate(message.createdAt)}</Typography>
                    <Typography sx={{ mt: 0.75, whiteSpace: 'pre-wrap' }}>{message.text}</Typography>
                  </Box>
                  <IconButton size="small" color="error" onClick={() => removeMessage(message.id)}><DeleteIcon fontSize="small" /></IconButton>
                </Stack>
              </Paper>
            ))}
            {conversationMessages.length === 0 ? <Typography color="text.secondary">No messages found.</Typography> : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConversationView(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function AuditLogsPage({ showToast }) {
  const [filters, setFilters] = useState({ action: '', targetType: '', page: 1, limit: 30 });
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 30, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAuditLogs(filters);
      setRows(data.logs || []);
      setPagination(data.pagination || { page: 1, limit: 30, total: 0, totalPages: 1 });
    } catch (err) {
      showToast(safeError(err, 'Failed to load audit logs'), 'error');
    } finally {
      setLoading(false);
    }
  }, [filters, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Box>
      <PageHeader
        title="Audit Logs"
        subtitle="Track every admin mutation with before/after evidence"
        actions={[
          <Button key="refresh" startIcon={<RefreshIcon />} onClick={load} variant="outlined" disabled={loading}>Refresh</Button>,
        ]}
      />

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
        <TextField label="Action" value={filters.action} onChange={(e) => setFilters((prev) => ({ ...prev, action: e.target.value, page: 1 }))} fullWidth />
        <TextField label="Target Type" value={filters.targetType} onChange={(e) => setFilters((prev) => ({ ...prev, targetType: e.target.value, page: 1 }))} fullWidth />
      </Stack>

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Time</TableCell>
              <TableCell>Admin</TableCell>
              <TableCell>Action</TableCell>
              <TableCell>Target</TableCell>
              <TableCell>Note</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={5} align="center"><CircularProgress size={26} /></TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={5} align="center">No audit logs found</TableCell></TableRow>
            ) : rows.map((log) => (
              <TableRow key={log.id} hover>
                <TableCell>{formatDate(log.createdAt)}</TableCell>
                <TableCell>{log?.admin?.name || log?.admin?.email || '-'}</TableCell>
                <TableCell>{log.action}</TableCell>
                <TableCell>{log.targetType} {log.targetId ? `(${log.targetId})` : ''}</TableCell>
                <TableCell sx={{ maxWidth: 420 }}><span className="truncate-inline">{log.note || '-'}</span></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 1.5 }}>
        <Typography variant="body2" color="text.secondary">Total: {pagination.total || 0}</Typography>
        <Pagination page={pagination.page || 1} count={pagination.totalPages || 1} onChange={(_, page) => setFilters((prev) => ({ ...prev, page }))} color="primary" />
      </Stack>
    </Box>
  );
}

function CsrPage({ showToast }) {
  const [summary, setSummary] = useState(null);
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingActivity, setEditingActivity] = useState(null);
  const [form, setForm] = useState({
    title: '',
    description: '',
    location: '',
    activityDate: '',
    milestoneNumber: '',
    mediaFiles: [],
  });

  const resetForm = useCallback(() => {
    setForm({
      title: '',
      description: '',
      location: '',
      activityDate: '',
      milestoneNumber: '',
      mediaFiles: [],
    });
    setEditingActivity(null);
  }, []);

  const fileToDataUri = useCallback((file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read selected file'));
    reader.readAsDataURL(file);
  }), []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [summaryRes, activitiesRes] = await Promise.all([
        fetchCsrSummary(),
        fetchCsrActivities(),
      ]);
      setSummary(summaryRes?.summary || null);
      setActivities(activitiesRes?.activities || []);
    } catch (err) {
      showToast(safeError(err, 'Failed to load CSR dashboard'), 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSubmit = async () => {
    const title = String(form.title || '').trim();
    if (!title) {
      showToast('Title is required', 'warning');
      return;
    }

    setSaving(true);
    try {
      const mediaPayload = await Promise.all((form.mediaFiles || []).slice(0, 12).map(async (file) => {
        const dataUri = await fileToDataUri(file);
        const mime = String(file?.type || '').toLowerCase();
        return {
          type: mime.startsWith('video/') ? 'video' : 'image',
          url: dataUri,
          caption: '',
        };
      }));

      const payload = {
        title,
        description: String(form.description || '').trim(),
        location: String(form.location || '').trim(),
        activityDate: form.activityDate || undefined,
        milestoneNumber: Number(form.milestoneNumber || 0) || undefined,
        media: mediaPayload,
      };

      if (editingActivity?.id) {
        await updateCsrActivity(editingActivity.id, payload);
        showToast('CSR activity updated', 'success');
      } else {
        await createCsrActivity(payload);
        showToast('CSR activity created', 'success');
      }

      resetForm();
      await load();
    } catch (err) {
      showToast(safeError(err, 'Failed to save CSR activity'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const togglePublish = async (activity) => {
    try {
      await setCsrActivityPublishState(activity.id, activity.status !== 'published');
      showToast(activity.status === 'published' ? 'Activity moved to draft' : 'Activity published', 'success');
      await load();
    } catch (err) {
      showToast(safeError(err, 'Failed to update publish status'), 'error');
    }
  };

  return (
    <Box>
      <PageHeader
        title="CSR Activities"
        subtitle="Publish social impact updates funded by ₹1 from each paid order"
        actions={[
          <Button key="refresh" startIcon={<RefreshIcon />} variant="outlined" onClick={load} disabled={loading}>Refresh</Button>,
        ]}
      />

      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid item xs={12} md={4}>
          <Card><CardContent><Typography color="text.secondary">CSR Collected</Typography><Typography variant="h4">₹{Number(summary?.totalContributionAmount || 0).toLocaleString('en-IN')}</Typography></CardContent></Card>
        </Grid>
        <Grid item xs={12} md={4}>
          <Card><CardContent><Typography color="text.secondary">Paid Orders Counted</Typography><Typography variant="h4">{Number(summary?.totalPaidOrdersCounted || 0).toLocaleString('en-IN')}</Typography></CardContent></Card>
        </Grid>
        <Grid item xs={12} md={4}>
          <Card><CardContent><Typography color="text.secondary">Completed Milestones</Typography><Typography variant="h4">{Number(summary?.completedMilestones || 0)}</Typography></CardContent></Card>
        </Grid>
      </Grid>

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 1.5 }}>{editingActivity ? 'Edit CSR Activity' : 'Create CSR Activity'}</Typography>
          <Grid container spacing={1.5}>
            <Grid item xs={12} md={6}>
              <TextField label="Title" fullWidth value={form.title} onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))} />
            </Grid>
            <Grid item xs={12} md={3}>
              <TextField label="Milestone Number" fullWidth value={form.milestoneNumber} onChange={(e) => setForm((prev) => ({ ...prev, milestoneNumber: e.target.value }))} />
            </Grid>
            <Grid item xs={12} md={3}>
              <TextField label="Activity Date" type="date" fullWidth InputLabelProps={{ shrink: true }} value={form.activityDate} onChange={(e) => setForm((prev) => ({ ...prev, activityDate: e.target.value }))} />
            </Grid>
            <Grid item xs={12}>
              <TextField label="Description" fullWidth multiline minRows={3} value={form.description} onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))} />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField label="Location" fullWidth value={form.location} onChange={(e) => setForm((prev) => ({ ...prev, location: e.target.value }))} />
            </Grid>
            <Grid item xs={12} md={6}>
              <Button variant="outlined" component="label" fullWidth>
                Select Images/Videos
                <input hidden multiple type="file" accept="image/*,video/*" onChange={(event) => {
                  const files = Array.from(event.target.files || []);
                  setForm((prev) => ({ ...prev, mediaFiles: files }));
                }} />
              </Button>
              {form.mediaFiles.length > 0 ? (
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                  {form.mediaFiles.length} file(s) selected
                </Typography>
              ) : null}
            </Grid>
          </Grid>

          <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
            <Button variant="contained" onClick={handleSubmit} disabled={saving}>{saving ? 'Saving...' : (editingActivity ? 'Update Activity' : 'Create Activity')}</Button>
            <Button variant="text" onClick={resetForm} disabled={saving}>Clear</Button>
          </Stack>
        </CardContent>
      </Card>

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Milestone</TableCell>
              <TableCell>Title</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Media</TableCell>
              <TableCell>Updated</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={6} align="center"><CircularProgress size={24} /></TableCell></TableRow>
            ) : activities.length === 0 ? (
              <TableRow><TableCell colSpan={6} align="center">No CSR activities created yet</TableCell></TableRow>
            ) : activities.map((activity) => (
              <TableRow key={activity.id} hover>
                <TableCell>#{activity.milestoneNumber}</TableCell>
                <TableCell>{activity.title}</TableCell>
                <TableCell><Chip size="small" label={activity.status} color={activity.status === 'published' ? 'success' : 'default'} /></TableCell>
                <TableCell>{Array.isArray(activity.media) ? activity.media.length : 0}</TableCell>
                <TableCell>{formatDate(activity.updatedAt)}</TableCell>
                <TableCell align="right">
                  <Stack direction="row" spacing={1} justifyContent="flex-end">
                    <Button size="small" variant="outlined" onClick={() => {
                      setEditingActivity(activity);
                      setForm({
                        title: activity.title || '',
                        description: activity.description || '',
                        location: activity.location || '',
                        activityDate: activity.activityDate ? String(activity.activityDate).slice(0, 10) : '',
                        milestoneNumber: String(activity.milestoneNumber || ''),
                        mediaFiles: [],
                      });
                    }}>Edit</Button>
                    <Button size="small" variant="contained" onClick={() => togglePublish(activity)}>
                      {activity.status === 'published' ? 'Unpublish' : 'Publish'}
                    </Button>
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}

function AdminLayout({ profile, onLogout, showToast }) {
  const location = useLocation();

  const menuItems = useMemo(() => [
    { label: 'Dashboard', path: '/' },
    { label: 'Users', path: '/users' },
    { label: 'Products', path: '/products' },
    { label: 'Orders', path: '/orders' },
    { label: 'Payouts', path: '/payouts' },
    { label: 'Reviews', path: '/reviews' },
    { label: 'Chats', path: '/chats' },
    { label: 'CSR', path: '/csr' },
    { label: 'Audit Logs', path: '/audit' },
  ], []);

  return (
    <Box className="admin-shell" sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <CssBaseline />
      <AppBar position="fixed" sx={{ zIndex: (theme) => theme.zIndex.drawer + 1 }}>
        <Toolbar sx={{ minHeight: 76, px: { xs: 2, md: 3 } }}>
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexGrow: 1 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: 'primary.main', boxShadow: '0 0 0 6px rgba(124, 231, 255, 0.12)' }} />
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 800, letterSpacing: '-0.02em' }}>HANDKRAFT Control Center</Typography>
              <Typography variant="caption" color="text.secondary">Minimal, dark, and operations-first</Typography>
            </Box>
          </Stack>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Chip size="small" label={profile?.adminRole || 'admin'} color="primary" variant="outlined" />
            <Typography variant="body2" sx={{ opacity: 0.9 }}>{profile?.name || profile?.email || 'Admin'}</Typography>
            <IconButton color="inherit" onClick={onLogout}><LogoutIcon /></IconButton>
          </Stack>
        </Toolbar>
      </AppBar>

      <Drawer
        variant="permanent"
        sx={{
          width: drawerWidth,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: drawerWidth,
            boxSizing: 'border-box',
            borderRight: '1px solid rgba(148, 163, 184, 0.12)',
          },
        }}
      >
        <Toolbar sx={{ minHeight: 76 }} />
        <Box sx={{ px: 2, pt: 2, pb: 1 }}>
          <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: '0.18em' }}>Navigation</Typography>
        </Box>
        <List sx={{ px: 1.5, gap: 0.75, display: 'grid' }}>
          {menuItems.map((item) => {
            const active = item.path === '/' ? location.pathname === '/' : location.pathname.startsWith(item.path);
            return (
              <ListItem key={item.path} disablePadding>
                <ListItemButton
                  component={Link}
                  to={item.path}
                  selected={active}
                  sx={{
                    borderRadius: 2,
                    mb: 0.5,
                    border: '1px solid transparent',
                    '&.Mui-selected': {
                      bgcolor: 'rgba(124, 231, 255, 0.12)',
                      borderColor: 'rgba(124, 231, 255, 0.24)',
                    },
                  }}
                >
                  <ListItemText primary={item.label} primaryTypographyProps={{ fontWeight: active ? 700 : 600 }} />
                </ListItemButton>
              </ListItem>
            );
          })}
        </List>
      </Drawer>

      <Box component="main" sx={{ flexGrow: 1, p: { xs: 2, md: 3 } }}>
        <Toolbar />
        <Container maxWidth="xl" sx={{ pb: 4 }}>
          <Routes>
            <Route path="/" element={<DashboardPage showToast={showToast} />} />
            <Route path="/users" element={<UsersPage showToast={showToast} />} />
            <Route path="/products" element={<ProductsPage showToast={showToast} />} />
            <Route path="/orders" element={<OrdersPage showToast={showToast} />} />
            <Route path="/payouts" element={<PayoutsPage showToast={showToast} />} />
            <Route path="/reviews" element={<ReviewsPage showToast={showToast} />} />
            <Route path="/chats" element={<ChatsPage showToast={showToast} />} />
            <Route path="/csr" element={<CsrPage showToast={showToast} />} />
            <Route path="/audit" element={<AuditLogsPage showToast={showToast} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Container>
      </Box>
    </Box>
  );
}

export default function App() {
  const [token, setToken] = useState(getStoredToken());
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(Boolean(token));
  const [profileError, setProfileError] = useState('');
  const { showToast, toastNode } = useNotifier();

  const loadProfile = useCallback(async () => {
    if (!token) {
      setProfile(null);
      setProfileLoading(false);
      return;
    }

    setProfileLoading(true);
    setProfileError('');
    try {
      const response = await fetchProfile();
      const user = response?.user;
      if (!user?.isAdmin) {
        throw new Error('This account is not an admin account.');
      }
      setProfile(user);
    } catch (err) {
      const message = safeError(err, 'Session expired. Please login again.');
      setProfileError(message);
      logoutAdmin();
      setToken('');
      setProfile(null);
      showToast(message, 'error');
    } finally {
      setProfileLoading(false);
    }
  }, [token, showToast]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const handleLoggedIn = () => {
    setToken(getStoredToken());
  };

  const handleLogout = () => {
    logoutAdmin();
    setToken('');
    setProfile(null);
    setProfileError('');
  };

  return (
    <AppRouter>
      {token ? (
        profileLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
            <CircularProgress />
          </Box>
        ) : profile ? (
          <AdminLayout profile={profile} onLogout={handleLogout} showToast={showToast} />
        ) : (
          <Navigate to="/login" replace />
        )
      ) : (
        <Routes>
          <Route path="/login" element={<LoginPage onLoggedIn={handleLoggedIn} />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      )}
      {profileError ? <Alert severity="error" sx={{ position: 'fixed', top: 8, right: 8 }}>{profileError}</Alert> : null}
      {toastNode}
    </AppRouter>
  );
}