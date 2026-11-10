/**
 * Component: Next.js Instrumentation Hook (startup init trigger, shutdown handlers)
 * Documentation: documentation/backend/services/scheduler.md
 *
 * Runs once when the server process starts (Docker, `next start`, bare metal).
 * Skips the edge runtime and `next build`. The trigger calls the internal init
 * route over loopback so the scheduler and job processors start inside a route handler.
 * The shutdown coordinator (documentation/deployment/unified.md) is registered first,
 * so it captures the HTTP server from the trigger's own request.
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_PHASE === 'phase-production-build') return;

  // Keep the imports inside the runtime check so the edge bundle never includes them
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { registerShutdownHandlers } = await import('@/lib/startup/shutdown-coordinator');
    registerShutdownHandlers();
    const { triggerStartupInit } = await import('@/lib/startup/startup-trigger');
    void triggerStartupInit();
  }
}
