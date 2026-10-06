import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { getCart, type CartSummary } from './api'
import { useAuth } from './auth'

type CartContextValue = {
  cart: CartSummary | null
  itemCount: number
  loading: boolean
  refresh: () => Promise<void>
  clearLocal: () => void
}

const CartContext = createContext<CartContextValue | null>(null)

export function CartProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [cart, setCart] = useState<CartSummary | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setCart(await getCart())
    } catch {
      setCart(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh, user?.id])

  const clearLocal = useCallback(() => setCart(null), [])

  const itemCount = useMemo(() => cart?.items.reduce((total, item) => total + item.quantity, 0) ?? 0, [cart])

  const value = useMemo<CartContextValue>(
    () => ({ cart, itemCount, loading, refresh, clearLocal }),
    [cart, itemCount, loading, refresh, clearLocal],
  )

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart(): CartContextValue {
  const context = useContext(CartContext)
  if (!context) throw new Error('useCart must be used within a CartProvider')
  return context
}
