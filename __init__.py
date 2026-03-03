"""
@author: Your Name
@title: ComfyUI Prompt Manager
@nickname: Prompt Manager
@description: Custom nodes for managing prompts in ComfyUI
"""

from .nodes import TextInputNode, PromptSelectorNode
from . import server  # Register server routes

NODE_CLASS_MAPPINGS = {
    "PM_TextInput": TextInputNode,
    "PM_PromptSelector": PromptSelectorNode,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "PM_TextInput": "Text Input (PM)",
    "PM_PromptSelector": "Prompt Selector (Prompt Manager)",
}

WEB_DIRECTORY = "./js"

__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS', 'WEB_DIRECTORY']
