import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    let message: string | object;
    if (exception instanceof HttpException) {
      message = exception.getResponse();
    } else {
      const err = exception as Error;
      this.logger.error(`${request.method} ${request.url} - ${err?.message || 'Unknown error'}`, err?.stack);
      message = process.env.NODE_ENV === 'production'
        ? 'Internal server error'
        : (err?.message || 'Internal server error');
    }

    const msgStr = typeof message === 'string' ? message : (message as any)?.message || String(message);
    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message: msgStr,
    });
  }
}
