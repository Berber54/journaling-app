import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { config } from '../config.js';
import db from '../database.js';
import { AppError } from '../middleware/errorHandler.js';
import type { AuthResponse, UserRow } from '../shared/types.js';

export const registerSchema = z.object({
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .max(50, 'Username must be at most 50 characters')
    .regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export const loginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

function generateToken(userId: string, username: string): { token: string; expiresAt: string } {
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const token = jwt.sign({ userId, username }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
  return { token, expiresAt };
}

export async function registerUser(username: string, password: string): Promise<AuthResponse> {
  const parsed = registerSchema.parse({ username, password });

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(parsed.username) as UserRow | undefined;
  if (existing) {
    throw new AppError(409, 'CONFLICT', 'Username already exists');
  }

  const passwordHash = await bcrypt.hash(parsed.password, config.bcryptRounds);
  const userId = uuidv4();

  db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run(
    userId,
    parsed.username,
    passwordHash
  );

  const { token, expiresAt } = generateToken(userId, parsed.username);
  console.log(`[auth] User registered: ${parsed.username} (${userId})`);

  return { token, userId, expiresAt };
}

export async function loginUser(username: string, password: string): Promise<AuthResponse> {
  const parsed = loginSchema.parse({ username, password });

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(parsed.username) as UserRow | undefined;
  if (!user) {
    throw new AppError(401, 'UNAUTHORIZED', 'Invalid credentials');
  }

  const valid = await bcrypt.compare(parsed.password, user.password_hash);
  if (!valid) {
    throw new AppError(401, 'UNAUTHORIZED', 'Invalid credentials');
  }

  const { token, expiresAt } = generateToken(user.id, user.username);
  console.log(`[auth] User logged in: ${user.username} (${user.id})`);

  return { token, userId: user.id, expiresAt };
}

export function refreshToken(userId: string): AuthResponse {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow | undefined;
  if (!user) {
    throw new AppError(401, 'UNAUTHORIZED', 'User no longer exists');
  }

  const { token, expiresAt } = generateToken(user.id, user.username);
  return { token, userId: user.id, expiresAt };
}
