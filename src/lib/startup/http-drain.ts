/**
 * Component: HTTP drain for the app stop
 * Documentation: documentation/deployment/unified.md
 *
 * Wraps the captured HTTP server for the shutdown coordinator. close() stops listening and
 * calls back once every connection has closed. Keep-alive connections with no request open
 * are closed as soon as no response is open, at once and every HTTP_IDLE_SWEEP_MS, so a
 * stop does not wait for the keep-alive timeout. A response counts as open until Node has
 * handed all of it to the OS or its connection dropped, so no response is cut mid-write.
 */

import net from 'node:net';
import type { ClosableServer } from '@/lib/startup/shutdown-coordinator';

/** How often the drain closes connections with no request open while nothing is open */
export const HTTP_IDLE_SWEEP_MS = 50;

export interface DrainableServer {
  close(callback?: (error?: Error) => void): unknown;
  closeIdleConnections?(): void;
  closeAllConnections?(): void;
}

interface ResponseLike {
  once(event: 'close', listener: () => void): unknown;
}

export interface HttpDrain extends ClosableServer {
  /** Count a response as open until its 'close' (after 'finish', or when its connection drops) */
  track(response: unknown): void;
  openResponses(): number;
}

export function createHttpDrain(server: DrainableServer): HttpDrain {
  let open = 0;
  let closing = false;

  // Node skips connections with an unfinished response, but closes one whose response is
  // ended and still being written. Only sweeping while no response is open avoids that.
  const sweep = () => {
    if (closing && open === 0) server.closeIdleConnections?.();
  };

  return {
    track(response) {
      const candidate = response as ResponseLike | null | undefined;
      if (typeof candidate?.once !== 'function') return;
      open += 1;
      candidate.once('close', () => {
        open -= 1;
        sweep();
      });
    },
    openResponses: () => open,
    close(callback) {
      closing = true;
      let timer: ReturnType<typeof setInterval> | undefined;
      let closed = false;
      const done = (error?: Error) => {
        closed = true;
        clearInterval(timer);
        callback?.(error);
      };
      // http.Server.close() first closes idle connections with Node's check (the one that
      // can cut an ended response); net.Server's close only stops listening
      if (server instanceof net.Server) net.Server.prototype.close.call(server, done);
      else server.close(done);
      if (!closed) {
        timer = setInterval(sweep, HTTP_IDLE_SWEEP_MS);
        timer.unref?.();
      }
      sweep();
    },
    closeAllConnections() {
      server.closeAllConnections?.();
    },
  };
}
