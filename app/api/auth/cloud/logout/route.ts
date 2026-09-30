import { handleCloudAuth } from '@/lib/cloud/auth-handlers.server';
export const dynamic = 'force-dynamic';
export function POST(request: Request) { return handleCloudAuth('logout', request); }
