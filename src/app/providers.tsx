"use client"
import { Suspense, type ReactNode } from 'react'
import { ThemeProvider } from '../ui/lib/theme'
import { AuthProvider } from '../ui/lib/auth'
import { CartProvider } from '../ui/lib/cart'
import { CurrencyProvider } from '../ui/lib/currency'
import { PublicMotion } from '../ui/components/PublicMotion'
export function Providers({children}:{children:ReactNode}) { return <ThemeProvider><Suspense><AuthProvider><CartProvider><CurrencyProvider><PublicMotion />{children}</CurrencyProvider></CartProvider></AuthProvider></Suspense></ThemeProvider> }
