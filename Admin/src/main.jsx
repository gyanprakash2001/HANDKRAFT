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
      main: '#38bdf8',
      contrastText: '#071015',
    },
    secondary: {
      main: '#f59e0b',
    },
    background: {
      default: '#0b0d10',
      paper: '#11151b',
    },
    text: {
      primary: '#f3f6fb',
      secondary: '#9aa5b1',
    },
    divider: alpha('#d6e0f0', 0.12),
  },
  shape: {
    borderRadius: 8,
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
          backgroundColor: '#0b0d10',
          backgroundImage: 'linear-gradient(180deg, #10141a 0%, #0b0d10 48%, #090b0e 100%)',
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          background: 'rgba(13, 16, 21, 0.92)',
          backdropFilter: 'blur(18px)',
          borderBottom: '1px solid rgba(176, 186, 201, 0.14)',
          boxShadow: 'none',
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          background: '#0d1015',
          borderRight: '1px solid rgba(176, 186, 201, 0.12)',
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
          letterSpacing: 0,
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          textTransform: 'none',
          fontWeight: 700,
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 6,
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
