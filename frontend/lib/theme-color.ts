/**
 * The colour of the system bars around the app — the iOS status bar of the home-screen app, the
 * Android address bar — per colour scheme. It is the page's own `--background` (globals.css,
 * converted from oklch), so the strip above the first row reads as part of the page.
 *
 * Why it matters on iOS: the installed app's web view sits BELOW the status bar (iOS 26.1 no
 * longer honours `black-translucent`, KP Front measured that), and iOS paints the strip with the
 * page's theme-color.
 */
export const THEME_COLOR = {
  light: '#fbfaf9', // --background: oklch(0.985 0.002 60)
  dark: '#101316', // .dark --background: oklch(0.185 0.008 250)
} as const

/**
 * Point the `<meta name="theme-color">` (there is exactly one, root layout) at the scheme the app
 * actually shows: the in-app «Hell / Dunkel / System» switch, or the phone's scheme under
 * «System». The boot script in the root layout does the same before first paint.
 */
export function applyThemeColor(scheme: 'light' | 'dark') {
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.setAttribute('content', THEME_COLOR[scheme])
  }
}
