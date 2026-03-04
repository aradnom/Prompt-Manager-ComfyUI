"""
@author: solidstandingstone@pm.me
@title: ComfyUI Prompt Manager
@nickname: Prompt Manager
@description: Custom nodes for managing prompts in ComfyUI
"""

import subprocess
import sys
import importlib
from .nodes import PromptSelectorNode, SnapshotSelectorNode
from . import server  # Register server routes

def ensure_dependencies():
    requirements = {"requests": "requests", "dotenv": "python-dotenv"}
    for module_name, pip_name in requirements.items():
        try:
            importlib.import_module(module_name)
        except ImportError:
            print(f"[PromptManager] Installing missing dependency: {pip_name}")
            subprocess.check_call([sys.executable, "-m", "pip", "install", pip_name])

ensure_dependencies()

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
