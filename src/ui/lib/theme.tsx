import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

type Theme = 'light' | 'dark'
const KEY = 'mavenhost-theme'
const ThemeContext = createContext<{ theme: Theme; toggleTheme: () => void } | null>(null)

function savedTheme(): Theme | null {
  try { const value = localStorage.getItem(KEY); return value === 'light' || value === 'dark' ? value : null }
  catch { return null }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<Theme | null>(null)
  const theme = preference ?? 'dark'
  useEffect(() => { setPreference(savedTheme()) }, [])
  useEffect(() => {
    const sync = (event: StorageEvent) => { if (event.key === KEY || event.key === null) setPreference(savedTheme()) }
    window.addEventListener('storage', sync)
    return () => { window.removeEventListener('storage', sync) }
  }, [])
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
  }, [theme])
  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    setPreference(next)
    try { localStorage.setItem(KEY, next) } catch { /* Mode still works when storage is unavailable. */ }
  }
  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used within ThemeProvider')
  return context
}
