# Audiobookshelf Tag Sync

### 💡 The "Why"
In a multi-user library, "Availability" is only half the story. The real question is: **"Who is this book for?"**

Audiobookshelf is a powerful library organizer, but it doesn't natively know which of your users requested which book in RMAB. This script bridges that gap by automatically tagging books with `Requester: [Username]`. This allows:
* **Personalized Filtering:** Users can filter the ABS library to see only their personal requests.
* **Custom Collections:** Admins can build smart collections based on user demand.
* **Context:** Instant visibility in the ABS UI into why a book was added.

### 🛠️ Features
* **Smart User Mapping:** Cross-matches users across platforms to ensure accurate tagging.
    * **Unified Email Linker:** Uses the email address as the primary unique identifier to bridge RMAB/Plex and ABS/OIDC accounts.
    * **Fallback Logic:** If an email match isn't found, it gracefully falls back to the Plex username.
* **Data Preservation:** Uses a deep-merge strategy to ensure existing ABS genres, metadata, and manual tags are never overwritten.
* **Multi-User Ready:** Designed to handle multiple requesters per book (anticipating future RMAB updates).

### ⚙️ Configuration
The script looks for the following Environment Variables:
* **ABS_URL:** Your Audiobookshelf URL (e.g., https://abs.yourdomain.com)
* **ABS_TOKEN:** Your ABS API Token.
* **RMAB_CONTAINER:** Name of your RMAB Docker container (default: readmeabook).

### 🚀 Quick Start
Run this command from the directory where you saved `sync_tags.py`. Adjust the values to match your setup:

ABS_URL="https://abs.yourdomain.com" ABS_TOKEN="your_token" RMAB_CONTAINER="readmeabook" python3 sync_tags.py

### 📂 Recommended Placement
For consistency with the RMAB environment, it is recommended to store this script in your config directory:
`/app/config/scripts/abs-tag-sync/`

### 🤖 Automation (Cron)
To keep your library synced automatically, add this entry to your crontab (`crontab -e`):

*/30 * * * * ABS_URL="https://abs.yourdomain.com" ABS_TOKEN="your_token" /usr/bin/python3 /app/config/scripts/abs-tag-sync/sync_tags.py >> /app/config/scripts/abs-sync.log 2>&1

> **Note:** Ensure the user running the cron job has permissions to execute `docker exec`.
