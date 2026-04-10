import { headers } from "next/headers"
import { NextResponse } from "next/server"

export async function GET() {
  const h = await headers()
  const email = h.get("remote-email") || h.get("x-forwarded-user") || null
  return NextResponse.json({ email })
}
