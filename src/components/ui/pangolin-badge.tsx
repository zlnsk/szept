'use client'

import { useEffect, useState } from 'react'
import { Shield } from 'lucide-react'

export function PangolinBadge() {
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    fetch('/Messages/api/pangolin-user')
      .then(r => r.json())
      .then(d => { if (d.email) setEmail(d.email) })
      .catch(() => {})
  }, [])

  if (!email) return null

  return (
    <div className="flex items-center gap-1.5 rounded-full bg-m3-surface-container px-2.5 py-1 text-[11px] text-m3-on-surface-variant">
      <Shield className="h-3 w-3 flex-shrink-0 text-m3-primary" />
      <span className="truncate">Pangolin: {email}</span>
    </div>
  )
}
