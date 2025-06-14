/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow unsafe-eval for Stack Auth dynamic imports
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://api.stack-auth.com https://*.stack-auth.com",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https:",
              "font-src 'self' data:",
              "connect-src 'self' https://api.stack-auth.com https://*.stack-auth.com https://vercel.live",
              "frame-src 'self' https://*.stack-auth.com"
            ].join('; ')
          }
        ]
      }
    ]
  }
}

module.exports = nextConfig