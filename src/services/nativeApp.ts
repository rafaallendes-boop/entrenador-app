import { App as CapacitorApp } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { Keyboard, KeyboardResize } from '@capacitor/keyboard'
import { LocalNotifications } from '@capacitor/local-notifications'
import { SplashScreen } from '@capacitor/splash-screen'
import { StatusBar, Style } from '@capacitor/status-bar'
import { processAuthDeepLink } from './authDeepLinks'
import { isIOSPlatform, isNativePlatform } from './platform'

export const NATIVE_NAVIGATE_EVENT = 'rallyiq:native-navigate'
export const NATIVE_RESUME_EVENT = 'rallyiq:native-resume'
export const NATIVE_BACKGROUND_EVENT = 'rallyiq:native-background'
export const NATIVE_AUTH_ERROR_EVENT = 'rallyiq:native-auth-error'

let initialized = false

export async function initializeNativeApp(): Promise<void> {
  if (!isNativePlatform() || initialized) return
  initialized = true

  if (isIOSPlatform()) {
    await Promise.allSettled([
      StatusBar.setOverlaysWebView({ overlay: false }),
      StatusBar.setStyle({ style: Style.Dark }),
      Keyboard.setResizeMode({ mode: KeyboardResize.Native }),
    ])
  }

  await CapacitorApp.addListener('appUrlOpen', ({ url }) => {
    void handleNativeUrl(url)
  })

  await CapacitorApp.addListener('appStateChange', ({ isActive }) => {
    window.dispatchEvent(new Event(isActive ? NATIVE_RESUME_EVENT : NATIVE_BACKGROUND_EVENT))
  })

  await LocalNotifications.addListener('localNotificationActionPerformed', ({ notification }) => {
    const url = notification.extra?.url
    if (typeof url === 'string' && url.startsWith('/')) dispatchNativeNavigation(url)
  })

  document.addEventListener('click', handleExternalAnchorClick, true)

  const launch = await CapacitorApp.getLaunchUrl().catch(() => undefined)
  if (launch?.url) await handleNativeUrl(launch.url)

  await SplashScreen.hide({ fadeOutDuration: 180 }).catch(() => undefined)
}

async function handleNativeUrl(url: string): Promise<void> {
  const result = await processAuthDeepLink(url)
  if (result.error) {
    window.dispatchEvent(new CustomEvent(NATIVE_AUTH_ERROR_EVENT, { detail: result.error }))
    await Browser.close().catch(() => undefined)
    return
  }
  if (result.navigateTo) dispatchNativeNavigation(result.navigateTo)
}

function dispatchNativeNavigation(path: string): void {
  window.dispatchEvent(new CustomEvent(NATIVE_NAVIGATE_EVENT, { detail: path }))
}

function handleExternalAnchorClick(event: MouseEvent): void {
  const target = event.target
  if (!(target instanceof Element)) return
  const anchor = target.closest('a[href]')
  if (!(anchor instanceof HTMLAnchorElement)) return

  const url = new URL(anchor.href)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return
  event.preventDefault()
  void Browser.open({ url: url.toString(), presentationStyle: 'popover' })
}
