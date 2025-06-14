import { StackServerApp } from "@stackframe/stack";

// Check if Stack Auth environment variables are configured
export const isStackAuthEnabled = !!(
  process.env.NEXT_PUBLIC_STACK_PROJECT_ID && 
  process.env.STACK_SECRET_SERVER_KEY
);

export const stackServerApp = new StackServerApp({
  tokenStore: "nextjs-cookie", // storing auth tokens in cookies
  urls: {
    signIn: "/handler/sign-in",
    signUp: "/handler/sign-up", 
    emailVerification: "/handler/email-verification",
    passwordReset: "/handler/password-reset",
    // Removed passwordChange - no longer supported by Stack Auth API
    home: "/",
    afterSignIn: "/",
    afterSignUp: "/", 
    afterSignOut: "/",
  },
});