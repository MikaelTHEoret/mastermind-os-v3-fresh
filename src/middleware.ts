import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

// Define protected routes that require authentication
const isProtectedRoute = createRouteMatcher([
  '/api/v1/auth/keys/(.*)',
  '/api/v1/auth/master/(.*)',
  '/dashboard(.*)',
  '/admin(.*)'
])

export default clerkMiddleware(async (auth, req) => {
  // Protect API routes that require authentication
  if (isProtectedRoute(req)) {
    await auth().protect()
  }
})

export const config = {
  matcher: ['/((?!.*\\..*|_next).*)', '/', '/(api|trpc)(.*)'],
}
