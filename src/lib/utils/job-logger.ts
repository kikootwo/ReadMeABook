/**
 * Component: Job Logger Utility
 * Documentation: documentation/backend/services/jobs.md
 *
 * Provides structured logging for job processors with database persistence
 */

import { prisma } from '../db';

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogMetadata {
  [key: string]: any;
}

/**
 * Job Logger - Logs events to both console and database
 */
export class JobLogger {
  private jobId: string;
  private context: string;

  constructor(jobId: string, context: string) {
    this.jobId = jobId;
    this.context = context;
  }

  /**
   * Log info message
   */
  async info(message: string, metadata?: LogMetadata): Promise<void> {
    await this.log('info', message, metadata);
  }

  /**
   * Log warning message
   */
  async warn(message: string, metadata?: LogMetadata): Promise<void> {
    await this.log('warn', message, metadata);
  }

  /**
   * Log error message
   */
  async error(message: string, metadata?: LogMetadata): Promise<void> {
    await this.log('error', message, metadata);
  }

  /**
   * Internal logging method
   */
  private async log(level: LogLevel, message: string, metadata?: LogMetadata): Promise<void> {
    // Log to console with timestamp (for Docker logs)
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    const consoleMessage = `[${this.context}] ${message}`;

    switch (level) {
      case 'info':
        console.log(consoleMessage);
        break;
      case 'warn':
        console.warn(consoleMessage);
        break;
      case 'error':
        console.error(consoleMessage);
        break;
    }

    // Log metadata if provided
    if (metadata && Object.keys(metadata).length > 0) {
      console.log(timestamp, JSON.stringify(metadata, null, 2));
    }

    // Persist to database (non-blocking, ignore errors to not break job execution)
    try {
      await prisma.jobEvent.create({
        data: {
          jobId: this.jobId,
          level,
          context: this.context,
          message,
          metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : null,
        },
      });
    } catch (error) {
      console.error('[JobLogger] Failed to persist log to database:', error);
      // Don't throw - logging failure should not break job execution
    }
  }
}

/**
 * Create a job logger instance
 */
export function createJobLogger(jobId: string, context: string): JobLogger {
  return new JobLogger(jobId, context);
}
