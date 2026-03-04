import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

// Logging helpers - gated by ENABLE_LOGGING from .env via /prompt-manager/config
let _loggingEnabled = false;
function log(...args) { if (_loggingEnabled) console.log(...args); }
function warn(...args) { if (_loggingEnabled) console.warn(...args); }

// Cache for config
let config = null;

async function getConfig() {
    if (!config) {
        try {
            log("[PromptManager] Fetching config from /prompt-manager/config");
            const response = await api.fetchApi("/prompt-manager/config");
            config = await response.json();
            _loggingEnabled = !!config.enable_logging;
            log("[PromptManager] Config loaded:", config);
        } catch (error) {
            console.error("[PromptManager] Error loading config:", error);
            throw error;
        }
    }
    return config;
}

// Helper to get API key from settings
function getApiKey() {
    const apiKey = app.ui.settings.getSettingValue("PromptManager.ApiKey", "");
    return apiKey;
}

// Helper to get headers with authorization
function getAuthHeaders() {
    const apiKey = getApiKey();
    const headers = {
        "Content-Type": "application/json"
    };

    if (apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
    }

    return headers;
}

app.registerExtension({
    name: "PromptManager.PromptSelector",

    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        log("[PromptManager] beforeRegisterNodeDef called for:", nodeData.name);

        if (nodeData.name === "PM_PromptSelector") {
            log("[PromptManager] Registering PM_PromptSelector extension");

            const onNodeCreated = nodeType.prototype.onNodeCreated;

            nodeType.prototype.onNodeCreated = function() {
                log("[PromptManager] onNodeCreated called");

                const result = onNodeCreated?.apply(this, arguments);

                log("[PromptManager] Node created, widgets:", this.widgets?.map(w => ({name: w.name, type: w.type})));

                // Lookup maps for label <-> display_id resolution
                this._labelToId = new Map();
                this._idToLabel = new Map();

                // Connection status: null = checking, true = connected, false = disconnected
                this._connectionStatus = null;
                this.checkHeartbeat().catch(() => {});

                // Find the existing prompt_content widget that Python created
                const contentWidget = this.widgets.find(w => w.name === "prompt_content");
                log("[PromptManager] Found prompt_content widget:", contentWidget);

                if (contentWidget) {
                    this.contentWidget = contentWidget;
                }

                // Find the use_active_prompt toggle widget that Python created
                const activeToggle = this.widgets.find(w => w.name === "use_active_prompt");
                if (activeToggle) {
                    this.activeToggleWidget = activeToggle;
                    this._activeDisplayId = null;

                    const nodeRef = this;
                    activeToggle.callback = (value) => {
                        log("[PromptManager] use_active_prompt toggled:", value);
                        nodeRef._updateActiveMode(value);
                        if (value) {
                            nodeRef.fetchActivePrompt().catch(err => {
                                console.error("[PromptManager] Error fetching active prompt:", err);
                            });
                        }
                    };
                }

                // Add Refresh Prompt button
                log("[PromptManager] Adding Refresh Prompt button");
                const refreshButton = this.addWidget("button", "Refresh Prompt", null, () => {
                    log("[PromptManager] ===== REFRESH PROMPT BUTTON CLICKED =====");
                    const isActive = this.activeToggleWidget?.value;
                    const comboValue = this.promptWidget?.value;
                    const targetId = isActive ? this._activeDisplayId : (this._labelToId.get(comboValue) || comboValue);
                    log("[PromptManager] Refresh target (active=" + isActive + "):", targetId);

                    if (targetId) {
                        this.fetchPromptContent(targetId).catch(err => {
                            console.error("[PromptManager] Error refreshing prompt:", err);
                        });
                    } else {
                        warn("[PromptManager] No prompt selected/active to refresh");
                    }
                });
                refreshButton.tooltip = "Manually refresh the prompt if automatic syncing fails";

                // Add divider between refresh/active controls and manual selection controls
                this.addCustomWidget({
                    name: "divider",
                    type: "divider",
                    value: null,
                    options: {},
                    computeSize: () => [0, 20],
                    serializeValue: () => undefined,
                    draw(ctx, node, width, y) {
                        ctx.strokeStyle = "#666";
                        ctx.beginPath();
                        ctx.moveTo(15, y + 10);
                        ctx.lineTo(width - 15, y + 10);
                        ctx.stroke();
                    },
                });

                // Add List Prompts button
                log("[PromptManager] Adding List Prompts button");
                const listButton = this.addWidget("button", "List All Prompts", null, () => {
                    log("[PromptManager] ===== LIST PROMPTS BUTTON CLICKED =====");
                    this.fetchPrompts().catch(err => {
                        console.error("[PromptManager] Error in fetchPrompts:", err);
                    });
                });

                // Add combo widget for prompt selection
                log("[PromptManager] Adding prompt combo widget");
                const promptWidget = this.addWidget(
                    "combo",
                    "prompt_selector",
                    "",
                    (value) => {
                        log("[PromptManager] ===== PROMPT SELECTED =====");
                        const displayId = this._labelToId.get(value) || value;
                        log("[PromptManager] Selected prompt:", value, "-> display_id:", displayId);
                        if (displayId) {
                            this.fetchPromptContent(displayId).catch(err => {
                                console.error("[PromptManager] Error fetching prompt content:", err);
                            });
                        }
                    },
                    { values: [] }
                );
                promptWidget.tooltip = "Manually select a prompt to load";

                this.promptWidget = promptWidget;
                this.listButton = listButton;

                // Enable/disable manual-mode widgets based on active prompt toggle
                this._updateActiveMode = function(isActive) {
                    if (this.listButton) {
                        this.listButton.disabled = isActive;
                    }
                    if (this.promptWidget) {
                        this.promptWidget.disabled = isActive;
                    }
                    this.setDirtyCanvas(true, true);
                };

                // Apply initial state for freshly created nodes
                if (this.activeToggleWidget) {
                    this._updateActiveMode(this.activeToggleWidget.value);
                }

                log("[PromptManager] Final widgets:", this.widgets.map(w => ({name: w.name, type: w.type})));

                return result;
            };

            // onConfigure fires after saved widget values are restored
            const onConfigure = nodeType.prototype.onConfigure;
            nodeType.prototype.onConfigure = function() {
                const result = onConfigure?.apply(this, arguments);

                if (this.activeToggleWidget) {
                    this._updateActiveMode(this.activeToggleWidget.value);
                }

                // Populate the prompt list, then fetch the active prompt's content
                this.fetchPrompts()
                    .then(() => this.fetchActivePrompt())
                    .catch(err => {
                        console.error("[PromptManager] Error during startup hydration:", err);
                    });

                return result;
            };

            // Add heartbeat check method
            nodeType.prototype.checkHeartbeat = async function() {
                try {
                    const cfg = await getConfig();
                    const apiUrl = cfg.api_url;
                    const headers = getAuthHeaders();
                    delete headers["Content-Type"];

                    const response = await fetch(`${apiUrl}/api/integrations/comfyui/heartbeat`, { headers });
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

                // Label
                const label = this._connectionStatus === true ? "Connected"
                    : this._connectionStatus === false ? "Disconnected"
                    : "Checking...";

                ctx.font = "10px sans-serif";
                ctx.textAlign = "right";
                ctx.textBaseline = "middle";
                const textX = this.size[0] - dotRadius * 2 - 12;

                ctx.fillStyle = "#ccc";
                ctx.fillText(label, textX, y);

                // Dot color
                if (this._connectionStatus === true) {
                    ctx.fillStyle = "#4CAF50";
                } else if (this._connectionStatus === false) {
                    ctx.fillStyle = "#F44336";
                } else {
                    ctx.fillStyle = "#999";
                }

                ctx.beginPath();
                ctx.arc(this.size[0] - dotRadius - 8, y, dotRadius, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            };

            // Add method to fetch the current active prompt
            nodeType.prototype.fetchActivePrompt = async function() {
                log("[PromptManager] ===== fetchActivePrompt START =====");

                try {
                    const cfg = await getConfig();
                    const apiUrl = cfg.api_url;

                    const url = `${apiUrl}/api/integrations/comfyui/prompts/active`;
                    log("[PromptManager] Fetching from:", url);

                    const headers = getAuthHeaders();
                    delete headers["Content-Type"];

                    const response = await fetch(url, { headers });
                    log("[PromptManager] Response status:", response.status);

                    const data = await response.json();
                    log("[PromptManager] Parsed data:", data);

                    const { display_id, prompt } = data;

                    this._activeDisplayId = display_id || null;

                    if (this.contentWidget) {
                        this.contentWidget.value = (prompt != null) ? prompt : "";
                        this.setDirtyCanvas(true, true);
                    }

                    if (this.promptWidget && display_id) {
                        const label = this._idToLabel.get(display_id) || display_id;
                        if (this.promptWidget.options.values.includes(label)) {
                            this.promptWidget.value = label;
                        }
                    }

                    log("[PromptManager] ===== fetchActivePrompt END =====");
                } catch (error) {
                    console.error("[PromptManager] ===== fetchActivePrompt ERROR =====");
                    console.error("[PromptManager] Error:", error);
                    console.error("[PromptManager] Stack:", error.stack);
                }
            };

            // Add method to fetch prompt content
            nodeType.prototype.fetchPromptContent = async function(displayId) {
                log("[PromptManager] ===== fetchPromptContent START =====");
                log("[PromptManager] Fetching content for:", displayId);

                try {
                    const cfg = await getConfig();
                    const apiUrl = cfg.api_url;

                    const url = `${apiUrl}/api/integrations/comfyui/prompts/get?user_id=1&display_id=${encodeURIComponent(displayId)}`;
                    log("[PromptManager] Fetching from:", url);

                    const headers = getAuthHeaders();
                    delete headers["Content-Type"]; // Not needed for GET request

                    const response = await fetch(url, { headers });
                    log("[PromptManager] Response status:", response.status);

                    const data = await response.json();
                    log("[PromptManager] Response data:", data);

                    if (data.prompt) {
                        log("[PromptManager] Got prompt content:", data.prompt.substring(0, 100) + "...");

                        // Update the content widget
                        if (this.contentWidget) {
                            this.contentWidget.value = data.prompt;
                            log("[PromptManager] Updated content widget");

                            // Force UI update
                            this.setDirtyCanvas(true, true);
                        } else {
                            console.error("[PromptManager] contentWidget not found!");
                        }
                    } else {
                        warn("[PromptManager] No prompt in response");
                    }

                    log("[PromptManager] ===== fetchPromptContent END =====");
                } catch (error) {
                    console.error("[PromptManager] ===== fetchPromptContent ERROR =====");
                    console.error("[PromptManager] Error:", error);
                    console.error("[PromptManager] Stack:", error.stack);
                }
            };

            // Add method to fetch prompts
            nodeType.prototype.fetchPrompts = async function() {
                log("[PromptManager] ===== fetchPrompts START =====");

                try {
                    const cfg = await getConfig();
                    const apiUrl = cfg.api_url;

                    log("[PromptManager] Using API URL:", apiUrl);

                    const url = `${apiUrl}/api/integrations/comfyui/prompts/list?user_id=1`;
                    log("[PromptManager] Fetching from:", url);

                    const headers = getAuthHeaders();
                    delete headers["Content-Type"]; // Not needed for GET request

                    const response = await fetch(url, { headers });
                    log("[PromptManager] Response status:", response.status);

                    const data = await response.json();
                    log("[PromptManager] Response data:", data);

                    if (data.prompts && Array.isArray(data.prompts)) {
                        log("[PromptManager] Processing", data.prompts.length, "prompts");

                        // Build label <-> display_id maps
                        this._labelToId = new Map();
                        this._idToLabel = new Map();

                        // Count name occurrences to detect duplicates
                        const nameCounts = new Map();
                        for (const p of data.prompts) {
                            const name = (typeof p === "object" && p.name) ? p.name : null;
                            if (name) {
                                nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
                            }
                        }

                        // Generate labels
                        const labels = data.prompts.map(p => {
                            // Support both old format (plain strings) and new format (objects)
                            if (typeof p === "string") {
                                this._labelToId.set(p, p);
                                this._idToLabel.set(p, p);
                                return p;
                            }

                            const { display_id, name } = p;
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

                        // Update the combo widget with labels
                        if (this.promptWidget) {
                            log("[PromptManager] Updating combo widget");
                            this.promptWidget.options.values = labels;
                            this.promptWidget.value = labels[0] || "";

                            // Fetch content for the selected item (skip if active mode
                            // is on — active prompt content is handled separately)
                            if (labels[0] && !this.activeToggleWidget?.value) {
                                const firstId = this._labelToId.get(labels[0]) || labels[0];
                                this.fetchPromptContent(firstId).catch(err => {
                                    console.error("[PromptManager] Error fetching initial prompt content:", err);
                                });
                            }

                            log("[PromptManager] Widget updated:", {
                                values: this.promptWidget.options.values,
                                value: this.promptWidget.value
                            });

                            this.setDirtyCanvas(true, true);
                        } else {
                            console.error("[PromptManager] promptWidget not found!");
                        }
                    } else {
                        warn("[PromptManager] No prompts in response or invalid format");
                    }

                    log("[PromptManager] ===== fetchPrompts END =====");
                } catch (error) {
                    console.error("[PromptManager] ===== fetchPrompts ERROR =====");
                    console.error("[PromptManager] Error:", error);
                    console.error("[PromptManager] Stack:", error.stack);
                }
            };

            log("[PromptManager] Extension setup complete");
        }
    },

    async setup() {
        // Register setting for API Key
        app.ui.settings.addSetting({
            id: "PromptManager.ApiKey",
            name: "Prompt Manager API Key",
            type: "text",
            defaultValue: "",
            onChange: (value) => {
                log("[PromptManager] API Key setting changed");
            }
        });

        // Set up Server-Sent Events (SSE) connection to Prompt Manager
        log("[PromptManager] Setting up SSE connection");

        try {
            const cfg = await getConfig();
            const apiUrl = cfg.api_url;
            const apiKey = getApiKey();

            // EventSource doesn't support custom headers, so pass token as query param
            let sseUrl = `${apiUrl}/api/integrations/comfyui/events`;
            if (apiKey) {
                sseUrl += `?token=${encodeURIComponent(apiKey)}`;
            }

            log("[PromptManager] Connecting to SSE endpoint:", sseUrl.replace(/token=[^&]+/, 'token=***'));

            const eventSource = new EventSource(sseUrl);

            eventSource.onopen = () => {
                log("[PromptManager] SSE connection established");
            };

            eventSource.addEventListener("stackUpdate", (event) => {
                log("[PromptManager] ===== RECEIVED stackUpdate EVENT =====");
                log("[PromptManager] Raw event data:", event.data);

                try {
                    const data = JSON.parse(event.data);
                    log("[PromptManager] Parsed data:", data);

                    const { display_id, prompt } = data;

                    if (!display_id) {
                        warn("[PromptManager] No display_id in event");
                        return;
                    }

                    // Find all PromptSelector nodes in the graph
                    const nodes = app.graph._nodes.filter(n => n.type === "PM_PromptSelector");
                    log("[PromptManager] Found", nodes.length, "PromptSelector nodes");

                    // Update matching nodes
                    nodes.forEach(node => {
                        const isActive = node.activeToggleWidget?.value;

                        if (isActive) {
                            // Active mode: update if this stack is the active one
                            if (node._activeDisplayId && node._activeDisplayId === display_id) {
                                log("[PromptManager] Updating active-mode node (stack content changed)");
                                if (node.contentWidget) {
                                    node.contentWidget.value = prompt || "";
                                    node.setDirtyCanvas(true, true);
                                }
                            }
                        } else {
                            // Manual mode: update if this stack is selected
                            const selectedId = node._labelToId?.get(node.promptWidget?.value) || node.promptWidget?.value;
                            if (selectedId === display_id) {
                                log("[PromptManager] Updating manual-mode node with new content");
                                if (node.contentWidget) {
                                    node.contentWidget.value = prompt || "";
                                    node.setDirtyCanvas(true, true);
                                }
                            }
                        }
                    });
                } catch (error) {
                    console.error("[PromptManager] Error parsing SSE message:", error);
                }
            });

            eventSource.addEventListener("activeStackChanged", (event) => {
                log("[PromptManager] ===== RECEIVED activeStackChanged EVENT =====");
                log("[PromptManager] Raw event data:", event.data);

                try {
                    const data = JSON.parse(event.data);
                    const { display_id, prompt } = data;

                    const nodes = app.graph._nodes.filter(n => n.type === "PM_PromptSelector");

                    nodes.forEach(node => {
                        if (!node.activeToggleWidget?.value) return;

                        // Track the active stack's display_id for stackUpdate cross-referencing
                        node._activeDisplayId = display_id || null;

                        if (node.contentWidget) {
                            node.contentWidget.value = (prompt != null) ? prompt : "";
                            node.setDirtyCanvas(true, true);
                        }

                        // Sync the combo display if the display_id is in its list
                        if (node.promptWidget && display_id) {
                            const label = node._idToLabel?.get(display_id) || display_id;
                            if (node.promptWidget.options.values.includes(label)) {
                                node.promptWidget.value = label;
                            }
                        }
                    });
                } catch (error) {
                    console.error("[PromptManager] Error parsing activeStackChanged event:", error);
                }
            });

            eventSource.onerror = (error) => {
                console.error("[PromptManager] SSE connection error:", error);
                log("[PromptManager] SSE readyState:", eventSource.readyState);

                if (eventSource.readyState === EventSource.CLOSED) {
                    log("[PromptManager] SSE connection closed, will attempt reconnect");
                }
            };

            // Store reference for potential cleanup
            window.promptManagerSSE = eventSource;

            log("[PromptManager] SSE listener registered");
        } catch (error) {
            console.error("[PromptManager] Failed to set up SSE connection:", error);
        }
    }
});
