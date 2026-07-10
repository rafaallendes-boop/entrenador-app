import { Capacitor } from '@capacitor/core'

export type AppPlatform = 'ios' | 'android' | 'web'

export function getAppPlatform(): AppPlatform {
  return Capacitor.getPlatform() as AppPlatform
}

export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform()
}

export function isIOSPlatform(): boolean {
  return isNativePlatform() && getAppPlatform() === 'ios'
}

export function isWebPlatform(): boolean {
  return !isNativePlatform()
}
