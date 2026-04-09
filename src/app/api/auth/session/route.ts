import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const { accessToken } = await request.json()
  if (!accessToken || typeof accessToken !== 'string') {
    return NextResponse.json({ error: 'Missing access token' }, { status: 400 })
  }
  const response = NextResponse.json({ ok: true })
  response.cookies.set('matrix_token', accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/Messages',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  })
  return response
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true })
  response.cookies.delete({ name: 'matrix_token', path: '/Messages' })
  return response
}
