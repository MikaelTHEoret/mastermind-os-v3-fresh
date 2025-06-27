// DISABLED: This file conflicts with src/app/page.tsx
// Redirecting to avoid build errors
module.exports = function() {
  if (typeof window !== 'undefined') {
    window.location.href = '/';
  }
  return null;
};