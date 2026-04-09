/**
 * SSRF protection utilities shared between API routes.
 * Validates hostnames to prevent requests to private/internal networks.
 */

/**
 * Trusted homeserver hosts that bypass the DNS-based SSRF check.
 * Set via TRUSTED_HOMESERVER_HOSTS env var (comma-separated hostnames).
 * These hosts are still checked against the static private-host list,
 * but DNS resolution results are not validated — this allows homeservers
 * that resolve to CGNAT/Tailscale IPs to work correctly.
 */
const TRUSTED_HOSTS: ReadonlySet<string> = new Set(
  (process.env.TRUSTED_HOMESERVER_HOSTS ?? '')
    .split(',')
    .map(h => h.trim().toLowerCase())
    .filter(Boolean)
)

export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '') // strip IPv6 brackets
  return (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '0.0.0.0' ||
    h === '::1' ||
    h === '[::1]' ||
    h === '::' ||
    h.startsWith('10.') ||
    h.startsWith('192.168.') ||
    (h.startsWith('172.') && (() => { const parts = h.split('.'); if (parts.length < 2) return false; const b = parseInt(parts[1], 10); return !isNaN(b) && b >= 16 && b <= 31 })()) ||
    h.startsWith('169.254.') ||
    // CGNAT / Shared Address Space (RFC 6598) — common in cloud environments (e.g. Tailscale)
    (h.startsWith('100.') && (() => { const parts = h.split('.'); if (parts.length < 2) return false; const b = parseInt(parts[1], 10); return !isNaN(b) && b >= 64 && b <= 127 })()) ||
    // Benchmark testing (RFC 2544)
    (h.startsWith('198.') && (() => { const parts = h.split('.'); if (parts.length < 2) return false; const b = parseInt(parts[1], 10); return !isNaN(b) && b >= 18 && b <= 19 })()) ||
    h.startsWith('0.') ||
    h.startsWith('fc00:') || /^fd[0-9a-f]{2}:/.test(h) || // IPv6 ULA (fc00::/7)
    h.startsWith('fe80:') || // IPv6 link-local
    h.startsWith('::ffff:10.') || h.startsWith('::ffff:192.168.') || h.startsWith('::ffff:127.') || // IPv4-mapped IPv6
    h.endsWith('.local') ||
    h.endsWith('.internal') ||
    /^\d+$/.test(h) // decimal IP encoding (e.g. 2130706433 = 127.0.0.1)
  )
}


/**
 * Async SSRF check that also resolves the hostname via DNS to catch
 * DNS rebinding attacks (e.g. attacker domain resolving to 127.0.0.1).
 * Fails closed: if DNS resolution fails, the host is treated as private.
 *
 * Trusted homeserver hosts (TRUSTED_HOMESERVER_HOSTS env var) skip the
 * DNS resolution check — they may legitimately resolve to CGNAT/Tailscale
 * IPs that would otherwise be blocked.
 */
export async function isPrivateHostResolved(hostname: string): Promise<boolean> {
  // First check the hostname string itself
  if (isPrivateHost(hostname)) return true

  // Trusted hosts skip DNS resolution check — they are explicitly allowed
  // even if they resolve to private/CGNAT IPs (e.g. Tailscale)
  if (TRUSTED_HOSTS.has(hostname.toLowerCase())) return false

  // Then resolve DNS and check actual IP addresses (both IPv4 and IPv6)
  try {
    const dns = await import('dns/promises')

    // Resolve both IPv4 and IPv6 in parallel
    const [v4Addresses, v6Addresses] = await Promise.all([
      dns.resolve4(hostname).catch(() => [] as string[]),
      dns.resolve6(hostname).catch(() => [] as string[]),
    ])

    // Fail closed: if no records at all, treat as private
    if (v4Addresses.length === 0 && v6Addresses.length === 0) return true

    // Block if any resolved address is private
    const allAddresses = [...v4Addresses, ...v6Addresses]
    return allAddresses.some(ip => isPrivateHost(ip))
  } catch {
    return true // fail closed — treat unresolvable hosts as private
  }
}
