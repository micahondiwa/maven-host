import { Moon, Sun } from 'lucide-react'
import { useTheme } from '../lib/theme'

export function ThemeToggle({ onDark = false }: { onDark?: boolean }) {
  const { theme, toggleTheme } = useTheme()
  const label = `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`
  return <button type="button" onClick={toggleTheme} aria-label={label} title={label}
    aria-pressed={theme === 'dark'} data-theme-toggle
    className={`grid size-7 shrink-0 place-items-center rounded-md border transition ${onDark ? 'border-white/25 text-white/85 hover:bg-white/10 hover:text-maven-bright' : 'border-maven-line text-maven-ink hover:bg-maven-signal/10'}`}>
    {theme === 'dark' ? <Sun className="size-4" aria-hidden="true" /> : <Moon className="size-4" aria-hidden="true" />}
  </button>
}
