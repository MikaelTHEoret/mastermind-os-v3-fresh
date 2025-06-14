import { StackServerApp } from "@stackframe/stack";

export const stackServerApp = new StackServerApp({
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
});