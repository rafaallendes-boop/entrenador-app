import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'cl.rallyiq.app',
  appName: 'RallyIQ',
  webDir: 'dist',
  backgroundColor: '#0e0e0e',
  loggingBehavior: 'debug',
  ios: {
    contentInset: 'never',
    preferredContentMode: 'mobile',
    allowsLinkPreview: false,
    handleApplicationNotifications: true,
  },
  plugins: {
    Keyboard: {
      resize: 'native',
      style: 'DARK',
      autoBackdropColor: 'auto',
    },
    LocalNotifications: {
      presentationOptions: ['sound', 'banner', 'list'],
    },
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: '#0e0e0e',
      showSpinner: false,
    },
    StatusBar: {
      overlaysWebView: false,
      style: 'DARK',
      backgroundColor: '#0e0e0e',
    },
  },
}

export default config
