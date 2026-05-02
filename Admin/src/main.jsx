import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { CssBaseline } from '@mui/material'
import { ThemeProvider, createTheme, alpha } from '@mui/material/styles'
import './index.css'
import App from './App.jsx'

const adminTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#7ce7ff',
      contrastText: '#07111b',
    },
    secondary: {
      main: '#ffb86b',
    },
    background: {
      default: '#060b14',
      paper: '#0d1522',
    },
    text: {
      primary: '#edf4ff',
      secondary: '#8fa3bf',
    },
    divider: alpha('#d6e0f0', 0.12),
  },
  shape: {
    borderRadius: 16,
  },
  typography: {
    fontFamily: 'Inter, Segoe UI, system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
    h5: { fontWeight: 700 },
    h6: { fontWeight: 700 },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: '#060b14',
          backgroundImage: 'radial-gradient(circle at top left, rgba(124,231,255,0.08), transparent 28%), radial-gradient(circle at top right, rgba(255,184,107,0.06), transparent 22%), linear-gradient(180deg, #08101c 0%, #060b14 45%, #050910 100%)',
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          background: 'rgba(8, 13, 22, 0.86)',
          backdropFilter: 'blur(18px)',
          borderBottom: '1px solid rgba(148, 163, 184, 0.15)',
          boxShadow: 'none',
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          background: 'linear-gradient(180deg, rgba(10,16,27,0.98), rgba(6,10,18,0.98))',
          borderRight: '1px solid rgba(148, 163, 184, 0.12)',
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          border: '1px solid rgba(148, 163, 184, 0.12)',
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          border: '1px solid rgba(148, 163, 184, 0.12)',
          boxShadow: '0 12px 30px rgba(0, 0, 0, 0.22)',
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          borderBottom: '1px solid rgba(148, 163, 184, 0.12)',
        },
        head: {
          color: '#9fb4d1',
          fontWeight: 700,
          textTransform: 'uppercase',
          fontSize: '0.72rem',
          letterSpacing: '0.08em',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 999,
          textTransform: 'none',
          fontWeight: 700,
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 999,
          fontWeight: 700,
        },
      },
    },
  },
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider theme={adminTheme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  </StrictMode>,
)
