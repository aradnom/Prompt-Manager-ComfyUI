import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

// Centralized pairing + decryption for Prompt Manager nodes.
//
// Flow:
//  1. ensureKey() checks locally cached derived key via GET /prompt-manager/key.
//  2. If missing, POST /api/integrations/comfyui/pair with a short fingerprint.
//     The request long-polls up to ~60s while the PM client prompts the user.
//  3. On success, key is saved locally via POST /prompt-manager/key.
//  4. On timeout/denial, a random 2-8s jitter is applied before retrying so
//     multiple instances don't stampede the server.
//
// A single in-flight pair attempt is shared across all callers.

let _config = null;
let _loggingEnabled = false;
function log(...args) { if (_loggingEnabled) console.log("[Pairing]", ...args); }
function warn(...args) { if (_loggingEnabled) console.warn("[Pairing]", ...args); }

async function getConfig() {
    if (!_config) {
        const response = await api.fetchApi("/prompt-manager/config");
        _config = await response.json();
        _loggingEnabled = !!_config.enable_logging;
    }
    return _config;
}

function getApiKey() {
    return app.ui.settings.getSettingValue("PromptManager.ApiKey", "");
}

// --- Status pub/sub (for node status dots) -----------------------------------

const STATUS = { IDLE: "idle", PAIRING: "pairing", PAIRED: "paired", FAILED: "failed" };
let _status = STATUS.IDLE;
const _statusListeners = new Set();

function setStatus(s) {
    if (_status === s) return;
    _status = s;
    for (const cb of _statusListeners) {
        try { cb(s); } catch (e) { console.error("[Pairing] status listener error:", e); }
    }
}

export function getPairingStatus() { return _status; }
export function subscribePairingStatus(cb) {
    _statusListeners.add(cb);
    try { cb(_status); } catch (e) { console.error(e); }
    return () => _statusListeners.delete(cb);
}
export { STATUS as PAIRING_STATUS };

// --- Key management ----------------------------------------------------------

let _cachedKey = null;
let _cryptoKeyPromise = null;

async function readLocalKey() {
    try {
        const r = await api.fetchApi("/prompt-manager/key");
        const data = await r.json();
        return data.key || null;
    } catch (e) {
        warn("readLocalKey failed:", e);
        return null;
    }
}

async function saveLocalKey(key) {
    await api.fetchApi("/prompt-manager/key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
    });
}

export async function clearKey() {
    _cachedKey = null;
    _cryptoKeyPromise = null;
    try {
        await api.fetchApi("/prompt-manager/key", { method: "DELETE" });
    } catch (e) { warn("clearKey failed:", e); }
    setStatus(STATUS.IDLE);
}

function buildFingerprint(cfg, apiKey) {
    const host = cfg.host || "unknown";
    const plat = cfg.platform || "unknown";
    const keyPrefix = apiKey ? apiKey.slice(0, 6) : "none";
    const fp = `ComfyUI | host=${host} | platform=${plat} | api=${keyPrefix}`;
    return fp.length > 200 ? fp.slice(0, 200) : fp;
}

function jitterDelay() {
    return 2000 + Math.random() * 6000; // 2-8s
}

async function requestPairOnce() {
    const cfg = await getConfig();
    const apiKey = getApiKey();
    const fingerprint = buildFingerprint(cfg, apiKey);

    const headers = { "Content-Type": "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    log("sending pair request, fingerprint:", fingerprint);
    const response = await fetch(`${cfg.api_url}/api/integrations/comfyui/pair`, {
        method: "POST",
        headers,
        body: JSON.stringify({ fingerprint }),
    });

    if (response.status === 401) {
        let code = null;
        try { code = (await response.clone().json())?.code || null; } catch (_) {}
        const err = new PairingAuthError();
        err.code = code;
        throw err;
    }
    if (!response.ok) {
        throw new Error(`pair request failed: HTTP ${response.status}`);
    }

    return response.json();
}

// ComfyUI's extensionManager.toast isn't available during early extension
// setup — queue and retry until it is.
const _toastQueue = [];
let _toastFlushTimer = null;
function flushToasts() {
    const t = app.extensionManager?.toast;
    if (!t?.add) return false;
    while (_toastQueue.length) {
        const opts = _toastQueue.shift();
        try { t.add(opts); } catch (e) { warn("toast failed:", e); }
    }
    return true;
}
function showToast(opts) {
    _toastQueue.push(opts);
    if (flushToasts()) return;
    if (_toastFlushTimer) return;
    let attempts = 0;
    _toastFlushTimer = setInterval(() => {
        attempts++;
        if (flushToasts() || attempts > 40) {
            clearInterval(_toastFlushTimer);
            _toastFlushTimer = null;
        }
    }, 250); // up to ~10s of retry
}

const _AUTH_MESSAGES = {
    missing_token: "No API key configured. Add one under Settings → Prompt Manager.",
    invalid_token: "API key is invalid. Generate new credentials on prompts.rodeo/account and paste them into Settings → Prompt Manager.",
    revoked_token: "API key has been revoked. Generate new credentials on prompts.rodeo/account and paste them into Settings → Prompt Manager.",
};
const _AUTH_DEFAULT = "API key rejected. Generate new credentials on prompts.rodeo/account and paste them into Settings → Prompt Manager.";

// Drop-in replacement for fetch() that surfaces 401 responses as a user-facing
// toast. Returns the raw Response for the caller to handle normally.
export async function authedFetch(url, init) {
    const response = await fetch(url, init);
    if (response.status === 401) {
        let code = null;
        try { code = (await response.clone().json())?.code || null; } catch (_) {}
        showAuthErrorToast(code);
    }
    return response;
}

let _lastAuthToastAt = 0;
export function showAuthErrorToast(code) {
    // Throttle so a burst of 401s doesn't spam the user.
    const now = Date.now();
    if (now - _lastAuthToastAt < 5000) return;
    _lastAuthToastAt = now;
    showToast({
        severity: "error",
        summary: "Prompt Manager",
        detail: _AUTH_MESSAGES[code] || _AUTH_DEFAULT,
    });
}

class PairingDeniedError extends Error {
    constructor() { super("Pairing denied by user"); this.name = "PairingDeniedError"; }
}

class PairingAbortError extends Error {
    constructor(msg) { super(msg); this.name = "PairingAbortError"; }
}

class PairingAuthError extends Error {
    constructor() { super("Invalid or missing API key"); this.name = "PairingAuthError"; }
}

let _pairingPromise = null;

async function runPairingLoop() {
    setStatus(STATUS.PAIRING);
    while (true) {
        try {
            const result = await requestPairOnce();
            if (result.ok && result.derivedKey) {
                _cachedKey = result.derivedKey;
                await saveLocalKey(result.derivedKey);
                setStatus(STATUS.PAIRED);
                showToast({
                    severity: "success",
                    summary: "Prompt Manager",
                    detail: "Pairing successful.",
                    life: 4000,
                });
                return result.derivedKey;
            }
            if (result.reason === "denied") {
                log("pair attempt denied - stopping");
                setStatus(STATUS.FAILED);
                showToast({
                    severity: "error",
                    summary: "Prompt Manager",
                    detail: "Pairing denied. Click Pair with Prompt Manager to try again.",
                });
                throw new PairingDeniedError();
            }
            // Default (incl. reason: "timeout"): notify and retry
            log("pair attempt unsuccessful:", result.reason, "- retrying");
            showToast({
                severity: "warn",
                summary: "Prompt Manager",
                detail: "Pairing request timed out. Retrying...",
                life: 4000,
            });
        } catch (e) {
            if (e instanceof PairingDeniedError) throw e;
            if (e instanceof PairingAuthError) {
                log("pair attempt rejected - bad API key (code=" + e.code + ")");
                setStatus(STATUS.FAILED);
                showAuthErrorToast(e.code);
                throw e;
            }
            // Server error or network failure — stop the loop and wait for the
            // user to retry via the Pair button rather than hammering.
            warn("pair attempt errored:", e);
            setStatus(STATUS.FAILED);
            showToast({
                severity: "error",
                summary: "Prompt Manager",
                detail: "Couldn't reach Prompt Manager. Click Pair with Prompt Manager to try again.",
            });
            throw new PairingAbortError(String(e));
        }
        await new Promise(r => setTimeout(r, jitterDelay()));
    }
}

export async function ensureKey() {
    if (_cachedKey) return _cachedKey;

    const local = await readLocalKey();
    if (local) {
        _cachedKey = local;
        setStatus(STATUS.PAIRED);
        return local;
    }

    // If a previous attempt ended in FAILED (denial), don't auto-retry here —
    // wait for an explicit retryPairing() call (e.g. Pair button click).
    if (_status === STATUS.FAILED) {
        throw new Error("Pairing required — user action needed");
    }

    if (!_pairingPromise) {
        _pairingPromise = runPairingLoop().finally(() => {
            _pairingPromise = null;
        });
    }
    return _pairingPromise;
}

// Kicks off a new pairing attempt from the FAILED state (Pair button).
export async function retryPairing() {
    if (_pairingPromise) return _pairingPromise;
    setStatus(STATUS.IDLE);
    return ensureKey();
}

// --- Decryption --------------------------------------------------------------

function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

async function getCryptoKey() {
    if (!_cryptoKeyPromise) {
        _cryptoKeyPromise = (async () => {
            const raw = await ensureKey();
            return crypto.subtle.importKey(
                "raw", b64ToBytes(raw), { name: "AES-GCM" }, false, ["decrypt"]
            );
        })();
    }
    return _cryptoKeyPromise;
}

function isEnvelope(v) {
    return v && typeof v === "object"
        && typeof v.iv === "string"
        && typeof v.authTag === "string"
        && typeof v.ciphertext === "string";
}

// Decrypts an envelope to a string. Returns null for null/undefined inputs.
// If the value isn't an envelope, returns it unchanged (for backward compat
// during the encryption rollout). Always returns a string on success.
export async function decrypt(value) {
    if (value == null) return value;
    // Envelopes may arrive as JSON-stringified objects — try to parse.
    if (typeof value === "string") {
        const trimmed = value.trimStart();
        if (trimmed.startsWith("{")) {
            try {
                const parsed = JSON.parse(value);
                if (isEnvelope(parsed)) value = parsed;
            } catch (_) { /* not JSON, fall through as plain string */ }
        }
    }
    if (!isEnvelope(value)) return value;

    const key = await getCryptoKey();
    const iv = b64ToBytes(value.iv);
    const ct = b64ToBytes(value.ciphertext);
    const tag = b64ToBytes(value.authTag);

    // WebCrypto expects ciphertext || authTag concatenated.
    const combined = new Uint8Array(ct.length + tag.length);
    combined.set(ct, 0);
    combined.set(tag, ct.length);

    try {
        const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, combined);
        return new TextDecoder().decode(plain);
    } catch (e) {
        console.error("[Pairing] decryption failed:", e);
        throw e;
    }
}
