"""Check if Supabase env vars are loaded correctly. Run: py -3.14 -m scraper.check_env"""
import base64
import json
import sys
from pathlib import Path

# Load .env from project root (override=True so .env wins over system env vars)
from dotenv import load_dotenv
env_path = Path(__file__).resolve().parents[1] / ".env"
loaded = load_dotenv(env_path, override=True)

import os

def main():
    print("=== Supabase env check ===\n")
    print(f".env path: {env_path}")
    print(f".env absolute: {env_path.resolve()}")
    print(f".env exists: {env_path.exists()}")
    print(f"dotenv loaded: {loaded}\n")

    url = os.environ.get("SUPABASE_URL", "").strip()
    key = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()

    print(f"SUPABASE_URL set: {bool(url)}")
    if url:
        print(f"  -> {url[:50]}...")
    else:
        print("  -> NOT FOUND")
        return 1

    print(f"\nSUPABASE_SERVICE_KEY set: {bool(key)}")
    if key:
        print(f"  -> length: {len(key)} chars")
        if key.startswith("sb_secret_"):
            print("  -> Supabase secret key format (non-JWT)")
        elif key.startswith("sb_publishable_"):
            print("  -> WARNING: publishable key used; scraper needs a secret key")
        else:
            parts = key.split(".")
            if len(parts) != 3:
                print("  -> WARNING: key is neither a Supabase secret key nor a JWT")
            else:
                # Decode the JWT payload to display its role and project reference.
                try:
                    payload_b64 = parts[1]
                    padding = 4 - len(payload_b64) % 4
                    if padding != 4:
                        payload_b64 += "=" * padding
                    payload_json = base64.urlsafe_b64decode(payload_b64)
                    payload = json.loads(payload_json)
                    print(f"  -> JWT role: {payload.get('role', 'NOT FOUND')}")
                    print(f"  -> JWT ref (project): {payload.get('ref', 'N/A')}")
                except Exception as e:
                    print(f"  -> JWT decode error: {e}")
    else:
        print("  -> NOT FOUND")
        return 1

    print("\n--- Testing Supabase connection ---")
    try:
        from supabase import create_client
        client = create_client(url, key)
        # Simple test: list tables or ping
        result = client.table("chnscraping_articles").select("id").limit(1).execute()
        print("SUCCESS: Connected to Supabase, chnscraping_articles table accessible")
    except Exception as e:
        print(f"FAILED: {e}")
        return 1

    return 0

if __name__ == "__main__":
    sys.exit(main())
