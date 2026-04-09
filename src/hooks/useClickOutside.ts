import { useEffect, type RefObject } from 'react'

/**
 * Calls onClose when a mousedown occurs outside the given ref element.
 * The listener is only active when `active` is true.
 */
export function useClickOutside(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  active: boolean,
) {
  useEffect(() => {
    if (!active) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [ref, onClose, active])
}
