import { StackServerApp } from "@stackframe/stack";

// Check if Stack Auth environment variables are available
const hasStackAuth = process.env.NEXT_PUBLIC_STACK_PROJECT_ID && process.env.STACK_SECRET_SERVER_KEY;

export const stackServerApp = hasStackAuth ? new StackServerApp({
  tokenStore: "nextjs-cookie", // storing auth tokens in cookies
  urls: {
    signIn: "/handler/sign-in",
    signUp: "/handler/sign-up", 
    emailVerification: "/handler/email-verification",
    passwordReset: "/handler/password-reset",
    // passwordChange removed - no longer supported in Stack Auth API
    home: "/",
    afterSignIn: "/",
    afterSignUp: "/", 
    afterSignOut: "/",
  },
}) : null;

// Export flag for components to check Stack Auth availability
export const isStackAuthEnabled = hasStackAuth;