import requests
import sys

try:
    print("Checking backend health...")
    response = requests.get("http://localhost:8000/api/repositories", timeout=5)
    print(f"Status Code: {response.status_code}")
    print(f"Response: {response.json()}")
except Exception as e:
    print(f"Error: {e}")
    sys.exit(1)
