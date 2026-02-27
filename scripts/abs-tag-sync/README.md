# Audiobookshelf Tag Sync

### 💡 The "Why"
In a multi-user library, "Availability" is only half the story. The real question is: "Who is this book for?"

Audiobookshelf (ABS) is a powerful library organizer, but it doesn't natively know which of your users requested which book in ReadMeABook (RMAB). This script bridges that gap by automatically tagging books with "Requester: [Username]". This allows:
* Personalized Filtering: Users can filter the ABS library to see only their personal requests.
* Custom Collections: Admins can build smart collections based on user demand.
* Context: Instant visibility in the ABS UI into why a book was added.

### 🛠️ Features
* Smart User Mapping: Matches users across platforms to bridge identities between RMAB and ABS.
    * Unified Email Linker: Uses the email address as the primary identifier to bridge RMAB/Plex and ABS/OIDC accounts.
    * Fallback Logic: If an email match isn't found, it gracefully falls back to the Plex username provided by RMAB.
* Data Preservation: Uses a deep-merge strategy to ensure existing ABS metadata and genres are never overwritten.
* Multi-User Ready: Handles multiple requesters per book.

### 📋 Requirements
* ASIN Metadata: The script matches books using the ASIN. Ensure your ABS items have the ASIN field populated in their metadata.
* Python 3.x: Must be installed on the host machine.
* Docker Permissions: The host user must have permission to execute 'docker exec'.

### ⚙️ Step 1: Environment Setup
We align with the standard RMAB configuration directory for script storage.

1. Navigate to your RMAB persistent storage directory on the host(where you mounted the config volume /app/config in the compose):
```bash
cd /opt/appdata/RMAB

```

2. Create the script environment:

```bash
mkdir -p scripts/abs-tag-sync && cd scripts/abs-tag-sync
python3 -m venv venv
./venv/bin/pip install requests

```

### ⚙️ Step 2: Download the Script

Download the sync script into the directory:

```bash
curl -O https://raw.githubusercontent.com/kikootwo/ReadMeABook/main/scripts/abs-tag-sync/sync_tags.py
chmod +x sync_tags.py

```

### ⚙️ Step 3: Manual Test

Run the script manually to ensure everything is connected correctly.
(Replace the values in quotes with your actual ABS URL and API Token)

```bash
ABS_URL="https://abs.yourdomain.com" ABS_TOKEN="your_token" RMAB_CONTAINER="readmeabook" ./venv/bin/python3 sync_tags.py

```

### 🤖 Step 4: Automation (Cron)

To keep your library synced, add this to your system's crontab (crontab -e):

```bash
*/30 * * * * ABS_URL="https://your-url" ABS_TOKEN="your-token" /app/config/scripts/abs-tag-sync/venv/bin/python3 /app/config/scripts/abs-tag-sync/sync_tags.py >> /app/config/scripts/abs-sync.log 2>&1

```

### 📂 Configuration Breakdown

* ABS_URL: Your Audiobookshelf URL.
* ABS_TOKEN: Your ABS API Token (Settings > Users > [User] > API Token).
* RMAB_CONTAINER: Your RMAB Docker container name (Default: "readmeabook").
* venv/bin/python3: Path to the isolated Python environment created in Step 1.
