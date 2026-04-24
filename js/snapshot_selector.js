import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { ensureKey, decrypt, subscribePairingStatus, PAIRING_STATUS, retryPairing, authedFetch } from "./pairing.js";

// Logging helpers - gated by ENABLE_LOGGING from .env via /prompt-manager/config
let _loggingEnabled = false;
function log(...args) { if (_loggingEnabled) console.log(...args); }
function warn(...args) { if (_loggingEnabled) console.warn(...args); }

// Cache for config
let config = null;

async function getConfig() {
    if (!config) {
        try {
            const response = await api.fetchApi("/prompt-manager/config");
            config = await response.json();
            _loggingEnabled = !!config.enable_logging;
        } catch (error) {
            console.error("[SnapshotSelector] Error loading config:", error);
            throw error;
        }
    }
    return config;
}

function getApiKey() {
    return app.ui.settings.getSettingValue("PromptManager.ApiKey", "");
}

function getAuthHeaders() {
    const apiKey = getApiKey();
    const headers = {};
    if (apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
    }
    return headers;
}

app.registerExtension({
    name: "PromptManager.SnapshotSelector",

    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== "PM_SnapshotSelector") return;

        log("[SnapshotSelector] Registering PM_SnapshotSelector extension");

        const onNodeCreated = nodeType.prototype.onNodeCreated;

        nodeType.prototype.onNodeCreated = function() {
            const result = onNodeCreated?.apply(this, arguments);

            // Lookup maps for label <-> display_id resolution
            this._labelToId = new Map();
            this._idToLabel = new Map();

            // Connection status
            this._connectionStatus = null;
            this.checkHeartbeat().catch(() => {});

            // Pairing status
            this._pairingStatus = PAIRING_STATUS.IDLE;
            const nodeRefP = this;
            this._unsubPairing = subscribePairingStatus((s) => {
                nodeRefP._pairingStatus = s;
                if (nodeRefP.pairButton) {
                    const shouldShow = (s === PAIRING_STATUS.FAILED);
                    nodeRefP.pairButton.hidden = !shouldShow;
                    nodeRefP.pairButton.computeSize = shouldShow
                        ? undefined
                        : () => [0, -4];
                }
                nodeRefP.setDirtyCanvas(true, true);
            });

            // Find the existing snapshot_content widget that Python created
            const contentWidget = this.widgets.find(w => w.name === "snapshot_content");
            if (contentWidget) {
                this.contentWidget = contentWidget;
            }

            // Add List All Snapshots button
            const listButton = this.addWidget("button", "List All Snapshots", null, () => {
                log("[SnapshotSelector] ===== LIST SNAPSHOTS BUTTON CLICKED =====");
                this.fetchSnapshots().catch(err => {
                    console.error("[SnapshotSelector] Error in fetchSnapshots:", err);
                });
            });

            // Add combo widget for snapshot selection
            const snapshotWidget = this.addWidget(
                "combo",
                "snapshot_selector",
                "",
                (value) => {
                    log("[SnapshotSelector] ===== SNAPSHOT SELECTED =====");
                    const displayId = this._labelToId.get(value) || value;
                    log("[SnapshotSelector] Selected snapshot:", value, "-> display_id:", displayId);
                    if (displayId) {
                        this.fetchSnapshotContent(displayId).catch(err => {
                            console.error("[SnapshotSelector] Error fetching snapshot content:", err);
                        });
                    }
                },
                { values: [] }
            );
            snapshotWidget.tooltip = "Manually select a snapshot to load";

            this.snapshotWidget = snapshotWidget;
            this.listButton = listButton;

            // Pair with Prompt Manager button — hidden unless pairing failed (denied)
            const pairButton = this.addWidget("button", "Pair with Prompt Manager", null, () => {
                log("[SnapshotSelector] ===== PAIR BUTTON CLICKED =====");
                retryPairing()
                    .then(() => {
                        this.fetchSnapshots().catch(err => console.error("[SnapshotSelector] Post-pair hydrate failed:", err));
                    })
                    .catch(err => log("[SnapshotSelector] Pair retry failed:", err));
            });
            pairButton.hidden = true;
            pairButton.computeSize = () => [0, -4];
            this.pairButton = pairButton;

            return result;
        };

        // onConfigure fires after saved widget values are restored
        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function() {
            const result = onConfigure?.apply(this, arguments);

            // Populate the snapshot list on startup
            this.fetchSnapshots().catch(err => {
                console.error("[SnapshotSelector] Error during startup hydration:", err);
            });

            return result;
        };

        // Heartbeat check
        nodeType.prototype.checkHeartbeat = async function() {
            try {
                const cfg = await getConfig();
                const response = await authedFetch(
                    `${cfg.api_url}/api/integrations/comfyui/heartbeat`,
                    { headers: getAuthHeaders() }
                );
                this._connectionStatus = response.ok;
            } catch (error) {
                this._connectionStatus = false;
            }
            this.setDirtyCanvas(true, true);
        };

        // Draw status dot in the title bar
        const onDrawForeground = nodeType.prototype.onDrawForeground;
        nodeType.prototype.onDrawForeground = function(ctx) {
            onDrawForeground?.apply(this, arguments);

            ctx.save();
            const dotRadius = 3;
            const y = -LiteGraph.NODE_TITLE_HEIGHT / 2;

            const pairing = this._pairingStatus;
            let label, color;
            if (pairing === PAIRING_STATUS.PAIRING) {
                label = "Pairing...";
                color = "#FFA726";
            } else if (this._connectionStatus === true) {
                label = "Connected";
                color = "#4CAF50";
            } else if (this._connectionStatus === false) {
                label = "Disconnected";
                color = "#F44336";
            } else {
                label = "Checking...";
                color = "#999";
            }

            ctx.font = "10px sans-serif";
            ctx.textAlign = "right";
            ctx.textBaseline = "middle";
            const textX = this.size[0] - dotRadius * 2 - 12;

            ctx.fillStyle = "#ccc";
            ctx.fillText(label, textX, y);

            ctx.fillStyle = color;

            ctx.beginPath();
            ctx.arc(this.size[0] - dotRadius - 8, y, dotRadius, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        };

        // Fetch snapshot content by display_id
        nodeType.prototype.fetchSnapshotContent = async function(displayId) {
            log("[SnapshotSelector] Fetching content for:", displayId);

            try {
                await ensureKey();
                const cfg = await getConfig();
                const url = `${cfg.api_url}/api/integrations/comfyui/snapshots/get?display_id=${encodeURIComponent(displayId)}`;
                const response = await authedFetch(url, { headers: getAuthHeaders() });
                const data = await response.json();

                if (data.prompt) {
                    const prompt = await decrypt(data.prompt);
                    if (this.contentWidget) {
                        this.contentWidget.value = prompt;
                        this.setDirtyCanvas(true, true);
                    }
                } else {
                    warn("[SnapshotSelector] No prompt in response");
                }
            } catch (error) {
                console.error("[SnapshotSelector] Error fetching snapshot content:", error);
            }
        };

        // Fetch snapshot list and populate combo
        nodeType.prototype.fetchSnapshots = async function() {
            log("[SnapshotSelector] ===== fetchSnapshots START =====");

            try {
                await ensureKey();
                const cfg = await getConfig();
                const url = `${cfg.api_url}/api/integrations/comfyui/snapshots/list`;
                const response = await authedFetch(url, { headers: getAuthHeaders() });
                const data = await response.json();

                if (data.snapshots && Array.isArray(data.snapshots)) {
                    log("[SnapshotSelector] Processing", data.snapshots.length, "snapshots");

                    // Decrypt names up front (display_id stays plaintext).
                    const decoded = await Promise.all(data.snapshots.map(async s => {
                        if (typeof s === "string") return s;
                        const name = s.name != null ? await decrypt(s.name) : null;
                        return { display_id: s.display_id, name };
                    }));

                    // Build label <-> display_id maps
                    this._labelToId = new Map();
                    this._idToLabel = new Map();

                    // Count name occurrences to detect duplicates
                    const nameCounts = new Map();
                    for (const s of decoded) {
                        const name = (typeof s === "object" && s.name) ? s.name : null;
                        if (name) {
                            nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
                        }
                    }

                    // Generate labels
                    const labels = decoded.map(s => {
                        if (typeof s === "string") {
                            this._labelToId.set(s, s);
                            this._idToLabel.set(s, s);
                            return s;
                        }

                        const { display_id, name } = s;
                        let label;
                        if (!name) {
                            label = display_id;
                        } else if (nameCounts.get(name) > 1) {
                            label = `${name} (${display_id})`;
                        } else {
                            label = name;
                        }

                        this._labelToId.set(label, display_id);
                        this._idToLabel.set(display_id, label);
                        return label;
                    });

                    if (this.snapshotWidget) {
                        this.snapshotWidget.options.values = labels;
                        this.snapshotWidget.value = labels[0] || "";

                        // Fetch content for the selected item
                        if (labels[0]) {
                            const firstId = this._labelToId.get(labels[0]) || labels[0];
                            this.fetchSnapshotContent(firstId).catch(err => {
                                console.error("[SnapshotSelector] Error fetching initial snapshot content:", err);
                            });
                        }

                        this.setDirtyCanvas(true, true);
                    }
                } else {
                    warn("[SnapshotSelector] No snapshots in response or invalid format");
                }
            } catch (error) {
                console.error("[SnapshotSelector] Error fetching snapshots:", error);
            }
        };
    },
});
