/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['react-remove-scroll'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
    ],
  },
  experimental: {
    serverComponentsExternalPackages: [
      'postgres',
      'bcryptjs',
      'leaflet',
      'react-leaflet',
      '@react-leaflet/core',
      'genkit',
      '@genkit-ai/google-genai',
      '@genkit-ai/ai',
      '@genkit-ai/core',
      '@genkit-ai/dotprompt',
      '@genkit-ai/flow',
      '@opentelemetry/api',
      '@opentelemetry/sdk-trace-base',
      '@opentelemetry/sdk-trace-node',
      '@opentelemetry/context-async-hooks'
    ],
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
};

export default nextConfig;
