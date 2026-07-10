#!/usr/bin/env python3
import subprocess
import requests
import json
import os
import sys

# --- CONFIGURATION ---
# Loaded from environment variables for portability
ABS_URL = os.environ.get("ABS_URL", "").rstrip("/")
ABS_TOKEN = os.environ.get("ABS_TOKEN", "")
CONTAINER_NAME = os.environ.get("RMAB_CONTAINER", "readmeabook")

def get_abs_user_map():
    """Maps ABS emails (OIDC/Local) to Usernames."""
    headers = {"Authorization": f"Bearer {ABS_TOKEN}"}
    user_map = {}
    try:
        resp = requests.get(f"{ABS_URL}/api/users", headers=headers, timeout=10)
        resp.raise_for_status()
        for user in resp.json().get("users", []):
            email = user.get("email")
            if email:
                # Primary Linker: Email (lowercase for matching)
                user_map[email.lower()] = user["username"]
        return user_map
    except Exception as e:
        print(f"[!] Error fetching ABS users: {e}")
        return {}

def get_abs_inventory():
    """Fetches all items from ABS libraries to build an ASIN map."""
    headers = {"Authorization": f"Bearer {ABS_TOKEN}"}
    asin_map = {}
    try:
        libs_res = requests.get(f"{ABS_URL}/api/libraries", headers=headers, timeout=10)
        libs_res.raise_for_status()
        
        for lib in libs_res.json().get("libraries", []):
            if lib.get("mediaType") == "book":
                items_res = requests.get(f"{ABS_URL}/api/libraries/{lib['id']}/items?expanded=1", headers=headers, timeout=10)
                for item in items_res.json().get("results", []):
                    media = item.get("media", {})
                    metadata = media.get("metadata", {})
                    asin = metadata.get("asin")
                    if asin:
                        asin_map[asin] = {
                            "id": item["id"],
                            "metadata": metadata,
                            # Merge tags from item and media levels
                            "existing_tags": list(set((item.get("tags") or []) + (media.get("tags") or []))),
                            "title": metadata.get("title", "Unknown")
                        }
        return asin_map
    except Exception as e:
        print(f"[!] Error fetching ABS inventory: {e}")
        return {}

def get_rmab_requests_grouped():
    """Groups requesters by ASIN from the RMAB Postgres DB."""
    sql = (
        "SELECT a.audible_asin, u.plex_email, u.plex_username "
        "FROM requests r "
        "JOIN audiobooks a ON r.audiobook_id = a.id "
        "JOIN users u ON r.user_id = u.id "
        "WHERE r.status IN ('available', 'downloaded') AND a.audible_asin IS NOT NULL;"
    )
    cmd = ["docker", "exec", CONTAINER_NAME, "psql", "-U", "postgres", "-d", "readmeabook", "-t", "-A", "-F", "|", "-c", sql]
    
    asin_to_users = {}
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        lines = result.stdout.strip().split('\n')
        if not lines or lines == ['']: return {}
        
        for line in lines:
            if '|' in line:
                asin, email, backup = line.split('|')
                if asin not in asin_to_users:
                    asin_to_users[asin] = []
                asin_to_users[asin].append({"email": email, "backup": backup})
        return asin_to_users
    except Exception as e:
        print(f"[!] Error fetching RMAB data: {e}")
        return {}

def update_item(item_id, metadata, merged_tags):
    """Patches the ABS item with updated tags."""
    headers = {"Authorization": f"Bearer {ABS_TOKEN}", "Content-Type": "application/json"}
    url = f"{ABS_URL}/api/items/{item_id}/media"
    payload = {"metadata": metadata, "tags": merged_tags}
    try:
        resp = requests.patch(url, headers=headers, json=payload, timeout=10)
        return resp.status_code == 200
    except Exception:
        return False

if __name__ == "__main__":
    if not ABS_URL or not ABS_TOKEN:
        print("[!] Missing ABS_URL or ABS_TOKEN environment variables.")
        sys.exit(1)

    print("[*] Starting ABS Tag Sync...")
    abs_users = get_abs_user_map()
    abs_items = get_abs_inventory()
    rmab_groups = get_rmab_requests_grouped()
    
    if not rmab_groups:
        print("[~] No requests found in RMAB to sync.")
        sys.exit(0)

    for asin, requesters in rmab_groups.items():
        if asin in abs_items:
            book = abs_items[asin]
            
            # Map RMAB users to ABS names using email as linker
            target_requester_tags = []
            for r in requesters:
                email_match = (r['email'] or "").lower()
                username = abs_users.get(email_match, r['backup'])
                target_requester_tags.append(f"Requester: {username}")
            
            # Filter out old requester tags but keep other metadata tags (Genres, etc.)
            other_tags = [t for t in book['existing_tags'] if not t.startswith("Requester: ")]
            final_tags = list(set(other_tags + target_requester_tags))
            
            # Only update if tags have changed
            if set(final_tags) != set(book['existing_tags']):
                if update_item(book['id'], book['metadata'], final_tags):
                    print(f"[+] Updated: {book['title']} -> {', '.join(target_requester_tags)}")
                else:
                    print(f"[!] Failed to update: {book['title']}")
    
    print("[*] Sync complete.")
