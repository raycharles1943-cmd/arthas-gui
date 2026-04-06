import { useState, useEffect } from 'react'

export function usePersistentState<T>(key: string, initialState: T): [T, (val: T) => void] {
  const [state, setState] = useState<T>(() => {
    const saved = localStorage.getItem(key)
    if (saved !== null) {
      try {
        return JSON.parse(saved)
      } catch (e) {
        return initialState
      }
    }
    return initialState
  })

  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(state))
  }, [key, state])

  return [state, setState]
}
