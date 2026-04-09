/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest'
import {
  getClearContent,
  getEventStatus,
  getUnreadNotificationCount,
  getReactionIndex,
  setReactionIndex,
  getAccountDataContent,
  sendEvent,
  sendStateEvent,
  clearTurnServerPolling,
} from '@/lib/matrix/sdk-compat'

describe('sdk-compat typed wrappers', () => {
  describe('getClearContent', () => {
    it('returns decrypted content when getClearContent exists', () => {
      const event = { getClearContent: () => ({ msgtype: 'm.text', body: 'hello' }) }
      expect(getClearContent(event as any)).toEqual({ msgtype: 'm.text', body: 'hello' })
    })

    it('returns null when getClearContent does not exist', () => {
      const event = {}
      expect(getClearContent(event as any)).toBeNull()
    })

    it('returns null when getClearContent returns null', () => {
      const event = { getClearContent: () => null }
      expect(getClearContent(event as any)).toBeNull()
    })
  })

  describe('getEventStatus', () => {
    it('returns the event status string', () => {
      const event = { status: 'sending' }
      expect(getEventStatus(event as any)).toBe('sending')
    })

    it('returns null when no status', () => {
      const event = { status: null }
      expect(getEventStatus(event as any)).toBeNull()
    })
  })

  describe('getUnreadNotificationCount', () => {
    it('returns count from room', () => {
      const room = { getUnreadNotificationCount: (type: string) => type === 'total' ? 5 : 0 }
      expect(getUnreadNotificationCount(room as any)).toBe(5)
    })

    it('returns 0 when method returns falsy', () => {
      const room = { getUnreadNotificationCount: () => 0 }
      expect(getUnreadNotificationCount(room as any)).toBe(0)
    })
  })

  describe('getReactionIndex / setReactionIndex', () => {
    it('round-trips a reaction index', () => {
      const room = {} as any
      expect(getReactionIndex(room)).toBeUndefined()

      const index = new Map([['$evt1', new Map([['👍', { count: 1, users: ['@a:b'], includesMe: false }]])]])
      setReactionIndex(room, index)
      expect(getReactionIndex(room)).toBe(index)
    })
  })

  describe('getAccountDataContent', () => {
    it('returns content from account data event', () => {
      const client = {
        getAccountData: (type: string) => ({
          getContent: () => ({ '@user:server': ['!room1'] }),
        }),
      }
      expect(getAccountDataContent(client as any, 'm.direct')).toEqual({ '@user:server': ['!room1'] })
    })

    it('returns empty object when no account data', () => {
      const client = { getAccountData: () => null }
      expect(getAccountDataContent(client as any, 'm.direct')).toEqual({})
    })
  })

  describe('sendEvent', () => {
    it('calls sendEvent on client with correct args', async () => {
      const fn = vi.fn().mockResolvedValue({ event_id: '$new' })
      const client = { sendEvent: fn }
      const content = { msgtype: 'm.text', body: 'test' }
      await sendEvent(client as any, '!room:srv', 'm.room.message', content)
      expect(fn).toHaveBeenCalledWith('!room:srv', 'm.room.message', content)
    })
  })

  describe('sendStateEvent', () => {
    it('calls sendStateEvent with default stateKey', async () => {
      const fn = vi.fn().mockResolvedValue({})
      const client = { sendStateEvent: fn }
      await sendStateEvent(client as any, '!room:srv', 'm.room.encryption', { algorithm: 'x' })
      expect(fn).toHaveBeenCalledWith('!room:srv', 'm.room.encryption', { algorithm: 'x' }, '')
    })
  })

  describe('clearTurnServerPolling', () => {
    it('clears and unsets the interval ID', () => {
      const intervalId = setInterval(() => {}, 99999)
      const client = { checkTurnServersIntervalID: intervalId } as any
      clearTurnServerPolling(client)
      expect(client.checkTurnServersIntervalID).toBeUndefined()
    })

    it('does nothing when no interval set', () => {
      const client = {} as any
      clearTurnServerPolling(client)
      expect(client.checkTurnServersIntervalID).toBeUndefined()
    })
  })
})
