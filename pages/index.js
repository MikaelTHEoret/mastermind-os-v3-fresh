// DEPRECATED: This file is disabled due to Next.js 15 App Router conflict
// App Router is now active at /app/page.tsx
// This file serves no function and exists only to prevent git issues
// DO NOT RESTORE - App Router takes precedence

export default function DeprecatedPage() {
  return null;
}

// This export prevents the page from being routable
export const getStaticProps = () => ({ notFound: true });