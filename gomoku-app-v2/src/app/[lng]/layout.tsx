import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { AuthProvider } from '@/contexts/AuthContext'
import I18nProvider from '@/components/I18nProvider'
import { Toaster } from 'react-hot-toast'
import Script from 'next/script'
import './globals.css'
import { languages } from '@/i18n/settings'

const inter = Inter({ subsets: ['latin'] })

export async function generateStaticParams() {
  return languages.map((lng) => ({ lng }))
}

export const metadata: Metadata = {
  title: 'Gomoku Game',
  description: 'Play Gomoku online with friends or AI',
  icons: {
    icon: '/icocon.png',
  },
};

export default function RootLayout({
  children,
  params: { lng }
}: {
  children: React.ReactNode
  params: { lng: string }
}) {
  return (
    <html lang={lng}>
      <body className={inter.className}>
        <I18nProvider lng={lng}>
          <AuthProvider>
            {children}
            <Toaster />
          </AuthProvider>
        </I18nProvider>
      </body>
    </html>
  )
}