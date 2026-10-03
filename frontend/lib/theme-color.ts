/**
 * The colour of the system bars around the app — the iOS status bar of the home-screen app, the
 * Android address bar — per colour scheme. It is the page's own `--background` (globals.css,
 * converted from oklch), so the strip above the first row reads as part of the page.
 *
 * Why it matters on iOS: the installed app's web view sits BELOW the status bar (iOS 26.1 no
 * longer honours `black-translucent`, KP Front measured that), and iOS paints the strip with the
 * page's theme-color. Without one it shows the content under the top edge frosted — the
 * «blurred top few pixels» the owner saw on 03.10.
 */
export const THEME_COLOR = {
  light: '#fbfaf9', // --background: oklch(0.985 0.002 60)
  dark: '#101316', // .dark --background: oklch(0.185 0.008 250)
} as const

/**
 * Point every `<meta name="theme-color">` at the scheme the app actually shows. The static pair
 * (root layout `viewport`) follows the SYSTEM scheme; a user who picked «Dunkel» on a light phone
 * needs the meta rewritten, or the status bar stays white over a dark page.
 */
export function applyThemeColor(scheme: 'light' | 'dark') {
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.setAttribute('content', THEME_COLOR[scheme])
  }
}
