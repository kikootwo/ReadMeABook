/**
 * Component: Request Cancel HTTP Response
 * Documentation: documentation/backend/services/api-tokens.md
 *
 * One response shape for every cancel route: the request's id, status and cancel time, the download
 * outcome and a message. No download internals.
 */

import { NextResponse } from 'next/server';
import { cancelFailureMessage, type CancelResult } from '@/lib/services/request-cancel.service';

export function cancelResponse(result: CancelResult): NextResponse {
  if (result.success) {
    return NextResponse.json({
      success: true,
      request: result.request,
      download: result.download,
      message: result.message,
    });
  }
  if (result.reason === 'not_found') {
    return NextResponse.json({ error: 'NotFound', message: cancelFailureMessage(result) }, { status: 404 });
  }
  return NextResponse.json({ error: 'ValidationError', message: cancelFailureMessage(result) }, { status: 400 });
}
