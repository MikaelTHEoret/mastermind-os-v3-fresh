import './globals.css'

export const metadata = {
  title: 'MasterMind OS v3 - Fresh Start',
  description: 'Working Next.js deployment',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}