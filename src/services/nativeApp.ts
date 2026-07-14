import { App as CapacitorApp } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { Keyboard, KeyboardResize } from '@capacitor/keyboard'
import { LocalNotifications } from '@capacitor/local-notifications'
import { SplashScreen } from '@capacitor/splash-screen'
import { StatusBar, Style } from '@capacitor/status-bar'
import { processAuthDeepLink } from './authDeepLinks'
import { scrollFocusedControlIntoView } from './keyboardFocus'
import { isIOSPlatform, isNativePlatform } from './platform'
import { getWhoopCallbackPath } from './nativeDeepLinks'

export const NATIVE_NAVIGATE_EVENT = 'rallyiq:native-navigate'
export const NATIVE_RESUME_EVENT = 'rallyiq:native-resume'
export const NATIVE_BACKGROUND_EVENT = 'rallyiq:native-background'
export const NATIVE_AUTH_ERROR_EVENT = 'rallyiq:native-auth-error'

let initialized = false
let pendingNavigation: string | null = null

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

  // didShow, not willShow: the webview has already been resized by then, so the
  // scroll lands against the final viewport instead of the pre-keyboard one.
  await Keyboard.addListener('keyboardDidShow', () => {
    scrollFocusedControlIntoView()
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
  const whoopPath = getWhoopCallbackPath(url)
  if (whoopPath) {
    dispatchNativeNavigation(whoopPath)
    await Browser.close().catch(() => undefined)
    return
  }

  const result = await processAuthDeepLink(url)
  if (result.error) {
    window.dispatchEvent(new CustomEvent(NATIVE_AUTH_ERROR_EVENT, { detail: result.error }))
    await Browser.close().catch(() => undefined)
    return
  }
  if (result.navigateTo) dispatchNativeNavigation(result.navigateTo)
}

export function dispatchNativeNavigation(path: string): void {
  // A cold launch can receive its URL before NativeBridge mounts. Keep the
  // latest safe internal path so the bridge can consume it after React starts.
  pendingNavigation = path
  window.dispatchEvent(new CustomEvent(NATIVE_NAVIGATE_EVENT, { detail: path }))
}

export function consumePendingNativeNavigation(): string | null {
  const path = pendingNavigation
  pendingNavigation = null
  return path
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
