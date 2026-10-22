/**
 * Outbound endpoint policy for user-configured (BYOK) provider endpoints.
 *
 * This is the SINGLE place that decides whether a user-supplied base URL may
 * be contacted. It is applied:
 *   1. in the browser, before a request is built (fast feedback), and
 *   2. at the outbound request boundary, so a redirect to a blocked
 *      destination is rejected even if the original URL passed validation.
 *
 * Threat model: a user-supplied URL is untrusted input. It must not be able to
 * reach cloud metadata services, loopback/link-local interfaces, or private
 * network ranges that the user's own machine exposes.
 *
 * Loopback is allowed ONLY when the operator explicitly opts in with
 * `allowLoopback` (a controlled "local model server" configuration), and even
 * then only for the loopback interface itself — never for other private
 * ranges.
 */

export interface EndpointPolicy {
    /** Allow http:// and loopback hosts (local model servers). */
    allowLoopback: boolean;
}

export const DEFAULT_ENDPOINT_POLICY: EndpointPolicy = { allowLoopback: false };

export interface EndpointDecision {
    ok: boolean;
    /** Normalized URL (only set when ok). */
    url?: string;
    /** Machine-readable rejection reason. */
    reason?: EndpointErrorCode;
    /** Human-readable explanation. */
    message?: string;
}

export type EndpointErrorCode =
    | 'malformed'
    | 'unsupported_scheme'
    | 'insecure_scheme'
    | 'credentials_in_url'
    | 'private_network'
    | 'loopback_forbidden'
    | 'link_local'
    | 'metadata_endpoint'
    | 'blocked_host'
    | 'port_forbidden';

/** Hosts that must never be contacted, regardless of scheme or policy. */
const BLOCKED_HOSTS = new Set([
    '169.254.169.254', // AWS / Azure / GCP / DigitalOcean metadata
    'metadata.google.internal', // GCP metadata (DNS name)
    'metadata.goog', // GCP metadata (short DNS name)
    'metadata.azure.internal', // Azure metadata
    'instance-data', // EC2 metadata alias
    '100.100.100.200', // Alibaba Cloud metadata
]);

/** Suffixes that resolve to cloud metadata services. */
const BLOCKED_HOST_SUFFIXES = ['.internal', '.local.metadata'];

const ALLOWED_SCHEMES = new Set(['https:', 'http:']);

/** Ports that are never acceptable for an outbound provider endpoint. */
const FORBIDDEN_PORTS = new Set([25, 465, 587, 993, 995, 1433, 3306, 5432, 6379, 9200, 11211, 27017]);

/** IPv4 ranges that are not publicly routable. */
function isPrivateIPv4(ip: string): boolean {
    const parts = ip.split('.').map((p) => Number(p));
    if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return false;
    const [a, b] = parts;
    if (a === 0) return true; // 0.0.0.0/8 "this network"
    if (a === 10) return true; // 10/8 private
    if (a === 127) return true; // 127/8 loopback
    if (a === 169 && b === 254) return true; // 169.254/16 link-local
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 private
    if (a === 192 && b === 168) return true; // 192.168/16 private
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
    if (a >= 224) return true; // multicast + reserved + broadcast
    return false;
}

/** IPv6 ranges that are not publicly routable. */
function isPrivateIPv6(ip: string): boolean {
    const addr = ip.toLowerCase().split('%')[0]; // strip zone id
    if (addr === '::' || addr === '::1') return true; // unspecified / loopback
    if (addr.startsWith('fe80')) return true; // link-local
    if (addr.startsWith('fc') || addr.startsWith('fd')) return true; // unique local
    if (addr.startsWith('ff')) return true; // multicast
    // IPv4-mapped (::ffff:a.b.c.d) — evaluate the embedded v4 address.
    const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIPv4(mapped[1]);
    return false;
}

function isLoopbackHost(hostname: string): boolean {
    const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (h === 'localhost' || h.endsWith('.localhost')) return true;
    if (h === '::1') return true;
    if (/^127\.\d+\.\d+\.\d+$/.test(h)) return true;
    return false;
}

/** Classify a hostname as a specific blocked category, if it is one. */
function classifyHost(hostname: string): { reason: EndpointErrorCode; message: string } | null {
    const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (BLOCKED_HOSTS.has(h)) {
        return { reason: 'metadata_endpoint', message: 'Cloud metadata endpoints are not allowed.' };
    }
    if (BLOCKED_HOST_SUFFIXES.some((s) => h.endsWith(s))) {
        return { reason: 'metadata_endpoint', message: 'Cloud metadata endpoints are not allowed.' };
    }
    if (isLoopbackHost(h)) {
        return { reason: 'loopback_forbidden', message: 'Loopback endpoints are not allowed.' };
    }
    // Bare IPv6 literal addresses
    if (h.includes(':')) {
        if (isPrivateIPv6(h)) {
            return { reason: 'private_network', message: 'Private or link-local network addresses are not allowed.' };
        }
        return null;
    }
    // Bare IPv4 literal
    if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
        if (isPrivateIPv4(h)) {
            return { reason: 'private_network', message: 'Private or link-local network addresses are not allowed.' };
        }
        return null;
    }
    return null;
}

/**
 * Validate a user-supplied endpoint URL.
 *
 * Returns a decision; never throws and never performs network I/O.
 */
export function evaluateEndpoint(rawUrl: string, policy: EndpointPolicy = DEFAULT_ENDPOINT_POLICY): EndpointDecision {
    const trimmed = (rawUrl ?? '').trim();
    if (!trimmed) {
        return { ok: false, reason: 'malformed', message: 'Endpoint URL is required.' };
    }

    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        return { ok: false, reason: 'malformed', message: 'Endpoint URL is not a valid URL.' };
    }

    if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
        return {
            ok: false,
            reason: 'unsupported_scheme',
            message: `Endpoint scheme "${parsed.protocol.replace(':', '')}" is not supported. Use https.`,
        };
    }

    // Credentials embedded in the URL would end up in logs / error messages.
    if (parsed.username || parsed.password) {
        return {
            ok: false,
            reason: 'credentials_in_url',
            message: 'Endpoint URL must not embed credentials.',
        };
    }

    const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
    if (!hostname) {
        return { ok: false, reason: 'malformed', message: 'Endpoint URL has no host.' };
    }

    const isLoopback = isLoopbackHost(hostname);

    if (parsed.protocol === 'http:' && !isLoopback) {
        return {
            ok: false,
            reason: 'insecure_scheme',
            message: 'Remote endpoints must use https. http:// is only allowed for a local model server.',
        };
    }

    // Port policy
    if (parsed.port) {
        const port = Number(parsed.port);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
            return { ok: false, reason: 'port_forbidden', message: 'Endpoint port is invalid.' };
        }
        if (FORBIDDEN_PORTS.has(port)) {
            return {
                ok: false,
                reason: 'port_forbidden',
                message: `Endpoint port ${port} is not allowed for provider traffic.`,
            };
        }
    }

    // Host policy
    if (isLoopback) {
        if (!policy.allowLoopback) {
            return {
                ok: false,
                reason: 'loopback_forbidden',
                message:
                    'Loopback endpoints are blocked. Enable the local-provider option to use a local model server.',
            };
        }
    } else {
        const blocked = classifyHost(hostname);
        if (blocked) return { ok: false, reason: blocked.reason, message: blocked.message };
    }

    // Normalize: drop a trailing slash so callers can append paths safely.
    const normalized = parsed.toString().replace(/\/+$/, '');
    return { ok: true, url: normalized };
}

/**
 * Validate the URL a request was actually sent to.
 *
 * Called with the FINAL URL (after redirects) at the outbound boundary so a
 * redirect cannot move the request to a blocked destination.
 */
export function assertEndpointAllowed(rawUrl: string, policy: EndpointPolicy = DEFAULT_ENDPOINT_POLICY): void {
    const decision = evaluateEndpoint(rawUrl, policy);
    if (!decision.ok) {
        throw new EndpointPolicyError(decision.reason ?? 'blocked_host', decision.message ?? 'Endpoint is not allowed.');
    }
}

export class EndpointPolicyError extends Error {
    readonly code: EndpointErrorCode;
    constructor(code: EndpointErrorCode, message: string) {
        super(message);
        this.name = 'EndpointPolicyError';
        this.code = code;
    }
}

/**
 * Resolve a possibly-relative redirect target against the current URL and
 * re-validate it. Returns the absolute URL, or throws when blocked.
 */
export function resolveRedirectTarget(
    currentUrl: string,
    location: string,
    policy: EndpointPolicy = DEFAULT_ENDPOINT_POLICY,
): string {
    let next: URL;
    try {
        next = new URL(location, currentUrl);
    } catch {
        throw new EndpointPolicyError('malformed', 'Redirect target is not a valid URL.');
    }
    assertEndpointAllowed(next.toString(), policy);
    return next.toString();
}
