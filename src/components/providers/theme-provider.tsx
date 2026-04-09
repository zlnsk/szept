'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

type Theme = 'dark' | 'light'

interface ThemeContextType {
  theme: Theme
  toggleTheme: () => void
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'dark',
  toggleTheme: () => {},
  setTheme: () => {},
})

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'))
  return match ? decodeURIComponent(match[2]) : null
}

function setCookie(name: string, value: string, days: number = 365) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString()
  document.cookie = `${name}=${encodeURIComponent(value)};expires=${expires};path=/;SameSite=Lax;Secure`
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('dark')

  useEffect(() => {
    // Read from cookie first, fall back to localStorage for migration
    const fromCookie = getCookie('matrix-theme') as Theme | null
    const fromStorage = localStorage.getItem('matrix-theme') as Theme | null
    const saved = fromCookie || fromStorage

    if (saved) {
      setThemeState(saved)
      document.documentElement.classList.toggle('dark', saved === 'dark')
      document.documentElement.classList.toggle('light', saved === 'light')
      // Migrate localStorage to cookie
      if (!fromCookie && fromStorage) {
        setCookie('matrix-theme', fromStorage)
      }
    } else {
      document.documentElement.classList.add('dark')
    }
  }, [])

  const setTheme = (t: Theme) => {
    setThemeState(t)
    setCookie('matrix-theme', t)
    localStorage.setItem('matrix-theme', t) // keep localStorage as backup
    document.documentElement.classList.toggle('dark', t === 'dark')
    document.documentElement.classList.toggle('light', t === 'light')
  }

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => useContext(ThemeContext)
