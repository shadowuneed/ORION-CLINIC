import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { ClientNavigationRecovery } from './client-navigation-recovery';
import { PathwayTransitionLayer } from './pathway-transition-layer';
import { LocalAccountBoundary } from './local-account-boundary';
import '@fontsource-variable/golos-text';
import './globals.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'ORION Clinic — рабочее место',
  icons: { icon: '/favicon.svg' },
  description:
    'Клиницист-управляемая платформа для очного приёма, документации и маршрутизации пациента.',
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const theme = (await cookies()).get('orion-theme')?.value === 'dark' ? 'dark' : 'light';
  const generation = (await headers()).get('x-orion-local-generation');
  return (
    <html lang="ru" data-theme={theme} style={{ colorScheme: theme }} suppressHydrationWarning>
      <body><LocalAccountBoundary generation={generation}>{children}<PathwayTransitionLayer /><ClientNavigationRecovery /></LocalAccountBoundary></body>
    </html>
  );
}
