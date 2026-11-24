import type { FastifyError, FastifyInstance } from "fastify";
import { ZodError } from "zod";

/**
 * Error shape every service returns: `{ code, message, details? }` with the HTTP
 * status. mo-ui turns it into its own ApiError(status, code, message, details).
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
    public details?: unknown,
  ) {
    super(message ?? code);
  }
}

export function notFound(what: string): never {
  throw new ApiError(404, "not_found", `${what} not found.`);
}

export function installErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err: FastifyError | Error, req, reply) => {
    if (err instanceof ApiError) {
      return reply.status(err.status).send({ code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({ code: "validation", message: err.issues.map((i) => i.message).join("; "), details: err.issues });
    }
    const fe = err as FastifyError;
    if (fe.statusCode && fe.statusCode < 500) {
      return reply.status(fe.statusCode).send({ code: fe.code ?? "bad_request", message: fe.message });
    }
    req.log.error({ err }, "unhandled error");
    return reply.status(500).send({ code: "internal", message: "Something went wrong." });
  });
  app.setNotFoundHandler((req, reply) => reply.status(404).send({ code: "not_found", message: `No route for ${req.method} ${req.url}` }));
}
