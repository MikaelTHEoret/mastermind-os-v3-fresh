import { StackServerApp } from "@stackframe/stack";

// Fallback configuration for deployment
const getStackConfig = () => {
  const projectId = process.env.NEXT_PUBLIC_STACK_PROJECT_ID || "st_tcutrWqiStGLyVSB";
  const publishableKey = process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY || "st_tcutrWqiStGLyVSB_pub_LrNzN3Q";
  const secretKey = process.env.STACK_SECRET_SERVER_KEY || "st_tcutrWqiStGLyVSB_sec_LrNzN3Q";

  return {
    projectId,
    publishableClientKey: publishableKey,
    secretServerKey: secretKey
  };
};

export const stackServerApp = new StackServerApp({
  tokenStore: "nextjs-cookie",
  urls: {
    signIn: "/handler/sign-in",
    signUp: "/handler/sign-up", 
    afterSignIn: "/dashboard",
    afterSignUp: "/dashboard",
    home: "/"
  },
  ...getStackConfig()
});