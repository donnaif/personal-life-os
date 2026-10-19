import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from './db.js';
import type { Env } from './env.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
    env: Env;
  }
}

export interface AuthUser {
  sub: string;
  email: string;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AuthUser;
    user: AuthUser;
  }
}

export type AuthRequest = FastifyRequest;
export type AuthReply = FastifyReply;
export type AppInstance = FastifyInstance;
