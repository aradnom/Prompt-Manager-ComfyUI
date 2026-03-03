from aiohttp import web
import server
from .config import API_URL

@server.PromptServer.instance.routes.get("/prompt-manager/config")
async def get_config(request):
    """Serve configuration to the frontend"""
    return web.json_response({
        "api_url": API_URL
    })

@server.PromptServer.instance.routes.post("/prompt-manager/webhook")
async def prompt_update_webhook(request):
    """Receive push notifications when prompts are updated"""
    try:
        data = await request.json()
        print(f"[PromptManager] Received webhook: {data}")

        # Extract prompt info from the webhook payload
        display_id = data.get("display_id")
        prompt_content = data.get("prompt")

        if not display_id:
            return web.json_response({"error": "Missing display_id"}, status=400)

        print(f"[PromptManager] Broadcasting update for prompt: {display_id}")

        # Broadcast the update to all connected clients via WebSocket
        server.PromptServer.instance.send_sync("prompt-manager-update", {
            "display_id": display_id,
            "prompt": prompt_content
        })

        return web.json_response({"status": "ok"})

    except Exception as e:
        print(f"[PromptManager] Error in webhook: {e}")
        return web.json_response({"error": str(e)}, status=500)
