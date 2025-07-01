import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-gray-950/95 to-purple-950/95">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-cyan-400 mb-4">404 - Page Not Found</h2>
        <p className="text-gray-300 mb-6">The page you're looking for doesn't exist.</p>
        <Link 
          href="/" 
          className="inline-block px-6 py-3 bg-gradient-to-r from-cyan-600 to-purple-600 hover:from-cyan-500 hover:to-purple-500 text-white rounded-lg transition-colors"
        >
          Return Home
        </Link>
      </div>
    </div>
  );
}