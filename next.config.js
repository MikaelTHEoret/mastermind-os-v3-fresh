/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  
  // FORCE App Router usage
  experimental: {
    appDir: true, // Explicitly enable App Router
  },
  
  // Fix: Use the new serverExternalPackages instead of deprecated option
  serverExternalPackages: [],
  
  // Force app directory usage
  pageExtensions: ['tsx', 'ts', 'jsx', 'js'],
  
  // Ensure proper module resolution
  webpack: (config, { isServer }) => {
    // Fix for Node.js modules in browser
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
      };
    }
    
    // Force App Router recognition
    config.resolve.alias = {
      ...config.resolve.alias,
      '@': './src',
    };
    
    return config;
  },
  
  // Allow localhost API calls in development
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, POST, PUT, DELETE, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization' },
        ],
      },
    ];
  },
}

module.exports = nextConfig
