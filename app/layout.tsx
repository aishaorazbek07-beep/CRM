import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'CRM — продажи, склад, производство',
  description: 'Единая база: сделки, спецификации, резервы, снабжение и цех в одном окне',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  )
}
