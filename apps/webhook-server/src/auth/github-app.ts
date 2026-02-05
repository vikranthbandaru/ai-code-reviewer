/**
 * GitHub App Authentication
 *
 * Implements:
 * - JWT generation for App-level auth
 * - Installation access token retrieval
 */

import jwt from 'jsonwebtoken';

import type { Config } from '../config.js';
import { getLogger } from '../logging/logger.js';

export interface InstallationToken {
    token: string;
    expiresAt: Date;
    permissions: Record<string, string>;
}

// Cache for installation tokens
const tokenCache = new Map<number, InstallationToken>();

/**
 * Generate a JWT for GitHub App authentication
 */
export function generateAppJwt(config: Config): string {
    const now = Math.floor(Date.now() / 1000);

    const payload = {
        // Issued at time (60 seconds in the past to account for clock drift)
        iat: now - 60,
        // Expiration time (10 minutes from now, max allowed)
        exp: now + 600,
        // GitHub App ID
        iss: config.githubAppId,
    };

    return jwt.sign(payload, config.githubPrivateKey, { algorithm: 'RS256' });
}

/**
 * Get installation access token, using cache if valid
 */
export async function getInstallationToken(
    installationId: number,
    config: Config
): Promise<InstallationToken> {
    const logger = getLogger();

    // Check cache
    const cached = tokenCache.get(installationId);
    if (cached !== undefined && cached.expiresAt > new Date(Date.now() + 60000)) {
        logger.debug({ installationId }, 'Using cached installation token');
        return cached;
    }

    logger.info({ installationId }, 'Fetching new installation token');

    // Generate app JWT
    const appJwt = generateAppJwt(config);

    // Request installation token
    const response = await fetch(
        `https://api.github.com/app/installations/${installationId}/access_tokens`,
        {
            method: 'POST',
            headers: {
                Accept: 'application/vnd.github+json',
                Authorization: `Bearer ${appJwt}`,
                'X-GitHub-Api-Version': '2022-11-28',
            },
        }
    );

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to get installation token: ${response.status} ${error}`);
    }

    const data = (await response.json()) as {
        token: string;
        expires_at: string;
        permissions: Record<string, string>;
    };

    const token: InstallationToken = {
        token: data.token,
        expiresAt: new Date(data.expires_at),
        permissions: data.permissions,
    };

    // Cache the token
    tokenCache.set(installationId, token);

    logger.debug(
        { installationId, expiresAt: token.expiresAt.toISOString() },
        'Cached installation token'
    );

    return token;
}

/**
 * Clear cached token for an installation (useful on auth errors)
 */
export function clearTokenCache(installationId: number): void {
    tokenCache.delete(installationId);
}

/**
 * Clear all cached tokens
 */
export function clearAllTokenCache(): void {
    tokenCache.clear();
}

/**
 * Verify the JWT private key is valid
 */
export function verifyPrivateKey(config: Config): boolean {
    try {
        // Try to generate a JWT - will throw if key is invalid
        generateAppJwt(config);
        return true;
    } catch {
        return false;
    }
}
