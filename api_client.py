import requests
from .config import API_URL

class PromptManagerAPI:
    """Client for communicating with the Prompt Manager REST API"""

    def __init__(self):
        self.base_url = API_URL

    def list_prompts(self, user_id):
        """Fetch list of prompts for a user"""
        endpoint = f"{self.base_url}/api/integrations/comfyui/prompts/list"

        try:
            print(f"[PromptManager] Requesting: {endpoint}?user_id={user_id}")
            response = requests.get(
                endpoint,
                params={"user_id": user_id},
                timeout=10
            )

            print(f"[PromptManager] Response status: {response.status_code}")
            print(f"[PromptManager] Response headers: {dict(response.headers)}")
            print(f"[PromptManager] Response body: {response.text[:500]}")

            response.raise_for_status()
            return response.json()

        except requests.exceptions.RequestException as e:
            print(f"[PromptManager] Error fetching prompts: {e}")
            return None

    def get_prompt(self, user_id, display_id):
        """Fetch a specific prompt's content"""
        endpoint = f"{self.base_url}/api/integrations/comfyui/prompts/get"

        try:
            print(f"[PromptManager] Fetching prompt: {display_id}")
            response = requests.get(
                endpoint,
                params={"user_id": user_id, "display_id": display_id},
                timeout=10
            )
            response.raise_for_status()
            data = response.json()

            if "prompt" in data:
                return data["prompt"]
            return None

        except requests.exceptions.RequestException as e:
            print(f"[PromptManager] Error fetching prompt: {e}")
            return None
