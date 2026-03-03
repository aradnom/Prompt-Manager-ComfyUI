"""
@author: Your Name
@title: ComfyUI Prompt Manager
@nickname: Prompt Manager
@description: Custom nodes for managing prompts in ComfyUI
"""

from .nodes import PromptSelectorNode, SnapshotSelectorNode
from . import server  # Register server routes

NODE_CLASS_MAPPINGS = {
    "PM_PromptSelector": PromptSelectorNode,
    "PM_SnapshotSelector": SnapshotSelectorNode,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "PM_PromptSelector": "Prompt Selector (Prompt Manager)",
    "PM_SnapshotSelector": "Snapshot Selector (Prompt Manager)",
}

WEB_DIRECTORY = "./js"

__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS', 'WEB_DIRECTORY']
