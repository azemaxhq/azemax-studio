/**
 * Secure credential store for BYOK provider keys.
 *
 * Storage policy (two modes, no plaintext fallback):
 *
 *   1. SESSION (default)
 *      Keys live in a module-level Map only. They are never written to
 *      localStorage, sessionStorage, cookies, URLs, logs, analytics, or
 *      conversation history. They disappear when the tab is closed.
 *
 *   2. ENCRYPTED DEVICE VAULT (opt-in, "Remember on this device")
 *      Ciphertext is stored in IndexedDB. The encryption key is derived from a
 *      user passphrase with PBKDF2-SHA-256 (versioned parameters) and used
 *      with AES-GCM. The passphrase and the derived key are NEVER persisted.
 *
 *      Browser-level encryption protects data at rest. It does NOT protect
 *      against malicious JavaScript running inside an unlocked session, and
 *      it cannot protect against a compromised runtime. The vault is
 *      explicitly unlocked by the user and can be locked at any time.
 *
 * JavaScript cannot guarantee memory erasure. The vault holds the derived key
 * in a CryptoKey (non-extractable) and drops the passphrase reference as soon
 * as derivation completes; the plaintext key string is never retained.
 */

import type { CredentialStore, ProviderConfig, ProviderId } from './byokTypes';

/** Vault format version. Bumping this invalidates old ciphertext. */
export const VAULT_FORMAT_VERSION = 1;

/** PBKDF2 parameters — versioned alongside the vault format. */
export const VAULT_KDF = {
    hash: 'SHA-256',
    iterations: 310_000,
    saltBytes: 16,
} as const;

/** AES-GCM parameters. */
export const VAULT_CIPHER = {
    name: 'AES-GCM',
    keyBits: 256,
    ivBytes: 12, // 96-bit nonce — the recommended size for GCM
    tagBits: 128,
} as const;

const VAULT_DB_NAME = 'azemax-provider-vault';
const VAULT_STORE_NAME = 'credentials';

/** One stored credential record (ciphertext only). */
interface VaultRecord {
    providerId: ProviderId;
    /** base64 ciphertext (includes the GCM auth tag). */
    ciphertext: string;
    /** base64 nonce (IV). Never reused for the same key. */
    iv: string;
    /** KDF parameter set used for this record. */
    kdf: { hash: string; iterations: number; salt: string };
    /** Vault format version. */
    version: number;
    /** Epoch ms the record was written. */
    updatedAt: number;
}

/** The vault header: salt + verifier for the passphrase. */
interface VaultHeader {
    version: number;
    /** base64 salt for PBKDF2. */
    salt: string;
    /** base64 nonce for the verifier. */
    verifierIv: string;
    /** base64 encrypted verifier — proves the passphrase without storing it. */
    verifier: string;
    kdf: { hash: string; iterations: number };
}

// ---------------------------------------------------------------------------
// Typed byte helpers
// ---------------------------------------------------------------------------

/**
 * Convert a byte array into a `BufferSource`-compatible view.
 *
 * The DOM lib types `BufferSource` as `ArrayBufferView<ArrayBuffer> | ArrayBuffer`
 * while `Uint8Array` defaults to `Uint8Array<ArrayBufferLike>`. Copying into a
 * freshly allocated `ArrayBuffer` narrows the type to `ArrayBuffer`, which is
 * assignable to `BufferSource` without a broad cast, and guarantees the
 * returned buffer owns exactly the bytes we intend.
 */
function toBufferSource(bytes: Uint8Array): ArrayBuffer {
    const out = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(out).set(bytes);
    return out;
}

function bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
    const binary = atob(base64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
}

function randomBytes(length: number): Uint8Array {
    const out = new Uint8Array(length);
    crypto.getRandomValues(out);
    return out;
}

// ---------------------------------------------------------------------------
// Session credential store (default)
// ---------------------------------------------------------------------------

class SessionCredentialStore implements CredentialStore {
    private credentials = new Map<ProviderId, ProviderConfig>();

    async getCredentials(providerId: ProviderId): Promise<ProviderConfig | null> {
        const config = this.credentials.get(providerId);
        return config ? { ...config } : null;
    }

    async setCredentials(config: ProviderConfig): Promise<void> {
        this.credentials.set(config.id, { ...config });
    }

    async removeCredentials(providerId: ProviderId): Promise<void> {
        this.credentials.delete(providerId);
    }

    async getAllCredentials(): Promise<ProviderConfig[]> {
        return Array.from(this.credentials.values()).map((c) => ({ ...c }));
    }

    async clear(): Promise<void> {
        this.credentials.clear();
    }
}

// ---------------------------------------------------------------------------
// Encrypted device vault
// ---------------------------------------------------------------------------

class EncryptedCredentialStore implements CredentialStore {
    /** Non-extractable AES-GCM key. Null while locked. */
    private vaultKey: CryptoKey | null = null;
    private unlocked = false;
    private db: IDBDatabase | null = null;

    isVaultUnlocked(): boolean {
        return this.unlocked && this.vaultKey !== null;
    }

    lock(): void {
        this.vaultKey = null;
        this.unlocked = false;
    }

    // -- IndexedDB ---------------------------------------------------------

    private openDb(): Promise<IDBDatabase> {
        if (this.db) return Promise.resolve(this.db);
        return new Promise((resolve, reject) => {
            if (typeof indexedDB === 'undefined') {
                reject(new Error('IndexedDB is unavailable in this environment.'));
                return;
            }
            const request = indexedDB.open(VAULT_DB_NAME, 1);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(VAULT_STORE_NAME)) {
                    db.createObjectStore(VAULT_STORE_NAME, { keyPath: 'providerId' });
                }
            };
            request.onsuccess = () => {
                this.db = request.result;
                resolve(request.result);
            };
            request.onerror = () => reject(request.error ?? new Error('Failed to open the credential vault.'));
        });
    }

    private async idbGet<T>(key: string): Promise<T | undefined> {
        const db = await this.openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(VAULT_STORE_NAME, 'readonly');
            const request = tx.objectStore(VAULT_STORE_NAME).get(key);
            request.onsuccess = () => resolve(request.result as T | undefined);
            request.onerror = () => reject(request.error ?? new Error('Vault read failed.'));
        });
    }

    private async idbPut(value: unknown, key: string): Promise<void> {
        const db = await this.openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(VAULT_STORE_NAME, 'readwrite');
            tx.objectStore(VAULT_STORE_NAME).put(value, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error ?? new Error('Vault write failed.'));
        });
    }

    private async idbDelete(key: string): Promise<void> {
        const db = await this.openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(VAULT_STORE_NAME, 'readwrite');
            tx.objectStore(VAULT_STORE_NAME).delete(key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error ?? new Error('Vault delete failed.'));
        });
    }

    private async idbClear(): Promise<void> {
        const db = await this.openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(VAULT_STORE_NAME, 'readwrite');
            tx.objectStore(VAULT_STORE_NAME).clear();
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error ?? new Error('Vault clear failed.'));
        });
    }

    /**
     * Remove every stored credential while KEEPING the vault header.
     *
     * Used when a vault is (re-)initialized: the header carries the salt and
     * the passphrase verifier and must survive the reset.
     */
    private async idbClearRecords(): Promise<void> {
        const db = await this.openDb();
        const keys = await new Promise<string[]>((resolve, reject) => {
            const tx = db.transaction(VAULT_STORE_NAME, 'readonly');
            const request = tx.objectStore(VAULT_STORE_NAME).getAllKeys();
            request.onsuccess = () => resolve((request.result as string[]) ?? []);
            request.onerror = () => reject(request.error ?? new Error('Vault read failed.'));
        });
        for (const key of keys) {
            if (key === VAULT_HEADER_KEY) continue;
            await this.idbDelete(key);
        }
    }

    // -- Key derivation -----------------------------------------------------

    private async deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
        const material = await crypto.subtle.importKey(
            'raw',
            toBufferSource(new TextEncoder().encode(passphrase)),
            'PBKDF2',
            false,
            ['deriveKey'],
        );
        return crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: toBufferSource(salt),
                iterations,
                hash: VAULT_KDF.hash,
            },
            material,
            { name: VAULT_CIPHER.name, length: VAULT_CIPHER.keyBits },
            false, // non-extractable
            ['encrypt', 'decrypt'],
        );
    }

    // -- Public API --------------------------------------------------------

    /**
     * Create a new vault. Any existing vault is replaced.
     */
    async initializeVault(passphrase: string): Promise<void> {
        if (!passphrase) throw new Error('A passphrase is required to unlock the credential vault.');

        const salt = randomBytes(VAULT_KDF.saltBytes);
        const key = await this.deriveKey(passphrase, salt, VAULT_KDF.iterations);

        // Verifier: encrypting a known constant proves the passphrase later
        // without ever storing the passphrase itself.
        const verifierIv = randomBytes(VAULT_CIPHER.ivBytes);
        const verifier = await crypto.subtle.encrypt(
            { name: VAULT_CIPHER.name, iv: toBufferSource(verifierIv) },
            key,
            toBufferSource(new TextEncoder().encode(VAULT_VERIFIER_PLAINTEXT)),
        );

        const header: VaultHeader = {
            version: VAULT_FORMAT_VERSION,
            salt: bytesToBase64(salt),
            verifierIv: bytesToBase64(verifierIv),
            verifier: bytesToBase64(new Uint8Array(verifier)),
            kdf: { hash: VAULT_KDF.hash, iterations: VAULT_KDF.iterations },
        };

        await this.idbPut(header, VAULT_HEADER_KEY);
        // Drop any credentials from a previous vault, but keep the header.
        await this.idbClearRecords();

        this.vaultKey = key;
        this.unlocked = true;
    }

    /**
     * Unlock the vault with a passphrase.
     *
     * Returns false for a wrong passphrase, a missing vault, or a corrupted
     * header. It never throws so callers can present a single "wrong
     * passphrase or damaged vault" message.
     */
    async unlock(passphrase: string): Promise<boolean> {
        if (!passphrase) return false;
        try {
            const header = await this.idbGet<VaultHeader>(VAULT_HEADER_KEY);
            if (!header) return false;
            if (header.version !== VAULT_FORMAT_VERSION) return false;
            if (!header.salt || !header.verifierIv || !header.verifier) return false;

            const iterations = header.kdf?.iterations ?? VAULT_KDF.iterations;
            const key = await this.deriveKey(passphrase, base64ToBytes(header.salt), iterations);

            // AES-GCM authentication failure here means the wrong passphrase
            // (or a tampered header) — either way we must not unlock.
            await crypto.subtle.decrypt(
                { name: VAULT_CIPHER.name, iv: toBufferSource(base64ToBytes(header.verifierIv)) },
                key,
                toBufferSource(base64ToBytes(header.verifier)),
            );

            this.vaultKey = key;
            this.unlocked = true;
            return true;
        } catch {
            this.lock();
            return false;
        }
    }

    async getCredentials(providerId: ProviderId): Promise<ProviderConfig | null> {
        if (!this.isVaultUnlocked()) return null;
        try {
            const record = await this.idbGet<VaultRecord>(providerId);
            if (!record) return null;
            if (record.version !== VAULT_FORMAT_VERSION) return null;

            const plaintext = await crypto.subtle.decrypt(
                { name: VAULT_CIPHER.name, iv: toBufferSource(base64ToBytes(record.iv)) },
                this.vaultKey!,
                toBufferSource(base64ToBytes(record.ciphertext)),
            );
            return JSON.parse(new TextDecoder().decode(plaintext)) as ProviderConfig;
        } catch {
            // Corrupted record or wrong key: fail closed, never return
            // partially-decoded or plaintext-looking data.
            return null;
        }
    }

    async setCredentials(config: ProviderConfig): Promise<void> {
        if (!this.isVaultUnlocked()) {
            // Vault is locked: fall back to the session store so the key is
            // still usable for this session, but NOT persisted to disk.
            await sessionStore.setCredentials(config);
            return;
        }
        if (!config.rememberOnDevice) {
            // Explicitly session-only: remove any persisted copy.
            await this.removeCredentials(config.id);
            await sessionStore.setCredentials(config);
            return;
        }

        const header = await this.idbGet<VaultHeader>(VAULT_HEADER_KEY);
        if (!header) throw new Error('The credential vault is not initialized.');

        const iv = randomBytes(VAULT_CIPHER.ivBytes);
        const ciphertext = await crypto.subtle.encrypt(
            { name: VAULT_CIPHER.name, iv: toBufferSource(iv) },
            this.vaultKey!,
            toBufferSource(new TextEncoder().encode(JSON.stringify(config))),
        );

        const record: VaultRecord = {
            providerId: config.id,
            ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
            iv: bytesToBase64(iv),
            kdf: {
                hash: header.kdf?.hash ?? VAULT_KDF.hash,
                iterations: header.kdf?.iterations ?? VAULT_KDF.iterations,
                salt: header.salt,
            },
            version: VAULT_FORMAT_VERSION,
            updatedAt: Date.now(),
        };
        await this.idbPut(record, config.id);
        await sessionStore.setCredentials(config);
    }

    async removeCredentials(providerId: ProviderId): Promise<void> {
        await sessionStore.removeCredentials(providerId);
        try {
            await this.idbDelete(providerId);
        } catch {
            // Vault unavailable — the session copy is already gone.
        }
    }

    async getAllCredentials(): Promise<ProviderConfig[]> {
        const sessionCreds = await sessionStore.getAllCredentials();
        if (!this.isVaultUnlocked()) return sessionCreds;

        const out: ProviderConfig[] = [];
        try {
            const db = await this.openDb();
            const records = await new Promise<VaultRecord[]>((resolve, reject) => {
                const tx = db.transaction(VAULT_STORE_NAME, 'readonly');
                const request = tx.objectStore(VAULT_STORE_NAME).getAll();
                request.onsuccess = () => resolve((request.result as VaultRecord[]) ?? []);
                request.onerror = () => reject(request.error ?? new Error('Vault read failed.'));
            });
            for (const record of records) {
                if (!record || record.version !== VAULT_FORMAT_VERSION) continue;
                try {
                    const plaintext = await crypto.subtle.decrypt(
                        { name: VAULT_CIPHER.name, iv: toBufferSource(base64ToBytes(record.iv)) },
                        this.vaultKey!,
                        toBufferSource(base64ToBytes(record.ciphertext)),
                    );
                    out.push(JSON.parse(new TextDecoder().decode(plaintext)) as ProviderConfig);
                } catch {
                    // Skip corrupted records rather than failing the whole list.
                }
            }
        } catch {
            return sessionCreds;
        }

        const merged = new Map<ProviderId, ProviderConfig>();
        for (const c of sessionCreds) merged.set(c.id, c);
        for (const c of out) merged.set(c.id, c);
        return Array.from(merged.values());
    }

    async clear(): Promise<void> {
        await sessionStore.clear();
        try {
            await this.idbClear();
            await this.idbDelete(VAULT_HEADER_KEY);
        } catch {
            // nothing persisted to clear
        }
        this.lock();
    }
}

const VAULT_HEADER_KEY = '__vault_header__';
const VAULT_VERIFIER_PLAINTEXT = 'azemax-vault-v1';

export const sessionStore = new SessionCredentialStore();
export const encryptedStore = new EncryptedCredentialStore();

/** Default store: session-only. */
export const credentialStore: CredentialStore = sessionStore;

/**
 * Choose the store that matches the requested persistence policy.
 *
 * `rememberOnDevice: true` routes to the encrypted vault; everything else
 * stays in memory only.
 */
export function getStoreForConfig(config: ProviderConfig): CredentialStore {
    return config.rememberOnDevice ? encryptedStore : sessionStore;
}
