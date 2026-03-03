from .api_client import PromptManagerAPI


class TextInputNode:
    """A simple text input node that outputs the entered string"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "text": ("STRING", {
                    "default": "",
                    "multiline": True,
                    "placeholder": "Enter your text here..."
                }),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    FUNCTION = "execute"
    CATEGORY = "PromptManager"
    DESCRIPTION = "A simple text input node that outputs the entered string"

    def execute(self, text):
        """Returns the input text as output"""
        return (text,)


class PromptSelectorNode:
    """Fetches and displays available prompts from Prompt Manager"""

    def __init__(self):
        self.api = PromptManagerAPI()

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
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

    def execute(self, prompt_content):
        """Output the prompt content"""
        print(f"[PromptManager] Execute called with prompt_content: '{prompt_content[:100] if prompt_content else '(empty)'}...'")

        # Simply return whatever is in the prompt_content field
        return (prompt_content,)
