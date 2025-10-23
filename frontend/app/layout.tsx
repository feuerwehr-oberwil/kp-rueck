import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import { AuthProvider } from '@/lib/contexts/auth-context'
import { OperationsProvider } from '@/lib/contexts/operations-context'

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
          <OperationsProvider>
            {children}
          </OperationsProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
