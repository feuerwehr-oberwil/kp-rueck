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
import { GroupsProvider } from '@/lib/contexts/groups-context'
import { NotificationProvider } from '@/lib/contexts/notification-context'
import { CommandPaletteProvider } from '@/lib/contexts/command-palette-context'
import { NotificationToasts } from '@/components/notifications/notification-toasts'
import { DismissAllToasts } from '@/components/ui/sonner'
import { AppShell } from '@/components/app-shell'
import { VehicleDriverPrompt } from '@/components/vehicle-driver-prompt'
import { ResourceConflictPrompt } from '@/components/resource-conflict-prompt'
import { GpsReleasePrompt } from '@/components/gps-release-prompt'
import { GpsArrivalPrompt } from '@/components/gps-arrival-prompt'
import { PickupDonePrompt } from '@/components/pickup-done-prompt'
import { ErrorReporter } from '@/components/error-reporter'
import { RuntimeBackendOrigin } from '@/components/runtime-backend-origin'
import { publicBackendOrigin } from '@/lib/env'
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
        {/* Where the browser may open its WebSocket. Read here because API_URL is a RUNTIME
            variable — the same one the /backend-api proxy route uses — and this layout renders
            per request. Null on a deployment that sits behind one origin (compose/Caddy) or
            names the backend only inside a container network; getWsUrl() then falls back to
            the behaviour it always had. */}
        <RuntimeBackendOrigin origin={publicBackendOrigin(process.env.API_URL)} />
        <TopLoadingBar />
        {/* Catches what escapes the React tree (rejected promises, listeners) and posts
            it to this station's OWN server log. Opt-in forwarding is a separate decision
            made server-side — see lib/report-error.ts. */}
        <ErrorReporter />
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
                    <GroupsProvider>
                      <NotificationProvider>
                        <CommandPaletteProvider>
                          <AppShell>
                            {children}
                          </AppShell>
                          <NotificationToasts />
                          <DismissAllToasts />
                          <VehicleDriverPrompt />
                          <ResourceConflictPrompt />
                          <GpsReleasePrompt />
                          <GpsArrivalPrompt />
                          <PickupDonePrompt />
                        </CommandPaletteProvider>
                      </NotificationProvider>
                    </GroupsProvider>
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
