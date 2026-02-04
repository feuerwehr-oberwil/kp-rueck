import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import { ThemeProvider } from '@/components/theme-provider'
import { AuthProvider } from '@/lib/contexts/auth-context'
import { EventProvider } from '@/lib/contexts/event-context'
import { PersonnelProvider } from '@/lib/contexts/personnel-context'
import { MaterialsProvider } from '@/lib/contexts/materials-context'
import { OperationsProvider } from '@/lib/contexts/operations-context'
import { NotificationProvider } from '@/lib/contexts/notification-context'
import { CommandPaletteProvider } from '@/lib/contexts/command-palette-context'
import { NotificationToasts } from '@/components/notifications/notification-toasts'
import { PersistentNotificationSidebar } from '@/components/notifications/persistent-notification-sidebar'
import { AppShell } from '@/components/app-shell'

const geistSans = Geist({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-geist-sans',
})

const geistMono = Geist_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-geist-mono',
})

export const metadata: Metadata = {
  title: 'KP Rück Dashboard',
  description: 'Einsatzübersicht für die Mannschafts- und Materialdisposition der Feuerwehr.',
  icons: {
    icon: '/icon.svg',
    shortcut: '/icon.svg',
    apple: '/apple-icon.svg',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="de" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <AuthProvider>
            <EventProvider>
              <PersonnelProvider>
                <MaterialsProvider>
                  <OperationsProvider>
                    <NotificationProvider>
                      <CommandPaletteProvider>
                        <AppShell>
                          {children}
                        </AppShell>
                        <NotificationToasts />
                        <PersistentNotificationSidebar />
                      </CommandPaletteProvider>
                    </NotificationProvider>
                  </OperationsProvider>
                </MaterialsProvider>
              </PersonnelProvider>
            </EventProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
