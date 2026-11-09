/** Keep Node lifecycle APIs out of Next's Edge instrumentation entry. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { registerNodeRuntime } = await import('@/lib/server/register-node');
    await registerNodeRuntime();
  }
}
