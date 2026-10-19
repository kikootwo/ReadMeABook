/**
 * Component: Next.js Instrumentation Hook (startup init trigger)
 * Documentation: documentation/backend/services/scheduler.md
 *
 * Runs once when the server process starts (Docker, `next start`, bare metal).
 * Skips the edge runtime and `next build`. The trigger calls the internal init
 * route over loopback so the scheduler and job processors start inside a route handler.
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_PHASE === 'phase-production-build') return;

  // Keep the import inside the runtime check so the edge bundle never includes it
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { triggerStartupInit } = await import('@/lib/startup/startup-trigger');
    void triggerStartupInit();
  }
}
