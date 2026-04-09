import { describe, it, expect, beforeEach } from 'vitest'

describe('session token storage persistence', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
  })

  it('getHomeserverUrl reads from localStorage', async () => {
    // Simulate the behavior — session stored in localStorage
    localStorage.setItem('matrix_session', JSON.stringify({
      accessToken: 'test-token',
      userId: '@test:server',
      deviceId: 'DEVICE1',
      homeserverUrl: 'https://matrix.example.com',
    }))

    // Import the function dynamically to ensure it uses the mocked storage
    const { getHomeserverUrl } = await import('@/lib/matrix/client')
    expect(getHomeserverUrl()).toBe('https://matrix.example.com')
  })

  it('does not read from sessionStorage for session data', async () => {
    // Put session data in sessionStorage (old behavior) — should NOT be found
    sessionStorage.setItem('matrix_session', JSON.stringify({
      accessToken: 'old-token',
      userId: '@old:server',
      deviceId: 'OLD_DEVICE',
      homeserverUrl: 'https://old.example.com',
    }))

    const { getHomeserverUrl } = await import('@/lib/matrix/client')
    // Since localStorage is empty, should return null
    expect(getHomeserverUrl()).toBeNull()
  })
})
