"""
Pairing support for Prompt Manager's encrypted content.

Stores the derived key returned by the PM pair flow in a local `.pm_key` file
so the frontend can decrypt incoming prompt content without re-pairing on every
reload. Also exposes basic host info used to build the pair-request fingerprint.
"""

import os
import socket
import platform

KEY_FILE = os.path.join(os.path.dirname(__file__), ".pm_key")


def read_key():
    if not os.path.exists(KEY_FILE):
        return None
    try:
        with open(KEY_FILE, "r") as f:
            key = f.read().strip()
        return key or None
    except Exception as e:
        print(f"[PromptManager] Error reading key file: {e}")
        return None


def write_key(key):
    with open(KEY_FILE, "w") as f:
        f.write(key)
    try:
        os.chmod(KEY_FILE, 0o600)
    except Exception:
        pass


def delete_key():
    if os.path.exists(KEY_FILE):
        try:
            os.remove(KEY_FILE)
        except Exception as e:
            print(f"[PromptManager] Error deleting key file: {e}")


def get_host_info():
    try:
        host = socket.gethostname()
    except Exception:
        host = "unknown"
    try:
        plat = platform.system()
    except Exception:
        plat = "unknown"
    return {"host": host, "platform": plat}
