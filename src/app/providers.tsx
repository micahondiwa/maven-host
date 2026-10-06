"use client"
import { Suspense, type ReactNode } from 'react'
import { ThemeProvider } from '../ui/lib/theme'
import { AuthProvider } from '../ui/lib/auth'
import { CartProvider } from '../ui/lib/cart'
import { PublicMotion } from '../ui/components/PublicMotion'
export function Providers({children}:{children:ReactNode}) { return <ThemeProvider><Suspense><AuthProvider><CartProvider><PublicMotion />{children}</CartProvider></AuthProvider></Suspense></ThemeProvider> }
