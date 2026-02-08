import google.generativeai as genai
from app.config import get_settings
import logging

logger = logging.getLogger(__name__)

class GeminiService:
    def __init__(self):
        settings = get_settings()
        self.api_key = settings.GEMINI_API_KEY
        
        if self.api_key:
            genai.configure(api_key=self.api_key)
            self.model = genai.GenerativeModel('gemini-pro')
        else:
            logger.warning("GEMINI_API_KEY not found. AI features will be disabled.")
            self.model = None

    async def generate_nudge(self, pr_title: str, author_name: str, days_waiting: int) -> str:
        if not self.model:
            return "Error: Gemini API Key is missing. Please add GEMINI_API_KEY to your .env file."

        prompt = f"""
        You are a helpful open-source maintainer. 
        A contributor named '{author_name}' submitted a Pull Request titled '{pr_title}'.
        It has been waiting for {days_waiting} days without a review.
        
        Write a friendly, encouraging comment to the contributor. 
        - Apologize for the delay.
        - Reassure them that we value their contribution.
        - Ask if they need any help or if the PR is ready for a final look.
        - Keep it short (under 280 characters).
        - Use emojis.
        """
        
        try:
            response = await self.model.generate_content_async(prompt)
            return response.text
        except Exception as e:
            logger.error(f"Gemini API Error: {e}")
            return "Error generating nudge. Please try again later."
