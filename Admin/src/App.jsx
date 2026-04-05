import * as React from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import { AppBar, Toolbar, Typography, Drawer, List, ListItem, ListItemText, CssBaseline, Box, Container } from '@mui/material';
import { useEffect, useState } from 'react';
import { DataGrid } from '@mui/x-data-grid';
import { fetchUsers } from './api/users';

const drawerWidth = 220;

function Dashboard() {
  return <h2>Dashboard</h2>;
}
function Users() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetchUsers().then(data => {
      setRows(data.users || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);
  const columns = [
    { field: '_id', headerName: 'ID', width: 220 },
    { field: 'name', headerName: 'Name', width: 150 },
    { field: 'email', headerName: 'Email', width: 200 },
    { field: 'isAdmin', headerName: 'Admin', width: 100, type: 'boolean' },
  ];
  return (
    <div style={{ height: 400, width: '100%' }}>
      <DataGrid rows={rows} columns={columns} getRowId={row => row._id} loading={loading} />
    </div>
  );
}
import { loginAdmin } from './api/auth';
import { useNavigate } from 'react-router-dom';
function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await loginAdmin(email, password);
      localStorage.setItem('token', res.token);
      setLoading(false);
      navigate('/');
    } catch (err) {
      setError(err?.response?.data?.message || 'Login failed');
      setLoading(false);
    }
  };

  return (
    <Box display="flex" flexDirection="column" alignItems="center" justifyContent="center" minHeight="60vh">
      <Typography variant="h5" mb={2}>Admin Login</Typography>
      <Box component="form" sx={{ width: 300 }} onSubmit={handleSubmit}>
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" style={{ width: '100%', marginBottom: 12, padding: 8 }} required />
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" style={{ width: '100%', marginBottom: 12, padding: 8 }} required />
        <button type="submit" style={{ width: '100%', padding: 10, background: '#aa3bff', color: '#fff', border: 'none', borderRadius: 4 }} disabled={loading}>{loading ? 'Logging in...' : 'Login'}</button>
        {error && <Typography color="error" mt={1}>{error}</Typography>}
      </Box>
    </Box>
  );
}
function Products() {
  return <h2>Products</h2>;
}
function Orders() {
  return <h2>Orders</h2>;
}

const navItems = [
  { text: 'Dashboard', path: '/' },
  { text: 'Users', path: '/users' },
  { text: 'Products', path: '/products' },
  { text: 'Orders', path: '/orders' },
];

export default function App() {
  return (
    <Router>
      <Box sx={{ display: 'flex' }}>
        <CssBaseline />
        <AppBar position="fixed" sx={{ zIndex: (theme) => theme.zIndex.drawer + 1 }}>
          <Toolbar>
            <Typography variant="h6" noWrap component="div">
              HANDKRAFT Admin
            </Typography>
          </Toolbar>
        </AppBar>
        <Drawer
          variant="permanent"
          sx={{
            width: drawerWidth,
            flexShrink: 0,
            [`& .MuiDrawer-paper`]: { width: drawerWidth, boxSizing: 'border-box' },
          }}
        >
          <Toolbar />
          <Box sx={{ overflow: 'auto' }}>
            <List>
              {navItems.map((item) => (
                <ListItem button key={item.text} component={Link} to={item.path}>
                  <ListItemText primary={item.text} />
                </ListItem>
              ))}
            </List>
          </Box>
        </Drawer>
        <Box component="main" sx={{ flexGrow: 1, bgcolor: 'background.default', p: 3 }}>
          <Toolbar />
          <Container maxWidth="lg">
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/" element={<Dashboard />} />
              <Route path="/users" element={<Users />} />
              <Route path="/products" element={<Products />} />
              <Route path="/orders" element={<Orders />} />
            </Routes>
          </Container>
        </Box>
      </Box>
    </Router>
  );
}