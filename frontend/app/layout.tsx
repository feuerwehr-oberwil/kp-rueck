import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages, getTranslations } from 'next-intl/server'
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
import { DismissAllToasts } from '@/components/ui/sonner'
import { PersistentNotificationSidebar } from '@/components/notifications/persistent-notification-sidebar'
import { AppShell } from '@/components/app-shell'
import { VehicleDriverPrompt } from '@/components/vehicle-driver-prompt'
import { VehicleConflictPrompt } from '@/components/vehicle-conflict-prompt'
import { GpsReleasePrompt } from '@/components/gps-release-prompt'
import { GpsArrivalPrompt } from '@/components/gps-arrival-prompt'
import { TopLoadingBar } from '@/components/ui/top-loading-bar'

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

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('common.meta')
  return {
    title: t('title'),
    description: t('description'),
    icons: {
      icon: '/icon.svg',
      shortcut: '/icon.svg',
      apple: '/apple-icon.svg',
    },
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const locale = await getLocale()
  const messages = await getMessages()

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}>
        <TopLoadingBar />
        <NextIntlClientProvider locale={locale} messages={messages}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
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
                        <DismissAllToasts />
                        <PersistentNotificationSidebar />
                        <VehicleDriverPrompt />
                        <VehicleConflictPrompt />
                        <GpsReleasePrompt />
                        <GpsArrivalPrompt />
                      </CommandPaletteProvider>
                    </NotificationProvider>
                  </OperationsProvider>
                </MaterialsProvider>
              </PersonnelProvider>
            </EventProvider>
          </AuthProvider>
        </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
