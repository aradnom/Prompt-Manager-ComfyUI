# Prompt Manager nodes for ComfyUI

Custom nodes for integrating [Prompt Manager](https://prompts.rodeo) with ComfyUI. Allows for prompts from the Prompt Manager to be piped directly into ComfyUI with automatic syncing as prompts are changed.

Provides two nodes:

- Prompt Selector: allows individual prompts to be selected and loaded. Also has a toggle to stay in sync with whichever prompt is currently active in the Prompt Manager.
- Snapshot Selector: allows prompt snapshots to be selected and loaded.

Both nodes will load in string values which can then be connected to anything that can take a string input (CLIP node, T5 node, etc.).

![Usage Example](./images/usage.png)

## Installation

Dependencies (`requests`, `python-dotenv`) should install automatically when ComfyUI loads the extension for the first time. If that doesn't work for some reason, you can install them manually:

```bash
cd ComfyUI/custom_nodes/Prompt-Manager-ComfyUI
pip install -r requirements.txt
```
