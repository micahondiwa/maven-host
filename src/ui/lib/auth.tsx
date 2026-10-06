import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { clearTokens, fetchCurrentUser, login as apiLogin, logout as apiLogout, type CurrentUser } from './api'

type AuthContextValue = {
  user: CurrentUser | null
  loading: boolean
  isStaff: boolean
  hasPermission: (permission: string) => boolean
  signIn: (email: string, password: string) => Promise<CurrentUser>
  signOut: () => Promise<void>
  refresh: () => Promise<void>
  completeSocialSignIn: () => Promise<CurrentUser>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [loading, setLoading] = useState(true)

  const loadUser = useCallback(async () => {
    try {
      const current = await fetchCurrentUser()
      setUser(current)
    } catch {
      clearTokens()
      setUser(null)
    }
  }, [])

  useEffect(() => {
    const hasSession = Boolean(localStorage.getItem('mwh_access'))
    if (!hasSession) {
      setLoading(false)
      return
    }
    loadUser().finally(() => setLoading(false))
  }, [loadUser])

  const signIn = useCallback(async (email: string, password: string) => {
    const current = await apiLogin(email, password)
    setUser(current)
    return current
  }, [])

  const completeSocialSignIn = useCallback(async () => {
    try {
      const current = await fetchCurrentUser()
      setUser(current)
      return current
    } catch (error) {
      clearTokens()
      setUser(null)
      throw error
    }
  }, [])

  const signOut = useCallback(async () => {
    try {
      await apiLogout()
    } finally {
      setUser(null)
    }
  }, [])

  const hasPermission = useCallback(
    (permission: string) => Boolean(user?.permissions?.includes(permission)),
    [user],
  )

  const isStaff = user?.account_type === 'staff' || user?.account_type === 'admin'

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, isStaff, hasPermission, signIn, signOut, refresh: loadUser, completeSocialSignIn }),
    [user, loading, isStaff, hasPermission, signIn, signOut, loadUser, completeSocialSignIn],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within an AuthProvider')
  return context
}
