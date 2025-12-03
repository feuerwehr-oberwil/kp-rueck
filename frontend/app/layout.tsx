import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import { AuthProvider } from '@/lib/contexts/auth-context'
import { EventProvider } from '@/lib/contexts/event-context'
import { OperationsProvider } from '@/lib/contexts/operations-context'
import { NotificationProvider } from '@/lib/contexts/notification-context'
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
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="de">
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}>
        <AuthProvider>
          <EventProvider>
            <OperationsProvider>
              <NotificationProvider>
                <AppShell>
                  {children}
                </AppShell>
                <NotificationToasts />
                <PersistentNotificationSidebar />
              </NotificationProvider>
            </OperationsProvider>
          </EventProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
