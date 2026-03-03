import os
from dotenv import load_dotenv

# Load environment variables from .env file
env_path = os.path.join(os.path.dirname(__file__), '.env')
load_dotenv(env_path)

# Configuration
API_URL = os.getenv('API_URL', 'https://prompts.rodeo')
ENABLE_LOGGING = os.getenv('ENABLE_LOGGING', '').lower() in ('1', 'true', 'yes')
