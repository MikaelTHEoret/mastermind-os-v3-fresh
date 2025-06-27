/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  
  // FORCE App Router recognition
  experimental: {
    // Explicitly enable App Router features
    serverComponentsExternalPackages: [],
  },
  
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
  
  // Force output to be dynamic
  output: 'standalone',
  
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
