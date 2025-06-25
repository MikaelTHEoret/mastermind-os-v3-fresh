// Vercel build trigger - Updated for deployment
export const BUILD_INFO = {
  version: "2.1.4",
  buildDate: new Date().toISOString(),
  commit: "latest",
  features: [
    "React 18.3.1 compatibility",
    "VM2 sandbox integration", 
    "Lazy-loaded enterprise components",
    "Enhanced error boundaries",
    "Dynamic component loading"
  ]
};

export default BUILD_INFO;