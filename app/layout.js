export const metadata = {
  title: 'Prime Scribe — Notas Clínicas',
  description: 'Sistema clínico interno · Prime Advanced Dentistry'
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1
};

import './globals.css';

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;500;600&family=Inter:wght@300;400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
