import { StackServerApp } from "@stackframe/stack";

export const stackServerApp = new StackServerApp({
  tokenStore: "nextjs-cookie",
  urls: {
    // Use environment variables if available, otherwise defaults
    signIn: process.env.NEXT_PUBLIC_STACK_SIGN_IN_URL || "/handler/sign-in",
    signUp: process.env.NEXT_PUBLIC_STACK_SIGN_UP_URL || "/handler/sign-up",
    afterSignIn: process.env.NEXT_PUBLIC_STACK_AFTER_SIGN_IN_URL || "/",
    afterSignUp: process.env.NEXT_PUBLIC_STACK_AFTER_SIGN_UP_URL || "/",
    emailVerification: process.env.NEXT_PUBLIC_STACK_EMAIL_VERIFICATION_URL || "/handler/email-verification",
    passwordReset: process.env.NEXT_PUBLIC_STACK_PASSWORD_RESET_URL || "/handler/password-reset",
    accountSettings: process.env.NEXT_PUBLIC_STACK_ACCOUNT_SETTINGS_URL || "/handler/account-settings",
  },
});
