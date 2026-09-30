import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { ClientNavigationRecovery } from './client-navigation-recovery';
import { PathwayTransitionLayer } from './pathway-transition-layer';
import { CloudAccountBoundary } from './cloud-account-boundary';
import { cloudDatabaseForPage } from '@/lib/cloud/database-context.server';
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
  const generation = await cloudDatabaseForPage().then(context => context.sessionId.replaceAll('-', '')).catch(() => null);
  return (
    <html lang="ru" data-theme={theme} style={{ colorScheme: theme }} suppressHydrationWarning>
      <body><CloudAccountBoundary generation={generation}>{children}<PathwayTransitionLayer /><ClientNavigationRecovery /></CloudAccountBoundary></body>
    </html>
  );
}
