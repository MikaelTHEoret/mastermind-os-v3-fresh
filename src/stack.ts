import { StackServerApp } from "@stackframe/stack";

// Check if Stack Auth environment variables are configured
// Note: This runs at build time, so might not reflect runtime environment
export const isStackAuthEnabled = !!(  
  process.env.NEXT_PUBLIC_STACK_PROJECT_ID && 
  process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY
);

// Runtime check for Stack Auth configuration
export function checkStackAuthEnabled() {
  return !!(
    process.env.NEXT_PUBLIC_STACK_PROJECT_ID && 
    process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY
  )
}

export const stackServerApp = new StackServerApp({
  tokenStore: "nextjs-cookie",
  projectId: process.env.NEXT_PUBLIC_STACK_PROJECT_ID || "project_placeholder",
  publishableClientKey: process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY || "key_placeholder",
  secretServerKey: process.env.STACK_SECRET_SERVER_KEY || "secret_placeholder",
  urls: {
    handler: "/handler",
    signIn: "/handler/sign-in",
    signUp: "/handler/sign-up",
    afterSignIn: "/",
    afterSignUp: "/",
    afterSignOut: "/",
  },
});