/**
 * Authentication utilities for API routes
 */
import jwt from 'jsonwebtoken';
import { NextRequest } from 'next/server';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

export interface TokenPayload {
  id: string;
  email: string;
  fhirId: string;
}

/**
 * Verify JWT token from Authorization header
 */
export function verifyToken(request: NextRequest): TokenPayload | null {
  try {
    const authHeader = request.headers.get('authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    
    const decoded = jwt.verify(token, JWT_SECRET) as TokenPayload;
    return decoded;
  } catch (error) {
    console.error('Token verification failed:', error);
    return null;
  }
}

/**
 * Get user ID from token
 */
export function getUserIdFromToken(request: NextRequest): string | null {
  const payload = verifyToken(request);
  return payload?.id || null;
}
