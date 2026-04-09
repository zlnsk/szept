/**
 * Shared LRU profile avatar cache.
 *
 * Extracted into its own module to avoid circular dependencies between
 * client.ts and chat-store.ts — both need to read/write this cache.
 *
 * Keyed by userId → MXC URL. Empty string = "fetched but no avatar" (negative cache).
 */
const PROFILE_CACHE_MAX = 2000
const profileAvatarCache = new Map<string, string>()

// Batch LRU promotions to avoid mutating during React render
let pendingPromotions: string[] = []
let promotionScheduled = false

function schedulePromotions(): void {
  if (promotionScheduled) return
  promotionScheduled = true
  const schedule = typeof requestIdleCallback === 'function' ? requestIdleCallback : (cb: () => void) => setTimeout(cb, 0)
  schedule(() => {
    promotionScheduled = false
    const batch = pendingPromotions
    pendingPromotions = []
    for (const userId of batch) {
      const value = profileAvatarCache.get(userId)
      if (value !== undefined) {
        profileAvatarCache.delete(userId)
        profileAvatarCache.set(userId, value)
      }
    }
  })
}

/** Write to profile cache with LRU eviction. */
export function setProfileCache(userId: string, value: string): void {
  if (profileAvatarCache.has(userId)) {
    profileAvatarCache.delete(userId)
  }
  profileAvatarCache.set(userId, value)
  if (profileAvatarCache.size > PROFILE_CACHE_MAX) {
    const first = profileAvatarCache.keys().next()
    if (!first.done) profileAvatarCache.delete(first.value)
  }
}

/**
 * Read from profile cache.
 * Schedules deferred LRU promotion to avoid mutating state during
 * React render cycles (which causes infinite re-render loops — error #185).
 */
export function getProfileCache(userId: string): string | undefined {
  const value = profileAvatarCache.get(userId)
  if (value !== undefined && pendingPromotions.length < 1000) {
    pendingPromotions.push(userId)
    schedulePromotions()
  }
  return value
}

/** Check if a userId exists in the cache (without promoting). */
export function hasProfileCache(userId: string): boolean {
  return profileAvatarCache.has(userId)
}

/** Clear the entire cache (used on logout). */
export function clearProfileCache(): void {
  profileAvatarCache.clear()
  pendingPromotions = []
}
