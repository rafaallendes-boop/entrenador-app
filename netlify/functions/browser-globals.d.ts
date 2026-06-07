interface Storage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

interface Window {
  localStorage: Storage
}

interface Navigator {
  onLine?: boolean
}

declare const window: Window | undefined
