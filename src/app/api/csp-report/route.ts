import { NextRequest, NextResponse } from 'next/server'

// In-memory rate limit for CSP reports (prevent flooding)
const reportCounts = new Map<string, { count: number; windowStart: number }>()
const REPORT_WINDOW_MS = 60_000
const MAX_REPORTS_PER_WINDOW = 20

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'unknown'

  const now = Date.now()
  const entry = reportCounts.get(ip)
  if (entry && now - entry.windowStart < REPORT_WINDOW_MS) {
    entry.count++
    if (entry.count > MAX_REPORTS_PER_WINDOW) {
      return new NextResponse(null, { status: 429 })
    }
  } else {
    reportCounts.set(ip, { count: 1, windowStart: now })
  }

  // Lazy cleanup every 5 min
  if (reportCounts.size > 1000) {
    for (const [k, v] of reportCounts) {
      if (now - v.windowStart > REPORT_WINDOW_MS * 2) reportCounts.delete(k)
    }
  }

  try {
    const body = await request.json()
    const report = body['csp-report'] || body
    console.warn('[CSP Violation]', {
      documentUri: report['document-uri'],
      blockedUri: report['blocked-uri'],
      violatedDirective: report['violated-directive'],
      effectiveDirective: report['effective-directive'],
      originalPolicy: report['original-policy']?.slice(0, 200),
      sourceFile: report['source-file'],
      lineNumber: report['line-number'],
      timestamp: new Date().toISOString(),
      ip,
    })
  } catch {
    // Malformed report — ignore
  }

  return new NextResponse(null, { status: 204 })
}
