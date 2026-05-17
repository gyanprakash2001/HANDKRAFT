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
  ListItemIcon,
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
import AnalyticsIcon from '@mui/icons-material/Analytics';
import ChatIcon from '@mui/icons-material/Chat';
import DashboardIcon from '@mui/icons-material/Dashboard';
import LogoutIcon from '@mui/icons-material/Logout';
import RefreshIcon from '@mui/icons-material/Refresh';
import DeleteIcon from '@mui/icons-material/Delete';
import VisibilityIcon from '@mui/icons-material/Visibility';
import EditIcon from '@mui/icons-material/Edit';
import Inventory2Icon from '@mui/icons-material/Inventory2';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import ManageSearchIcon from '@mui/icons-material/ManageSearch';
import MenuIcon from '@mui/icons-material/Menu';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import PaymentsIcon from '@mui/icons-material/Payments';
import PeopleIcon from '@mui/icons-material/People';
import RateReviewIcon from '@mui/icons-material/RateReview';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import ShoppingBagIcon from '@mui/icons-material/ShoppingBag';
import VolunteerActivismIcon from '@mui/icons-material/VolunteerActivism';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
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
  fetchInventoryControl,
  fetchOrderDetail,
  fetchOrders,
  fetchPaymentReconciliations,
  fetchPayouts,
  fetchProducts,
  fetchRevenueAnalytics,
  fetchReviews,
  fetchShipments,
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
const SHIPMENT_STATUS_OPTIONS = ['pending', 'ready_for_booking', 'booked', 'awb_assigned', 'pickup_scheduled', 'in_transit', 'delivered', 'cancelled', 'failed'];
const PAYOUT_STATUS_OPTIONS = ['awaiting_delivery', 'on_hold', 'ready_for_payout', 'paid', 'failed', 'reversed', 'cancelled'];
const KYC_STATUS_OPTIONS = ['pending', 'verified', 'rejected'];
const ADMIN_ROLE_OPTIONS = ['support', 'ops', 'finance', 'superadmin'];
const RECONCILIATION_EVENT_OPTIONS = ['payment_captured', 'payout_record_created', 'payout_hold_started', 'payout_released', 'payout_claimed', 'payout_failed', 'payout_cancelled', 'reserve_released', 'refund_issued', 'split_recalculated'];
const RECONCILIATION_SOURCE_OPTIONS = ['system', 'admin', 'seller', 'scheduler', 'webhook'];
const AppRouter = import.meta.env.PROD ? HashRouter : BrowserRouter;

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
}

function formatCurrency(value) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function formatNumber(value) {
  return new Intl.NumberFormat('en-IN').format(Number(value || 0));
}

function statusLabel(value) {
  return String(value || '-').replace(/_/g, ' ');
}

function statusColor(value) {
  const normalized = String(value || '').toLowerCase();
  if (['completed', 'delivered', 'paid', 'ready_for_payout', 'active', 'success', 'ok'].includes(normalized)) return 'success';
  if (['failed', 'cancelled', 'refunded', 'inactive', 'suspended'].includes(normalized)) return 'error';
  if (['shipped', 'in_transit', 'booked', 'awb_assigned', 'pickup_scheduled', 'confirmed'].includes(normalized)) return 'info';
  if (['pending', 'awaiting_delivery', 'on_hold', 'ready_for_booking'].includes(normalized)) return 'warning';
  return 'default';
}

function firstImageFromProduct(product) {
  if (Array.isArray(product?.images) && product.images[0]) return product.images[0];
  if (Array.isArray(product?.media) && product.media[0]?.url) return product.media[0].url;
  return '';
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

function SurfaceCard({ title, children, sx, action }) {
  return (
    <Card className="admin-panel" sx={{ ...sx }}>
      <CardContent sx={{ '&:last-child': { pb: 2 } }}>
        {title || action ? (
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
            {title ? <Typography variant="h6">{title}</Typography> : <span />}
            {action || null}
          </Stack>
        ) : null}
        {children}
      </CardContent>
    </Card>
  );
}

function StatCard({ label, value, detail, accent = false }) {
  return (
    <Card className="admin-panel admin-stat-card" sx={{ height: '100%' }}>
      <CardContent sx={{ '&:last-child': { pb: 2 } }}>
        <Typography color="text.secondary" variant="body2" sx={{ mb: 0.75, textTransform: 'uppercase', letterSpacing: 0 }}>
          {label}
        </Typography>
        <Typography variant="h4" sx={{ fontWeight: 800, letterSpacing: 0, color: accent ? 'primary.main' : 'text.primary' }}>
          {value}
        </Typography>
        {detail ? <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>{detail}</Typography> : null}
      </CardContent>
    </Card>
  );
}

function MiniStat({ label, value, detail, tone = 'default' }) {
  const toneClass = tone === 'danger' ? 'admin-mini-stat-danger' : tone === 'warning' ? 'admin-mini-stat-warning' : '';
  return (
    <Paper className={`admin-mini-stat ${toneClass}`} variant="outlined">
      <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0 }}>{label}</Typography>
      <Typography variant="h6" sx={{ mt: 0.25 }}>{value}</Typography>
      {detail ? <Typography variant="caption" color="text.secondary">{detail}</Typography> : null}
    </Paper>
  );
}

function ProductImage({ src, alt, size = 44 }) {
  return src ? (
    <Box
      component="img"
      src={src}
      alt={alt || 'Product'}
      sx={{ width: size, height: size, borderRadius: 1.5, objectFit: 'cover', bgcolor: 'action.hover', display: 'block' }}
      onError={(event) => { event.currentTarget.style.display = 'none'; }}
    />
  ) : (
    <Box sx={{ width: size, height: size, borderRadius: 1.5, bgcolor: 'action.hover', display: 'grid', placeItems: 'center' }}>
      <Inventory2Icon fontSize="small" color="disabled" />
    </Box>
  );
}

function StatusPills({ counts = {}, order = [] }) {
  const keys = order.length ? order : Object.keys(counts || {});
  if (!keys.length) {
    return <Typography color="text.secondary">No status data yet</Typography>;
  }

  return (
    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
      {keys.map((key) => (
        <Chip
          key={key}
          size="small"
          label={`${statusLabel(key)}: ${Number(counts?.[key] || 0)}`}
          color={statusColor(key)}
          variant={Number(counts?.[key] || 0) > 0 ? 'filled' : 'outlined'}
        />
      ))}
    </Stack>
  );
}

function RevenueChart({ data = [], compact = false }) {
  if (!Array.isArray(data) || data.length === 0) {
    return <Typography color="text.secondary">No paid order data for this period.</Typography>;
  }

  return (
    <Box sx={{ height: compact ? 220 : 320, width: '100%' }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 10, right: 12, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#2f80ed" stopOpacity={0.34} />
              <stop offset="95%" stopColor="#2f80ed" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(148, 163, 184, 0.18)" vertical={false} />
          <XAxis dataKey="date" tick={{ fill: '#8fa3bf', fontSize: 11 }} tickMargin={8} minTickGap={24} />
          <YAxis tick={{ fill: '#8fa3bf', fontSize: 11 }} width={58} tickFormatter={(value) => `Rs ${Number(value || 0)}`} />
          <RechartsTooltip
            formatter={(value, name) => (name === 'revenue' ? [formatCurrency(value), 'Revenue'] : [value, 'Orders'])}
            contentStyle={{ background: '#111827', border: '1px solid rgba(148, 163, 184, 0.22)', borderRadius: 8 }}
          />
          <Area type="monotone" dataKey="revenue" stroke="#2f80ed" strokeWidth={2} fill="url(#revenueFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </Box>
  );
}

function EmptyTableRow({ colSpan, label }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} align="center">
        <Typography color="text.secondary">{label}</Typography>
      </TableCell>
    </TableRow>
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
  const [analytics, setAnalytics] = useState(null);
  const [inventory, setInventory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [overviewRes, systemRes, analyticsRes, inventoryRes] = await Promise.allSettled([
        fetchAdminOverview(),
        fetchSystemHealth(),
        fetchRevenueAnalytics({ days: 30 }),
        fetchInventoryControl({ threshold: 10, limit: 5 }),
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

      if (analyticsRes.status === 'fulfilled') {
        setAnalytics(analyticsRes.value);
      } else {
        setAnalytics(null);
        showToast('Revenue analytics are currently unavailable', 'warning');
      }

      if (inventoryRes.status === 'fulfilled') {
        setInventory(inventoryRes.value);
      } else {
        setInventory(null);
        showToast('Inventory controls are currently unavailable', 'warning');
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
  const shipmentCounts = analytics?.statusCounts?.shipments || {};
  const openShipmentCount = Object.entries(shipmentCounts)
    .filter(([status]) => !['delivered', 'cancelled'].includes(status))
    .reduce((sum, [, count]) => sum + Number(count || 0), 0);
  const failedShipmentCount = Number(shipmentCounts.failed || 0);

  return (
    <Box>
      <PageHeader
        title="Operations Dashboard"
        subtitle="Live control summary for orders, revenue, shipment health, inventory, and payouts"
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
          <Grid container spacing={2} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' } }}>
            <Grid item xs={12} md={3}>
              <StatCard label="Revenue Today" value={formatCurrency(analytics?.totals?.todayRevenue || 0)} detail={`${formatNumber(analytics?.totals?.todayOrders || 0)} paid orders today`} accent />
            </Grid>
            <Grid item xs={12} md={3}>
              <StatCard label="Orders" value={overview.orders?.total || 0} detail={`${formatCurrency(analytics?.totals?.lifetimeRevenue || 0)} lifetime paid revenue`} />
            </Grid>
            <Grid item xs={12} md={3}>
              <StatCard label="Shipments Needing Attention" value={openShipmentCount} detail={`${failedShipmentCount} failed bookings or syncs`} />
            </Grid>
            <Grid item xs={12} md={3}>
              <StatCard label="Low Stock Products" value={inventory?.summary?.lowStockProducts || 0} detail={`${inventory?.summary?.outOfStockProducts || 0} out of stock`} />
            </Grid>
          </Grid>

          <Grid container spacing={2} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '2fr 1fr' } }}>
            <Grid item xs={12} lg={8}>
              <SurfaceCard title="30-Day Revenue">
                <RevenueChart data={analytics?.dailySales || []} compact />
              </SurfaceCard>
            </Grid>
            <Grid item xs={12} lg={4}>
              <SurfaceCard title="Order Flow">
                <Stack spacing={1.5}>
                  <Box>
                    <Typography variant="caption" color="text.secondary">Order status</Typography>
                    <StatusPills counts={analytics?.statusCounts?.orders || {}} order={ORDER_STATUS_OPTIONS} />
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary">Payment status</Typography>
                    <StatusPills counts={analytics?.statusCounts?.payments || {}} order={PAYMENT_STATUS_OPTIONS} />
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary">Shipment status</Typography>
                    <StatusPills counts={shipmentCounts} order={SHIPMENT_STATUS_OPTIONS} />
                  </Box>
                </Stack>
              </SurfaceCard>
            </Grid>
          </Grid>

          <Grid container spacing={2} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'repeat(3, minmax(0, 1fr))' } }}>
            <Grid item xs={12} lg={4}>
              <SurfaceCard title="Top Products">
                <Stack spacing={1.25}>
                  {(analytics?.topProducts || []).length === 0 ? (
                    <Typography color="text.secondary">No paid product sales yet</Typography>
                  ) : analytics.topProducts.slice(0, 5).map((product) => (
                    <Stack key={product.productId || product.title} direction="row" spacing={1.25} alignItems="center">
                      <ProductImage src={product.image} alt={product.title} />
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography fontWeight={700} noWrap>{product.title}</Typography>
                        <Typography variant="caption" color="text.secondary">{formatNumber(product.quantity)} sold</Typography>
                      </Box>
                      <Typography fontWeight={800}>{formatCurrency(product.revenue)}</Typography>
                    </Stack>
                  ))}
                </Stack>
              </SurfaceCard>
            </Grid>
            <Grid item xs={12} lg={4}>
              <SurfaceCard title="Inventory Alerts">
                <Stack spacing={1.25}>
                  {(inventory?.lowStockProducts || []).length === 0 ? (
                    <Typography color="text.secondary">No low stock products under this threshold</Typography>
                  ) : inventory.lowStockProducts.map((product) => (
                    <Stack key={product.id} direction="row" spacing={1.25} alignItems="center">
                      <ProductImage src={product.image} alt={product.title} />
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography fontWeight={700} noWrap>{product.title}</Typography>
                        <Typography variant="caption" color="text.secondary">{product.sellerName || 'No seller'} - {product.category || 'Uncategorized'}</Typography>
                      </Box>
                      <Chip size="small" icon={<WarningAmberIcon />} label={`${product.stock} left`} color={product.stock <= 0 ? 'error' : 'warning'} />
                    </Stack>
                  ))}
                </Stack>
              </SurfaceCard>
            </Grid>
            <Grid item xs={12} lg={4}>
              <SurfaceCard title="Platform Snapshot">
                <Grid container spacing={1.25} sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
                  <Grid item xs={6}><MiniStat label="Users" value={overview.users?.total || 0} detail={`${overview.users?.active || 0} active`} /></Grid>
                  <Grid item xs={6}><MiniStat label="Products" value={overview.products?.total || 0} detail={`${overview.products?.active || 0} active`} /></Grid>
                  <Grid item xs={6}><MiniStat label="Reviews" value={overview.reviews?.total || 0} detail={`${overview.reviews?.hidden || 0} hidden`} /></Grid>
                  <Grid item xs={6}><MiniStat label="Chats" value={overview.chats?.conversations || 0} detail={`${overview.chats?.messages || 0} messages`} /></Grid>
                </Grid>
              </SurfaceCard>
            </Grid>
          </Grid>

          <SurfaceCard title="Integration Readiness">
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Chip label={`Health: ${health?.ok ? 'OK' : 'Unknown'}`} color={health?.ok ? 'success' : 'default'} />
              <Chip label={`Razorpay: ${readiness?.readiness?.razorpay?.ready ? 'Ready' : 'Not Ready'}`} color={readiness?.readiness?.razorpay?.ready ? 'success' : 'warning'} />
              <Chip label={`NimbusPost: ${readiness?.readiness?.nimbuspost?.ready ? 'Ready' : 'Not Ready'}`} color={readiness?.readiness?.nimbuspost?.ready ? 'success' : 'warning'} />
              <Chip label={`Nimbus Mode: ${readiness?.readiness?.nimbuspost?.mode || '-'}`} variant="outlined" />
              <Chip label={`Mongo ReadyState: ${overview.system?.mongoReadyState ?? '-'}`} variant="outlined" />
              <Chip label={`Uptime: ${overview.system?.uptimeSeconds || 0}s`} variant="outlined" />
            </Stack>
          </SurfaceCard>

          <SurfaceCard title="Payout Status Snapshot">
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {Object.entries(overview.payouts || {}).length === 0 ? (
                <Typography color="text.secondary">No payout records yet</Typography>
              ) : Object.entries(overview.payouts || {}).map(([status, count]) => (
                <Chip key={status} label={`${statusLabel(status)}: ${count}`} color={statusColor(status)} />
              ))}
            </Stack>
          </SurfaceCard>
        </Stack>
      ) : null}
    </Box>
  );
}

function AnalyticsPage({ showToast }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetchRevenueAnalytics({ days });
      setData(response);
    } catch (err) {
      showToast(safeError(err, 'Failed to load analytics'), 'error');
    } finally {
      setLoading(false);
    }
  }, [days, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Box>
      <PageHeader
        title="Revenue Analytics"
        subtitle="Sales trend, paid order value, top products, and live order/payment status"
        actions={[
          <FormControl key="days" size="small" sx={{ minWidth: 150 }}>
            <InputLabel>Period</InputLabel>
            <Select label="Period" value={days} onChange={(event) => setDays(Number(event.target.value))}>
              <MenuItem value={7}>Last 7 days</MenuItem>
              <MenuItem value={30}>Last 30 days</MenuItem>
              <MenuItem value={90}>Last 90 days</MenuItem>
            </Select>
          </FormControl>,
          <Button key="refresh" startIcon={<RefreshIcon />} variant="outlined" onClick={load} disabled={loading}>Refresh</Button>,
        ]}
      />

      {loading ? <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box> : null}
      {!loading && data ? (
        <Stack spacing={2.5}>
          <Grid container spacing={2} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' } }}>
            <Grid item xs={12} md={3}><StatCard label="Period Revenue" value={formatCurrency(data?.totals?.recentRevenue || 0)} detail={`${formatNumber(data?.totals?.recentOrders || 0)} paid orders`} accent /></Grid>
            <Grid item xs={12} md={3}><StatCard label="Average Order Value" value={formatCurrency(data?.totals?.recentAverageOrderValue || 0)} detail={`Last ${data.days || days} days`} /></Grid>
            <Grid item xs={12} md={3}><StatCard label="This Month" value={formatCurrency(data?.totals?.monthRevenue || 0)} detail={`${formatNumber(data?.totals?.monthOrders || 0)} paid orders`} /></Grid>
            <Grid item xs={12} md={3}><StatCard label="Lifetime Revenue" value={formatCurrency(data?.totals?.lifetimeRevenue || 0)} detail={`${formatNumber(data?.totals?.lifetimeOrders || 0)} paid orders`} /></Grid>
          </Grid>

          <SurfaceCard title="Sales Trend">
            <RevenueChart data={data.dailySales || []} />
          </SurfaceCard>

          <Grid container spacing={2} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '7fr 5fr' } }}>
            <Grid item xs={12} lg={7}>
              <SurfaceCard title="Top Product Revenue">
                {(data.topProducts || []).length === 0 ? (
                  <Typography color="text.secondary">No product sales yet for this period.</Typography>
                ) : (
                  <Box sx={{ height: 300 }}>
                    <ResponsiveContainer>
                      <BarChart data={data.topProducts || []} layout="vertical" margin={{ top: 8, right: 18, left: 18, bottom: 8 }}>
                        <CartesianGrid stroke="rgba(148, 163, 184, 0.18)" horizontal={false} />
                        <XAxis type="number" tick={{ fill: '#8fa3bf', fontSize: 11 }} tickFormatter={(value) => `Rs ${Number(value || 0)}`} />
                        <YAxis type="category" dataKey="title" width={130} tick={{ fill: '#8fa3bf', fontSize: 11 }} />
                        <RechartsTooltip
                          formatter={(value) => [formatCurrency(value), 'Revenue']}
                          contentStyle={{ background: '#111827', border: '1px solid rgba(148, 163, 184, 0.22)', borderRadius: 8 }}
                        />
                        <Bar dataKey="revenue" fill="#20b486" radius={[0, 6, 6, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </Box>
                )}
              </SurfaceCard>
            </Grid>
            <Grid item xs={12} lg={5}>
              <SurfaceCard title="Live Status Counts">
                <Stack spacing={1.5}>
                  <Box>
                    <Typography variant="caption" color="text.secondary">Orders</Typography>
                    <StatusPills counts={data.statusCounts?.orders || {}} order={ORDER_STATUS_OPTIONS} />
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary">Payments</Typography>
                    <StatusPills counts={data.statusCounts?.payments || {}} order={PAYMENT_STATUS_OPTIONS} />
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary">Shipments</Typography>
                    <StatusPills counts={data.statusCounts?.shipments || {}} order={SHIPMENT_STATUS_OPTIONS} />
                  </Box>
                </Stack>
              </SurfaceCard>
            </Grid>
          </Grid>
        </Stack>
      ) : null}
    </Box>
  );
}

function ShipmentsPage({ showToast }) {
  const [filters, setFilters] = useState({ search: '', status: '', page: 1, limit: 20 });
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchShipments(filters);
      setRows(data.shipments || []);
      setPagination(data.pagination || { page: 1, limit: 20, total: 0, totalPages: 1 });
    } catch (err) {
      showToast(safeError(err, 'Failed to load shipments'), 'error');
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
        title="Shipment Tracking"
        subtitle="AWB, courier, delivery state, tracking links, failed booking reason, and item context per order"
        actions={[
          <Button key="refresh" startIcon={<RefreshIcon />} onClick={load} variant="outlined" disabled={loading}>Refresh</Button>,
        ]}
      />

      <Stack className="admin-filter-row" direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
        <TextField label="Search order, AWB, courier, ref, or error" value={filters.search} onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value, page: 1 }))} fullWidth />
        <FormControl sx={{ minWidth: 220 }}>
          <InputLabel>Shipment Status</InputLabel>
          <Select label="Shipment Status" value={filters.status} onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value, page: 1 }))}>
            <MenuItem value="">All</MenuItem>
            {SHIPMENT_STATUS_OPTIONS.map((status) => (<MenuItem key={status} value={status}>{statusLabel(status)}</MenuItem>))}
          </Select>
        </FormControl>
      </Stack>

      <TableContainer component={Paper} className="admin-table-wrap">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Shipment</TableCell>
              <TableCell>Order</TableCell>
              <TableCell>Buyer / Seller</TableCell>
              <TableCell>Courier</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Items</TableCell>
              <TableCell>Updated</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={8} align="center"><CircularProgress size={26} /></TableCell></TableRow>
            ) : rows.length === 0 ? (
              <EmptyTableRow colSpan={8} label="No shipments found" />
            ) : rows.map((shipment) => (
              <TableRow key={shipment.id} hover>
                <TableCell>
                  <Typography fontWeight={800}>{shipment.localShipmentRef || '-'}</Typography>
                  <Typography variant="caption" color="text.secondary">{shipment.awbNumber ? `AWB ${shipment.awbNumber}` : 'AWB not assigned'}</Typography>
                  {shipment.lastError ? <Typography variant="caption" color="error" sx={{ display: 'block', maxWidth: 260 }}>{shipment.lastError}</Typography> : null}
                </TableCell>
                <TableCell>
                  <Typography variant="body2" className="mono-id">{shipment.orderId}</Typography>
                  <Typography variant="caption" color="text.secondary">{formatCurrency(shipment.totalAmount)}</Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2">{shipment.buyer?.name || shipment.buyer?.email || '-'}</Typography>
                  <Typography variant="caption" color="text.secondary">Seller: {shipment.seller?.name || shipment.seller?.email || '-'}</Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2">{shipment.courierName || shipment.preferredCourierName || '-'}</Typography>
                  <Typography variant="caption" color="text.secondary">{shipment.provider || 'manual / pending'} {shipment.remoteStatus ? `- ${shipment.remoteStatus}` : ''}</Typography>
                </TableCell>
                <TableCell><Chip label={statusLabel(shipment.status)} size="small" color={statusColor(shipment.status)} /></TableCell>
                <TableCell>
                  <Stack spacing={0.5}>
                    {(shipment.items || []).slice(0, 2).map((item, index) => (
                      <Typography key={`${shipment.id}-${index}`} variant="caption">{item.quantity}x {item.title || 'Item'} ({statusLabel(item.fulfillmentStatus)})</Typography>
                    ))}
                    {(shipment.items || []).length > 2 ? <Typography variant="caption" color="text.secondary">+{shipment.items.length - 2} more</Typography> : null}
                  </Stack>
                </TableCell>
                <TableCell>{formatDate(shipment.updatedAt)}</TableCell>
                <TableCell align="right">
                  <Button
                    size="small"
                    startIcon={<OpenInNewIcon />}
                    href={shipment.trackingUrl || undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    disabled={!shipment.trackingUrl}
                  >
                    Track
                  </Button>
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

function ReconciliationPage({ showToast }) {
  const [filters, setFilters] = useState({ search: '', event: '', source: '', page: 1, limit: 20 });
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [selectedRow, setSelectedRow] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchPaymentReconciliations(filters);
      setRows(data.reconciliations || []);
      setSummary(data.summary || null);
      setPagination(data.pagination || { page: 1, limit: 20, total: 0, totalPages: 1 });
    } catch (err) {
      showToast(safeError(err, 'Failed to load payment reconciliation'), 'error');
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
        title="Payment Reconciliation"
        subtitle="Trace payment captures, payout splits, gateway IDs, reserves, and payout lifecycle events"
        actions={[
          <Button key="refresh" startIcon={<RefreshIcon />} onClick={load} variant="outlined" disabled={loading}>Refresh</Button>,
        ]}
      />

      <Stack className="admin-filter-row" direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
        <TextField label="Search order, seller, gateway, payout" value={filters.search} onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value, page: 1 }))} fullWidth />
        <FormControl sx={{ minWidth: 240 }}>
          <InputLabel>Event</InputLabel>
          <Select label="Event" value={filters.event} onChange={(e) => setFilters((prev) => ({ ...prev, event: e.target.value, page: 1 }))}>
            <MenuItem value="">All</MenuItem>
            {RECONCILIATION_EVENT_OPTIONS.map((event) => (<MenuItem key={event} value={event}>{statusLabel(event)}</MenuItem>))}
          </Select>
        </FormControl>
        <FormControl sx={{ minWidth: 160 }}>
          <InputLabel>Source</InputLabel>
          <Select label="Source" value={filters.source} onChange={(e) => setFilters((prev) => ({ ...prev, source: e.target.value, page: 1 }))}>
            <MenuItem value="">All</MenuItem>
            {RECONCILIATION_SOURCE_OPTIONS.map((source) => (<MenuItem key={source} value={source}>{source}</MenuItem>))}
          </Select>
        </FormControl>
      </Stack>

      <SurfaceCard title="Reconciliation Summary" sx={{ mb: 2 }}>
        <Stack spacing={1.25}>
          <StatusPills counts={(summary?.byEvent || []).reduce((acc, item) => ({ ...acc, [item.event]: item.count }), {})} />
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {(summary?.bySource || []).map((item) => (
              <Chip key={item.source} label={`${item.source}: ${item.count}`} variant="outlined" />
            ))}
          </Stack>
        </Stack>
      </SurfaceCard>

      <TableContainer component={Paper} className="admin-table-wrap">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Time</TableCell>
              <TableCell>Event</TableCell>
              <TableCell>Order</TableCell>
              <TableCell>Seller</TableCell>
              <TableCell>Gateway</TableCell>
              <TableCell>Payout</TableCell>
              <TableCell align="right">Amount</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={8} align="center"><CircularProgress size={26} /></TableCell></TableRow>
            ) : rows.length === 0 ? (
              <EmptyTableRow colSpan={8} label="No reconciliation rows found" />
            ) : rows.map((row) => (
              <TableRow key={row.id} hover>
                <TableCell>{formatDate(row.createdAt)}</TableCell>
                <TableCell><Chip label={statusLabel(row.event)} size="small" color={statusColor(row.event)} /></TableCell>
                <TableCell>
                  <Typography className="mono-id" variant="body2">{row.order?.id || '-'}</Typography>
                  <Typography variant="caption" color="text.secondary">{statusLabel(row.order?.paymentStatus)} - {formatCurrency(row.order?.totalAmount)}</Typography>
                </TableCell>
                <TableCell>{row.seller?.name || row.seller?.email || '-'}</TableCell>
                <TableCell>
                  <Typography variant="caption" className="mono-id">{row.gatewayPaymentId || row.gatewayOrderId || '-'}</Typography>
                </TableCell>
                <TableCell>
                  <Chip size="small" label={statusLabel(row.payoutStatus || row.payout?.status || 'not linked')} color={statusColor(row.payoutStatus || row.payout?.status)} />
                </TableCell>
                <TableCell align="right">{formatCurrency(row.amount || row.payout?.netPayoutAmount || 0)}</TableCell>
                <TableCell align="right"><IconButton size="small" onClick={() => setSelectedRow(row)}><VisibilityIcon fontSize="small" /></IconButton></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 1.5 }}>
        <Typography variant="body2" color="text.secondary">Total: {pagination.total || 0}</Typography>
        <Pagination page={pagination.page || 1} count={pagination.totalPages || 1} onChange={(_, page) => setFilters((prev) => ({ ...prev, page }))} color="primary" />
      </Stack>

      <Dialog open={Boolean(selectedRow)} onClose={() => setSelectedRow(null)} fullWidth maxWidth="md">
        <DialogTitle>Reconciliation Detail</DialogTitle>
        <DialogContent dividers>
          {selectedRow ? (
            <Stack spacing={2}>
              <Grid container spacing={1.5} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' } }}>
                <Grid item xs={12} md={4}><MiniStat label="Event" value={statusLabel(selectedRow.event)} detail={selectedRow.source} /></Grid>
                <Grid item xs={12} md={4}><MiniStat label="Order Total" value={formatCurrency(selectedRow.order?.totalAmount || 0)} detail={selectedRow.order?.id} /></Grid>
                <Grid item xs={12} md={4}><MiniStat label="Net Payout" value={formatCurrency(selectedRow.payout?.netPayoutAmount || selectedRow.amount || 0)} detail={`Reserve ${formatCurrency(selectedRow.payout?.reserveAmount || 0)}`} /></Grid>
              </Grid>
              <TextField
                label="Snapshot"
                value={JSON.stringify(selectedRow.snapshot || {}, null, 2)}
                multiline
                minRows={10}
                fullWidth
                InputProps={{ readOnly: true }}
              />
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions><Button onClick={() => setSelectedRow(null)}>Close</Button></DialogActions>
      </Dialog>
    </Box>
  );
}

function InventoryPage({ showToast }) {
  const [filters, setFilters] = useState({ search: '', status: '', threshold: 10, page: 1, limit: 20 });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetchInventoryControl(filters);
      setData(response);
    } catch (err) {
      showToast(safeError(err, 'Failed to load inventory controls'), 'error');
    } finally {
      setLoading(false);
    }
  }, [filters, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const pagination = data?.pagination || { page: 1, limit: 20, total: 0, totalPages: 1 };

  return (
    <Box>
      <PageHeader
        title="Inventory Control"
        subtitle="Low stock alerts, product availability, and the exact stock movement history"
        actions={[
          <Button key="refresh" startIcon={<RefreshIcon />} onClick={load} variant="outlined" disabled={loading}>Refresh</Button>,
        ]}
      />

      <Grid container spacing={2} sx={{ mb: 2, display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' } }}>
        <Grid item xs={12} md={3}><StatCard label="Total Stock Units" value={formatNumber(data?.summary?.totalStockUnits || 0)} detail={`${formatNumber(data?.summary?.totalProducts || 0)} products`} /></Grid>
        <Grid item xs={12} md={3}><StatCard label="Low Stock" value={formatNumber(data?.summary?.lowStockProducts || 0)} detail={`Threshold ${data?.threshold || filters.threshold}`} accent /></Grid>
        <Grid item xs={12} md={3}><StatCard label="Out Of Stock" value={formatNumber(data?.summary?.outOfStockProducts || 0)} detail="Needs immediate action" /></Grid>
        <Grid item xs={12} md={3}><StatCard label="Inactive Products" value={formatNumber(data?.summary?.inactiveProducts || 0)} detail={`${formatNumber(data?.summary?.activeProducts || 0)} active`} /></Grid>
      </Grid>

      <Stack className="admin-filter-row" direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
        <TextField label="Search title, category, seller" value={filters.search} onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value, page: 1 }))} fullWidth />
        <TextField label="Low stock threshold" type="number" value={filters.threshold} onChange={(e) => setFilters((prev) => ({ ...prev, threshold: Math.max(1, Number(e.target.value || 1)), page: 1 }))} sx={{ minWidth: 190 }} />
        <FormControl sx={{ minWidth: 160 }}>
          <InputLabel>Status</InputLabel>
          <Select label="Status" value={filters.status} onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value, page: 1 }))}>
            <MenuItem value="">All</MenuItem>
            <MenuItem value="active">Active</MenuItem>
            <MenuItem value="inactive">Inactive</MenuItem>
          </Select>
        </FormControl>
      </Stack>

      <Grid container spacing={2} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '7fr 5fr' } }}>
        <Grid item xs={12} lg={7}>
          <SurfaceCard title="Low Stock Products">
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Product</TableCell>
                    <TableCell>Seller</TableCell>
                    <TableCell>Price</TableCell>
                    <TableCell>Stock</TableCell>
                    <TableCell>Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {loading ? (
                    <TableRow><TableCell colSpan={5} align="center"><CircularProgress size={24} /></TableCell></TableRow>
                  ) : (data?.lowStockProducts || []).length === 0 ? (
                    <EmptyTableRow colSpan={5} label="No low stock products at this threshold" />
                  ) : data.lowStockProducts.map((product) => (
                    <TableRow key={product.id} hover>
                      <TableCell>
                        <Stack direction="row" spacing={1.25} alignItems="center">
                          <ProductImage src={product.image} alt={product.title} />
                          <Box sx={{ minWidth: 0 }}>
                            <Typography fontWeight={800} noWrap>{product.title}</Typography>
                            <Typography variant="caption" color="text.secondary">{product.category || '-'}</Typography>
                          </Box>
                        </Stack>
                      </TableCell>
                      <TableCell>{product.sellerName || product.sellerEmail || '-'}</TableCell>
                      <TableCell>{formatCurrency(product.price)}</TableCell>
                      <TableCell><Chip size="small" label={product.stock} color={product.stock <= 0 ? 'error' : 'warning'} /></TableCell>
                      <TableCell><Chip size="small" label={product.isActive ? 'active' : 'inactive'} color={product.isActive ? 'success' : 'default'} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 1.5 }}>
              <Typography variant="body2" color="text.secondary">Total: {pagination.total || 0}</Typography>
              <Pagination page={pagination.page || 1} count={pagination.totalPages || 1} onChange={(_, page) => setFilters((prev) => ({ ...prev, page }))} color="primary" />
            </Stack>
          </SurfaceCard>
        </Grid>
        <Grid item xs={12} lg={5}>
          <SurfaceCard title="Recent Stock Movements">
            <Stack spacing={1.25}>
              {loading ? <CircularProgress size={24} /> : null}
              {!loading && (data?.recentTransactions || []).length === 0 ? <Typography color="text.secondary">No stock transactions yet</Typography> : null}
              {!loading && (data?.recentTransactions || []).slice(0, 12).map((entry) => (
                <Paper key={entry.id} variant="outlined" sx={{ p: 1.25, borderRadius: 2 }}>
                  <Stack direction="row" spacing={1.25} alignItems="flex-start">
                    <ProductImage src={entry.product?.image} alt={entry.product?.title} size={38} />
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography fontWeight={800} noWrap>{entry.product?.title || 'Product'}</Typography>
                      <Typography variant="caption" color={entry.quantityChange < 0 ? 'error' : 'success.main'}>
                        {entry.quantityChange > 0 ? '+' : ''}{entry.quantityChange} units - {statusLabel(entry.type)}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{entry.reason || 'No reason recorded'}</Typography>
                    </Box>
                    <Typography variant="caption" color="text.secondary">{formatDate(entry.createdAt)}</Typography>
                  </Stack>
                </Paper>
              ))}
            </Stack>
          </SurfaceCard>
        </Grid>
      </Grid>
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

      <Stack className="admin-filter-row" direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
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

      <Stack className="admin-filter-row" direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
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
      const order = {
        ...data.order,
        _admin: {
          orderAuditLog: data.orderAuditLog || [],
          shipmentEvents: data.shipmentEvents || [],
          reconciliations: data.reconciliations || [],
          payouts: data.payouts || [],
        },
      };
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

  const selectedOrderAdmin = selectedOrder?._admin || {};

  return (
    <Box>
      <PageHeader
        title="Orders"
        subtitle="Control order, payment, and per-item fulfillment state"
        actions={[
          <Button key="refresh" startIcon={<RefreshIcon />} onClick={load} variant="outlined" disabled={loading}>Refresh</Button>,
        ]}
      />

      <Stack className="admin-filter-row" direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
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
        <DialogTitle>Order Detail - {selectedOrder?._id}</DialogTitle>
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

              {Array.isArray(selectedOrder.sellerShipments) && selectedOrder.sellerShipments.length > 0 ? (
                <>
                  <Divider />
                  <Typography variant="h6">Shipment Tracking</Typography>
                  <Grid container spacing={1.5} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' } }}>
                    {selectedOrder.sellerShipments.map((shipment, sIdx) => {
                      const carrier = shipment.carrier || {};
                      const trackingUrl = carrier.trackingUrl || shipment.trackingUrl || '';
                      return (
                        <Grid item xs={12} md={6} key={`${shipment.localShipmentRef || sIdx}`}>
                          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, height: '100%' }}>
                            <Stack spacing={1}>
                              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                                <Chip label={statusLabel(shipment.status || 'pending')} color={statusColor(shipment.status)} size="small" />
                                <Chip label={`Ref ${shipment.localShipmentRef || '-'}`} variant="outlined" size="small" />
                                <Chip label={`Courier ${carrier.courierName || shipment.preferredCourierName || '-'}`} variant="outlined" size="small" />
                              </Stack>
                              <Typography variant="body2" className="mono-id" fontWeight={800}>
                                AWB: {carrier.awbNumber || shipment.awbNumber || 'Not assigned'}
                              </Typography>
                              {shipment.lastError ? <Alert severity="error">{shipment.lastError}</Alert> : null}
                              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                                <Button size="small" variant="outlined" startIcon={<OpenInNewIcon />} href={trackingUrl || undefined} target="_blank" rel="noopener noreferrer" disabled={!trackingUrl}>
                                  Tracking
                                </Button>
                                <Button size="small" variant="outlined" startIcon={<OpenInNewIcon />} href={carrier.labelUrl || undefined} target="_blank" rel="noopener noreferrer" disabled={!carrier.labelUrl}>
                                  Label
                                </Button>
                              </Stack>
                              {(shipment.timeline || []).slice(-3).map((entry, index) => (
                                <Typography key={`${shipment.localShipmentRef}-${index}`} variant="caption" color="text.secondary">
                                  {formatDate(entry.at)} - {statusLabel(entry.status)} {entry.note ? `- ${entry.note}` : ''}
                                </Typography>
                              ))}
                            </Stack>
                          </Paper>
                        </Grid>
                      );
                    })}
                  </Grid>
                </>
              ) : null}

              <Divider />
              <Typography variant="h6">Payment, Payout, And Pricing</Typography>
              <Grid container spacing={1.5} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' } }}>
                <Grid item xs={12} md={4}>
                  <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, height: '100%' }}>
                    <Stack spacing={0.75}>
                      <Stack direction="row" justifyContent="space-between"><Typography variant="body2">Subtotal</Typography><Typography variant="body2">{formatCurrency(selectedOrder.subtotal || 0)}</Typography></Stack>
                      <Stack direction="row" justifyContent="space-between"><Typography variant="body2">Shipping</Typography><Typography variant="body2">{formatCurrency(selectedOrder.shippingCost || 0)}</Typography></Stack>
                      <Stack direction="row" justifyContent="space-between"><Typography variant="body2">Platform Fee</Typography><Typography variant="body2">{formatCurrency(selectedOrder.platformFee || selectedOrder.tax || 8)}</Typography></Stack>
                      <Typography variant="caption" color="text.secondary">CSR contribution: {formatCurrency(selectedOrder.csrContributionAmount || 1)}</Typography>
                      <Divider sx={{ my: 0.5 }} />
                      <Stack direction="row" justifyContent="space-between"><Typography variant="body2" fontWeight={700}>Total</Typography><Typography variant="body2" fontWeight={700} color="success.main">{formatCurrency(selectedOrder.totalAmount || 0)}</Typography></Stack>
                    </Stack>
                  </Paper>
                </Grid>
                <Grid item xs={12} md={4}>
                  <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, height: '100%' }}>
                    <Typography variant="caption" color="text.secondary">Gateway</Typography>
                    <Typography variant="body2" fontWeight={800}>{selectedOrder.paymentGateway?.provider || selectedOrder.paymentMethod || '-'}</Typography>
                    <Typography variant="caption" className="mono-id" sx={{ display: 'block' }}>Order: {selectedOrder.paymentGateway?.gatewayOrderId || '-'}</Typography>
                    <Typography variant="caption" className="mono-id" sx={{ display: 'block' }}>Payment: {selectedOrder.paymentGateway?.gatewayPaymentId || selectedOrder.transactionId || '-'}</Typography>
                    <Chip sx={{ mt: 1 }} size="small" label={statusLabel(selectedOrder.paymentStatus)} color={statusColor(selectedOrder.paymentStatus)} />
                  </Paper>
                </Grid>
                <Grid item xs={12} md={4}>
                  <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, height: '100%' }}>
                    <Typography variant="caption" color="text.secondary">Payout Split</Typography>
                    {(selectedOrderAdmin.payouts || []).length === 0 ? (
                      <Typography color="text.secondary">No payout record linked yet</Typography>
                    ) : selectedOrderAdmin.payouts.map((payout) => (
                      <Stack key={payout.id} spacing={0.5} sx={{ mt: 0.75 }}>
                        <Stack direction="row" justifyContent="space-between"><Typography variant="body2">Net payout</Typography><Typography variant="body2" fontWeight={800}>{formatCurrency(payout.split?.netPayoutAmount || 0)}</Typography></Stack>
                        <Typography variant="caption" color="text.secondary">Reserve {formatCurrency(payout.split?.reserveAmount || 0)} - Deduction {formatCurrency(payout.split?.deductionsTotal || 0)}</Typography>
                        <Chip size="small" label={statusLabel(payout.status)} color={statusColor(payout.status)} sx={{ alignSelf: 'flex-start' }} />
                      </Stack>
                    ))}
                  </Paper>
                </Grid>
              </Grid>

              {selectedOrder.shippingAddress ? (
                <>
                  <Typography variant="h6">Shipping Address</Typography>
                  <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                    <Typography variant="body2" fontWeight={700}>{selectedOrder.shippingAddress.fullName}</Typography>
                    <Typography variant="body2">{selectedOrder.shippingAddress.street}</Typography>
                    <Typography variant="body2">{selectedOrder.shippingAddress.city}, {selectedOrder.shippingAddress.state} {selectedOrder.shippingAddress.postalCode}</Typography>
                    <Typography variant="body2">{selectedOrder.shippingAddress.country}</Typography>
                    <Typography variant="body2" sx={{ mt: 0.5 }}>{selectedOrder.shippingAddress.phoneNumber} - {selectedOrder.shippingAddress.email}</Typography>
                  </Paper>
                </>
              ) : null}

              <Divider />
              <Typography variant="h6">Items Fulfillment</Typography>
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Image</TableCell>
                      <TableCell>Item</TableCell>
                      <TableCell>Price</TableCell>
                      <TableCell>Qty</TableCell>
                      <TableCell>Stock</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell align="right">Action</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(selectedOrder.items || []).map((item, index) => (
                      <TableRow key={`${selectedOrder._id}-${index}`}>
                        <TableCell><ProductImage src={item.image || firstImageFromProduct(item.product)} alt={item.title || item?.product?.title} size={48} /></TableCell>
                        <TableCell>
                          <Typography fontWeight={800}>{item?.product?.title || item?.title || '-'}</Typography>
                          <Typography variant="caption" color="text.secondary">{item?.seller?.name || item?.seller || 'Seller not populated'}</Typography>
                        </TableCell>
                        <TableCell>{formatCurrency(item.price || 0)}</TableCell>
                        <TableCell>{item.quantity || 0}</TableCell>
                        <TableCell>{item?.product?.stock ?? '-'}</TableCell>
                        <TableCell><Chip label={statusLabel(item.fulfillmentStatus)} size="small" color={statusColor(item.fulfillmentStatus)} /></TableCell>
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

              <Grid container spacing={2} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' } }}>
                <Grid item xs={12} md={6}>
                  <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, height: '100%' }}>
                    <Typography variant="h6" sx={{ mb: 1 }}>Payment Reconciliation</Typography>
                    {(selectedOrderAdmin.reconciliations || []).length === 0 ? (
                      <Typography color="text.secondary">No reconciliation events linked to this order yet.</Typography>
                    ) : (
                      <Stack spacing={1}>
                        {selectedOrderAdmin.reconciliations.map((row) => (
                          <Stack key={row.id} direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                            <Box sx={{ minWidth: 0 }}>
                              <Typography variant="body2" fontWeight={800}>{statusLabel(row.event)}</Typography>
                              <Typography variant="caption" color="text.secondary">{formatDate(row.createdAt)} - {row.source}</Typography>
                            </Box>
                            <Chip size="small" label={formatCurrency(row.amount || row.payout?.netPayoutAmount || 0)} />
                          </Stack>
                        ))}
                      </Stack>
                    )}
                  </Paper>
                </Grid>
                <Grid item xs={12} md={6}>
                  <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, height: '100%' }}>
                    <Typography variant="h6" sx={{ mb: 1 }}>Shipment Events</Typography>
                    {(selectedOrderAdmin.shipmentEvents || []).length === 0 ? (
                      <Typography color="text.secondary">No shipment events linked to this order yet.</Typography>
                    ) : (
                      <Stack spacing={1}>
                        {selectedOrderAdmin.shipmentEvents.slice(0, 6).map((event) => (
                          <Box key={event.id}>
                            <Stack direction="row" spacing={1} alignItems="center">
                              <Chip size="small" label={statusLabel(event.event)} color={statusColor(event.newStatus || event.event)} />
                              <Typography variant="caption" color="text.secondary">{formatDate(event.createdAt)}</Typography>
                            </Stack>
                            {event.errorMessage ? <Typography variant="caption" color="error">{event.errorMessage}</Typography> : null}
                          </Box>
                        ))}
                      </Stack>
                    )}
                  </Paper>
                </Grid>
              </Grid>

              <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                <Typography variant="h6" sx={{ mb: 1 }}>Order Lifecycle Timeline</Typography>
                {(selectedOrderAdmin.orderAuditLog || []).length === 0 ? (
                  <Typography color="text.secondary">No lifecycle events recorded yet.</Typography>
                ) : (
                  <Stack spacing={1}>
                    {selectedOrderAdmin.orderAuditLog.map((entry) => (
                      <Stack key={entry.id} direction={{ xs: 'column', md: 'row' }} spacing={1} justifyContent="space-between">
                        <Box>
                          <Typography variant="body2" fontWeight={800}>{statusLabel(entry.event)}</Typography>
                          <Typography variant="caption" color="text.secondary">{entry.note || entry.actorRole}</Typography>
                        </Box>
                        <Typography variant="caption" color="text.secondary">{formatDate(entry.createdAt)}</Typography>
                      </Stack>
                    ))}
                  </Stack>
                )}
              </Paper>
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

      <Stack className="admin-filter-row" direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
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

      <Stack className="admin-filter-row" direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
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

      <Stack className="admin-filter-row" direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
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
        subtitle="Publish social impact updates funded by the CSR contribution from each paid order"
        actions={[
          <Button key="refresh" startIcon={<RefreshIcon />} variant="outlined" onClick={load} disabled={loading}>Refresh</Button>,
        ]}
      />

      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid item xs={12} md={4}>
          <StatCard label="CSR Collected" value={formatCurrency(summary?.totalContributionAmount || 0)} />
        </Grid>
        <Grid item xs={12} md={4}>
          <StatCard label="Paid Orders Counted" value={Number(summary?.totalPaidOrdersCounted || 0).toLocaleString('en-IN')} />
        </Grid>
        <Grid item xs={12} md={4}>
          <StatCard label="Completed Milestones" value={Number(summary?.completedMilestones || 0)} />
        </Grid>
      </Grid>

      <SurfaceCard title={editingActivity ? 'Edit CSR Activity' : 'Create CSR Activity'} sx={{ mb: 2 }}>
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
      </SurfaceCard>

      <TableContainer component={Paper} className="admin-table-wrap">
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
  const [mobileOpen, setMobileOpen] = useState(false);

  const menuItems = useMemo(() => [
    { label: 'Dashboard', path: '/', icon: <DashboardIcon /> },
    { label: 'Analytics', path: '/analytics', icon: <AnalyticsIcon /> },
    { label: 'Shipments', path: '/shipments', icon: <LocalShippingIcon /> },
    { label: 'Reconciliation', path: '/reconciliation', icon: <PaymentsIcon /> },
    { label: 'Inventory', path: '/inventory', icon: <Inventory2Icon /> },
    { label: 'Users', path: '/users', icon: <PeopleIcon /> },
    { label: 'Products', path: '/products', icon: <ShoppingBagIcon /> },
    { label: 'Orders', path: '/orders', icon: <ReceiptLongIcon /> },
    { label: 'Payouts', path: '/payouts', icon: <PaymentsIcon /> },
    { label: 'Reviews', path: '/reviews', icon: <RateReviewIcon /> },
    { label: 'Chats', path: '/chats', icon: <ChatIcon /> },
    { label: 'CSR', path: '/csr', icon: <VolunteerActivismIcon /> },
    { label: 'Audit Logs', path: '/audit', icon: <ManageSearchIcon /> },
  ], []);

  const drawerContent = (
    <>
      <Toolbar sx={{ minHeight: 76 }} />
      <Box sx={{ px: 2, pt: 2, pb: 1 }}>
        <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 0 }}>Navigation</Typography>
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
                onClick={() => setMobileOpen(false)}
                sx={{
                  borderRadius: 1,
                  mb: 0.5,
                  border: '1px solid transparent',
                  '&.Mui-selected': {
                    bgcolor: 'rgba(56, 189, 248, 0.12)',
                    borderColor: 'rgba(56, 189, 248, 0.24)',
                  },
                }}
              >
                <ListItemIcon sx={{ minWidth: 34, color: active ? 'primary.main' : 'text.secondary' }}>
                  {item.icon}
                </ListItemIcon>
                <ListItemText primary={item.label} primaryTypographyProps={{ fontWeight: active ? 700 : 600 }} />
              </ListItemButton>
            </ListItem>
          );
        })}
      </List>
    </>
  );

  return (
    <Box className="admin-shell" sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <CssBaseline />
      <AppBar position="fixed" sx={{ zIndex: (theme) => theme.zIndex.drawer + 1 }}>
        <Toolbar sx={{ minHeight: 76, px: { xs: 2, md: 3 } }}>
          <IconButton color="inherit" onClick={() => setMobileOpen(true)} sx={{ display: { xs: 'inline-flex', md: 'none' }, mr: 1 }}>
            <MenuIcon />
          </IconButton>
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexGrow: 1 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: 'primary.main', boxShadow: '0 0 0 6px rgba(56, 189, 248, 0.12)' }} />
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 800, letterSpacing: 0 }}>HANDKRAFT Control Center</Typography>
              <Typography variant="caption" color="text.secondary">Minimal operations control</Typography>
            </Box>
          </Stack>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Chip size="small" label={profile?.adminRole || 'admin'} color="primary" variant="outlined" />
            <Typography variant="body2" sx={{ opacity: 0.9, display: { xs: 'none', sm: 'block' } }}>{profile?.name || profile?.email || 'Admin'}</Typography>
            <IconButton color="inherit" onClick={onLogout}><LogoutIcon /></IconButton>
          </Stack>
        </Toolbar>
      </AppBar>

      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        ModalProps={{ keepMounted: true }}
        sx={{
          display: { xs: 'block', md: 'none' },
          '& .MuiDrawer-paper': {
            width: drawerWidth,
            boxSizing: 'border-box',
          },
        }}
      >
        {drawerContent}
      </Drawer>

      <Drawer
        variant="permanent"
        sx={{
          display: { xs: 'none', md: 'block' },
          width: drawerWidth,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: drawerWidth,
            boxSizing: 'border-box',
            borderRight: '1px solid rgba(176, 186, 201, 0.12)',
          },
        }}
      >
        {drawerContent}
      </Drawer>

      <Box component="main" sx={{ flexGrow: 1, minWidth: 0, p: { xs: 1.5, md: 3 } }}>
        <Toolbar />
        <Container maxWidth="xl" sx={{ pb: 4 }}>
          <Routes>
            <Route path="/" element={<DashboardPage showToast={showToast} />} />
            <Route path="/analytics" element={<AnalyticsPage showToast={showToast} />} />
            <Route path="/shipments" element={<ShipmentsPage showToast={showToast} />} />
            <Route path="/reconciliation" element={<ReconciliationPage showToast={showToast} />} />
            <Route path="/inventory" element={<InventoryPage showToast={showToast} />} />
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
