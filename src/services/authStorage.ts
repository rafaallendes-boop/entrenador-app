import { Preferences } from '@capacitor/preferences'
import type { SupportedStorage } from '@supabase/supabase-js'
import { isNativePlatform } from './platform'

export interface AuthStorage extends SupportedStorage {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
}

interface AuthStorageBackends {
  native: AuthStorage
  web: AuthStorage
}

const nativePreferencesStorage: AuthStorage = {
  async getItem(key) {
    const { value } = await Preferences.get({ key })
    return value
  },
  async setItem(key, value) {
    await Preferences.set({ key, value })
  },
  async removeItem(key) {
    await Preferences.remove({ key })
  },
}

const webLocalStorage: AuthStorage = {
  async getItem(key) {
    return globalThis.localStorage?.getItem(key) ?? null
  },
  async setItem(key, value) {
    globalThis.localStorage?.setItem(key, value)
  },
  async removeItem(key) {
    globalThis.localStorage?.removeItem(key)
  },
}

export function createAuthStorage(
  native = isNativePlatform(),
  backends: AuthStorageBackends = { native: nativePreferencesStorage, web: webLocalStorage },
): AuthStorage {
  return native ? backends.native : backends.web
}

export const authStorage = createAuthStorage()
