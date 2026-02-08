import requests
import time

url = "https://api.github.com/repos/octocat/Hello-World"
print(f"Connecting to {url}...")

start = time.time()
try:
    response = requests.get(url, timeout=10)
    print(f"Status Code: {response.status_code}")
    print(f"Time: {time.time() - start:.2f}s")
    if response.status_code == 200:
        print("Success! Network is fine.")
    else:
        print(f"Failed with {response.status_code}")
        print(response.text[:200])
except Exception as e:
    print(f"Connection failed: {e}")
