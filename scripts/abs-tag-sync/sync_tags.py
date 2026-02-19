import subprocess, requests, json, os

# --- CONFIGURATION (Load from Env or Edit Here) ---
ABS_URL = os.getenv("ABS_URL", "https://your-abs-url.com")
ABS_TOKEN = os.getenv("ABS_TOKEN", "your-api-token")
CONTAINER_NAME = os.getenv("RMAB_CONTAINER", "readmeabook")

def get_abs_user_map():
    headers = {"Authorization": f"Bearer {ABS_TOKEN}"}
    user_map = {}
    try:
        resp = requests.get(f"{ABS_URL}/api/users", headers=headers)
        for user in resp.json().get("users", []):
            if user.get("email"):
                user_map[user["email"].lower()] = user["username"]
        return user_map
    except Exception as e:
        print(f"[!] Error fetching ABS users: {e}")
        return {}

def get_abs_inventory():
    headers = {"Authorization": f"Bearer {ABS_TOKEN}"}
    asin_map = {}
    try:
        libs_res = requests.get(f"{ABS_URL}/api/libraries", headers=headers)
        for lib in libs_res.json().get("libraries", []):
            if lib.get("mediaType") == "book":
                items_res = requests.get(f"{ABS_URL}/api/libraries/{lib['id']}/items?expanded=1", headers=headers)
                for item in items_res.json().get("results", []):
                    media = item.get("media", {})
                    metadata = media.get("metadata", {})
                    asin = metadata.get("asin")
                    if asin:
                        asin_map[asin] = {
                            "id": item["id"],
                            "metadata": metadata,
                            "existing_tags": list(set((item.get("tags") or []) + (media.get("tags") or []))),
                            "title": metadata.get("title", "Unknown")
                        }
        return asin_map
    except Exception: return {}

def get_rmab_requests_grouped():
    sql = "SELECT a.audible_asin, u.plex_email, u.plex_username FROM requests r JOIN audiobooks a ON r.audiobook_id = a.id JOIN users u ON r.user_id = u.id WHERE r.status IN ('available', 'downloaded') AND a.audible_asin IS NOT NULL;"
    cmd = ["docker", "exec", CONTAINER_NAME, "psql", "-U", "postgres", "-d", "readmeabook", "-t", "-A", "-F", "|", "-c", sql]
    
    asin_to_users = {}
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        if not result.stdout.strip(): return {}
        for line in result.stdout.strip().split('\n'):
            if '|' in line:
                asin, email, backup = line.split('|')
                if asin not in asin_to_users:
                    asin_to_users[asin] = []
                asin_to_users[asin].append({"email": email, "backup": backup})
        return asin_to_users
    except Exception as e:
        print(f"[!] Error fetching RMAB DB: {e}")
        return {}

def update_item(item_id, metadata, merged_tags):
    headers = {"Authorization": f"Bearer {ABS_TOKEN}", "Content-Type": "application/json"}
    url = f"{ABS_URL}/api/items/{item_id}/media"
    payload = {"metadata": metadata, "tags": merged_tags}
    resp = requests.patch(url, headers=headers, json=payload)
    return resp.status_code == 200

if __name__ == "__main__":
    if ABS_TOKEN == "your-api-token":
        print("[!] Please set ABS_TOKEN environment variable.")
        exit(1)

    abs_users = get_abs_user_map()
    abs_items = get_abs_inventory()
    rmab_groups = get_rmab_requests_grouped()
    
    for asin, requesters in rmab_groups.items():
        if asin in abs_items:
            book = abs_items[asin]
            target_requester_tags = []
            for r in requesters:
                lookup_email = (r['email'] or "").lower()
                username = abs_users.get(lookup_email, r['backup'])
                target_requester_tags.append(f"Requester: {username}")
            
            other_tags = [t for t in book['existing_tags'] if not t.startswith("Requester: ")]
            final_tags = list(set(other_tags + target_requester_tags))
            
            if set(final_tags) != set(book['existing_tags']):
                if update_item(book['id'], book['metadata'], final_tags):
                    print(f"[+] Updated: {book['title']} (Users: {', '.join(target_requester_tags)})")
    print("[*] Sync complete.")
