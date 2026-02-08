import requests
import sys
import time

# Replace with a real repo that exists and is public
REPO_OWNER = "octocat"
REPO_NAME = "Hello-World"

url = "http://localhost:8000/api/repositories/sync"
payload = {"owner": REPO_OWNER, "name": REPO_NAME}

print(f"Attempting to add repo: {REPO_OWNER}/{REPO_NAME}")
start_time = time.time()
try:
    response = requests.post(url, json=payload, timeout=60) # 60s timeout
    
    print(f"Status Code: {response.status_code}")
    print(f"Time taken: {time.time() - start_time:.2f}s")
    
    if response.status_code != 200:
        print(f"Error Response: {response.text}")
    else:
        print("Success! Repo added.")
        print(response.json())

except Exception as e:
    print(f"Exception: {e}")
