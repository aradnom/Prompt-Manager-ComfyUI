from .api_client import PromptManagerAPI


class PromptSelectorNode:
    """Fetches and displays available prompts from Prompt Manager"""

    def __init__(self):
        self.api = PromptManagerAPI()

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "use_active_prompt": ("BOOLEAN", {
                    "default": False,
                    "tooltip": "If checked, will always stay in sync with the current active prompt in the Prompt Manager",
                }),
                "prompt_content": ("STRING", {
                    "multiline": True,
                    "default": ""
                }),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    FUNCTION = "execute"
    CATEGORY = "PromptManager"
    DESCRIPTION = "Select and fetch prompts from Prompt Manager"

    def execute(self, use_active_prompt, prompt_content):
        """Output the prompt content"""
        print(f"[PromptManager] Execute called with prompt_content: '{prompt_content[:100] if prompt_content else '(empty)'}...'")

        # Simply return whatever is in the prompt_content field
        return (prompt_content,)


class SnapshotSelectorNode:
    """Fetches and displays available snapshots from Prompt Manager"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "snapshot_content": ("STRING", {
                    "multiline": True,
                    "default": ""
                }),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    FUNCTION = "execute"
    CATEGORY = "PromptManager"
    DESCRIPTION = "Select and fetch snapshots from Prompt Manager"

    def execute(self, snapshot_content):
        """Output the snapshot content"""
        return (snapshot_content,)
