import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const baseUrl = 'https://tootodo.com';

  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/landing', '/login', '/signup'],
        disallow: [
          '/app/',
          '/employee/',
          '/super-admin/',
          '/api/',
          '/_next/',
        ],
      },
      {
        userAgent: 'Googlebot',
        allow: ['/', '/landing', '/login', '/signup'],
        disallow: [
          '/app/',
          '/employee/',
          '/super-admin/',
          '/api/',
        ],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  };
}
