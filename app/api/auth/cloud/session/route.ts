import { handleCloudAuth } from '@/lib/cloud/auth-handlers.server';
export const dynamic = 'force-dynamic';
export function GET(request: Request) { return handleCloudAuth('session', request); }
