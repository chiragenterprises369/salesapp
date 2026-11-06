import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Tootodo – Modern Sales CRM for Indian Sales Teams',
    short_name: 'Tootodo',
    description:
      'Organize leads, automate WhatsApp follow-ups, manage sales pipelines, and track field teams in real-time.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f8fafc',
    theme_color: '#4f46e5',
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
      },
    ],
  };
}
