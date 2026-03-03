import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

console.log("[PromptManager] Extension script loaded");

// Cache for config
let config = null;

async function getConfig() {
    if (!config) {
        try {
            console.log("[PromptManager] Fetching config from /prompt-manager/config");
            const response = await api.fetchApi("/prompt-manager/config");
            config = await response.json();
            console.log("[PromptManager] Config loaded:", config);
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
        console.log("[PromptManager] beforeRegisterNodeDef called for:", nodeData.name);

        if (nodeData.name === "PM_PromptSelector") {
            console.log("[PromptManager] Registering PM_PromptSelector extension");

            const onNodeCreated = nodeType.prototype.onNodeCreated;

            nodeType.prototype.onNodeCreated = function() {
                console.log("[PromptManager] onNodeCreated called");

                const result = onNodeCreated?.apply(this, arguments);

                console.log("[PromptManager] Node created, widgets:", this.widgets?.map(w => ({name: w.name, type: w.type})));

                // Find the existing prompt_content widget that Python created
                const contentWidget = this.widgets.find(w => w.name === "prompt_content");
                console.log("[PromptManager] Found prompt_content widget:", contentWidget);

                if (contentWidget) {
                    this.contentWidget = contentWidget;
                }

                // Add button widget
                console.log("[PromptManager] Adding List Prompts button");
                const listButton = this.addWidget("button", "List Prompts", null, () => {
                    console.log("[PromptManager] ===== LIST PROMPTS BUTTON CLICKED =====");
                    this.fetchPrompts().catch(err => {
                        console.error("[PromptManager] Error in fetchPrompts:", err);
                    });
                });

                // Add Refresh Prompt button
                console.log("[PromptManager] Adding Refresh Prompt button");
                const refreshButton = this.addWidget("button", "Refresh Prompt", null, () => {
                    console.log("[PromptManager] ===== REFRESH PROMPT BUTTON CLICKED =====");
                    const selectedPrompt = this.promptWidget?.value;
                    console.log("[PromptManager] Selected prompt:", selectedPrompt);

                    if (selectedPrompt) {
                        this.fetchPromptContent(selectedPrompt).catch(err => {
                            console.error("[PromptManager] Error refreshing prompt:", err);
                        });
                    } else {
                        console.warn("[PromptManager] No prompt selected to refresh");
                    }
                });

                // Add combo widget for prompt selection
                console.log("[PromptManager] Adding prompt combo widget");
                const promptWidget = this.addWidget(
                    "combo",
                    "prompt_selector",
                    "",
                    (value) => {
                        console.log("[PromptManager] ===== PROMPT SELECTED =====");
                        console.log("[PromptManager] Selected prompt:", value);
                        if (value) {
                            this.fetchPromptContent(value).catch(err => {
                                console.error("[PromptManager] Error fetching prompt content:", err);
                            });
                        }
                    },
                    { values: [] }
                );

                this.promptWidget = promptWidget;

                console.log("[PromptManager] Final widgets:", this.widgets.map(w => ({name: w.name, type: w.type})));

                return result;
            };

            // Add method to fetch prompt content
            nodeType.prototype.fetchPromptContent = async function(displayId) {
                console.log("[PromptManager] ===== fetchPromptContent START =====");
                console.log("[PromptManager] Fetching content for:", displayId);

                try {
                    const cfg = await getConfig();
                    const apiUrl = cfg.api_url;

                    const url = `${apiUrl}/api/integrations/comfyui/prompts/get?user_id=1&display_id=${encodeURIComponent(displayId)}`;
                    console.log("[PromptManager] Fetching from:", url);

                    const headers = getAuthHeaders();
                    delete headers["Content-Type"]; // Not needed for GET request

                    const response = await fetch(url, { headers });
                    console.log("[PromptManager] Response status:", response.status);

                    const data = await response.json();
                    console.log("[PromptManager] Response data:", data);

                    if (data.prompt) {
                        console.log("[PromptManager] Got prompt content:", data.prompt.substring(0, 100) + "...");

                        // Update the content widget
                        if (this.contentWidget) {
                            this.contentWidget.value = data.prompt;
                            console.log("[PromptManager] Updated content widget");

                            // Force UI update
                            this.setDirtyCanvas(true, true);
                        } else {
                            console.error("[PromptManager] contentWidget not found!");
                        }
                    } else {
                        console.warn("[PromptManager] No prompt in response");
                    }

                    console.log("[PromptManager] ===== fetchPromptContent END =====");
                } catch (error) {
                    console.error("[PromptManager] ===== fetchPromptContent ERROR =====");
                    console.error("[PromptManager] Error:", error);
                    console.error("[PromptManager] Stack:", error.stack);
                }
            };

            // Add method to fetch prompts
            nodeType.prototype.fetchPrompts = async function() {
                console.log("[PromptManager] ===== fetchPrompts START =====");

                try {
                    const cfg = await getConfig();
                    const apiUrl = cfg.api_url;

                    console.log("[PromptManager] Using API URL:", apiUrl);

                    const url = `${apiUrl}/api/integrations/comfyui/prompts/list?user_id=1`;
                    console.log("[PromptManager] Fetching from:", url);

                    const headers = getAuthHeaders();
                    delete headers["Content-Type"]; // Not needed for GET request

                    const response = await fetch(url, { headers });
                    console.log("[PromptManager] Response status:", response.status);

                    const data = await response.json();
                    console.log("[PromptManager] Response data:", data);

                    if (data.prompts && Array.isArray(data.prompts)) {
                        console.log("[PromptManager] Processing", data.prompts.length, "prompts");

                        // Update the combo widget with the prompt list
                        if (this.promptWidget) {
                            console.log("[PromptManager] Updating combo widget");
                            this.promptWidget.options.values = data.prompts;
                            this.promptWidget.value = data.prompts[0] || "";

                            console.log("[PromptManager] Widget updated:", {
                                values: this.promptWidget.options.values,
                                value: this.promptWidget.value
                            });

                            // Force UI update
                            console.log("[PromptManager] Forcing canvas update");
                            this.setDirtyCanvas(true, true);
                        } else {
                            console.error("[PromptManager] promptWidget not found!");
                        }
                    } else {
                        console.warn("[PromptManager] No prompts in response or invalid format");
                    }

                    console.log("[PromptManager] ===== fetchPrompts END =====");
                } catch (error) {
                    console.error("[PromptManager] ===== fetchPrompts ERROR =====");
                    console.error("[PromptManager] Error:", error);
                    console.error("[PromptManager] Stack:", error.stack);
                }
            };

            console.log("[PromptManager] Extension setup complete");
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
                console.log("[PromptManager] API Key setting changed");
            }
        });

        // Set up Server-Sent Events (SSE) connection to Prompt Manager
        console.log("[PromptManager] Setting up SSE connection");

        try {
            const cfg = await getConfig();
            const apiUrl = cfg.api_url;
            const apiKey = getApiKey();

            // EventSource doesn't support custom headers, so pass token as query param
            let sseUrl = `${apiUrl}/api/integrations/comfyui/events`;
            if (apiKey) {
                sseUrl += `?token=${encodeURIComponent(apiKey)}`;
            }

            console.log("[PromptManager] Connecting to SSE endpoint:", sseUrl.replace(/token=[^&]+/, 'token=***'));

            const eventSource = new EventSource(sseUrl);

            eventSource.onopen = () => {
                console.log("[PromptManager] SSE connection established");
            };

            eventSource.addEventListener("stackUpdate", (event) => {
                console.log("[PromptManager] ===== RECEIVED stackUpdate EVENT =====");
                console.log("[PromptManager] Raw event data:", event.data);

                try {
                    const data = JSON.parse(event.data);
                    console.log("[PromptManager] Parsed data:", data);

                    const { display_id, prompt } = data;

                    if (!display_id) {
                        console.warn("[PromptManager] No display_id in event");
                        return;
                    }

                    // Find all PromptSelector nodes in the graph
                    const nodes = app.graph._nodes.filter(n => n.type === "PM_PromptSelector");
                    console.log("[PromptManager] Found", nodes.length, "PromptSelector nodes");

                    // Update any nodes that have this prompt selected
                    nodes.forEach(node => {
                        const selectedPrompt = node.promptWidget?.value;
                        console.log("[PromptManager] Node has prompt:", selectedPrompt);

                        if (selectedPrompt === display_id) {
                            console.log("[PromptManager] Updating node with new content");

                            // Update the content widget
                            if (node.contentWidget) {
                                node.contentWidget.value = prompt || "";
                                console.log("[PromptManager] Content updated");

                                // Force UI update
                                node.setDirtyCanvas(true, true);
                            }
                        }
                    });
                } catch (error) {
                    console.error("[PromptManager] Error parsing SSE message:", error);
                }
            });

            eventSource.onerror = (error) => {
                console.error("[PromptManager] SSE connection error:", error);
                console.log("[PromptManager] SSE readyState:", eventSource.readyState);

                if (eventSource.readyState === EventSource.CLOSED) {
                    console.log("[PromptManager] SSE connection closed, will attempt reconnect");
                }
            };

            // Store reference for potential cleanup
            window.promptManagerSSE = eventSource;

            console.log("[PromptManager] SSE listener registered");
        } catch (error) {
            console.error("[PromptManager] Failed to set up SSE connection:", error);
        }
    }
});
