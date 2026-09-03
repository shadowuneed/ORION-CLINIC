import type { Metadata } from 'next';
import '@fontsource-variable/golos-text';
import './globals.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'ORION Clinic — рабочее место врача',
  description:
    'Клиницист-управляемая платформа для очного приёма, документации и маршрутизации пациента.',
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
