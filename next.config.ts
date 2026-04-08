import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['react-remove-scroll'],
  serverExternalPackages: [
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
      {
        protocol: 'https',
        hostname: 'mbj.news',
        port: '',
        pathname: '/**',
      },
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
};

export default nextConfig;
