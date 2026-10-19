/**
 * Component: E2E exec-bridge client (runs as a child process so spec helpers can stay synchronous)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * stdin: JSON { service, user?, argv, input? }. Prints the command's stdout; exits with its status
 * (stderr forwarded). Bridge URL/token come from E2E_EXEC_BRIDGE_URL / E2E_EXEC_TOKEN.
 */

const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', async () => {
  const url = process.env.E2E_EXEC_BRIDGE_URL;
  const token = process.env.E2E_EXEC_TOKEN;
  if (!url || !token) {
    process.stderr.write('exec bridge not available (tainted run or not started by run.mjs)\n');
    process.exit(97);
  }
  try {
    const res = await fetch(`${url}/exec`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-exec-token': token }, body: Buffer.concat(chunks) });
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    if (!res.ok) {
      process.stderr.write(`exec bridge: ${body.error || res.status}\n`);
      process.exit(98);
    }
    process.stdout.write(body.stdout || '');
    process.stderr.write(body.stderr || '');
    process.exitCode = body.status;
  } catch (error) {
    process.stderr.write(`exec bridge unreachable: ${error.message}\n`);
    process.exit(99);
  }
});
