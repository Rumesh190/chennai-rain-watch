import hashlib
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import requests
from bs4 import BeautifulSoup

STATE_FILE = Path(os.getenv("STATE_FILE", "state.json"))
IST = ZoneInfo("Asia/Kolkata")

SOURCES = {
    "Chennai City Nowcast": "https://mausam.imd.gov.in/chennaiums/district_nowcast_chnums.php",
    "Chennai City Warning": "https://mausam.imd.gov.in/chennaiums/district_warning_chnums.php",
}

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; ChennaiRainWatch/0.1; "
        "+personal learning project)"
    )
}

# These phrases usually belong to navigation/footer boilerplate and are
# intentionally ignored when building the change fingerprint.
IGNORE_PATTERNS = [
    r"ministry of earth sciences",
    r"government of india",
    r"india meteorological department",
    r"urban meteorological services for chennai",
    r"copyright",
    r"contact us",
]


def fetch_visible_text(url: str) -> str:
    response = requests.get(url, headers=HEADERS, timeout=30)
    response.raise_for_status()

    soup = BeautifulSoup(response.text, "html.parser")

    for tag in soup(["script", "style", "noscript", "svg"]):
        tag.decompose()

    text = " ".join(soup.stripped_strings)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def normalize(text: str) -> str:
    value = text.lower()

    # Remove common date/time churn so we alert on content changes rather than
    # a page simply showing a new clock/date.
    value = re.sub(r"\b\d{1,2}[:.]\d{2}\s*(?:am|pm|hrs?|ist|utc)?\b", " ", value)
    value = re.sub(
        r"\b(?:0?[1-9]|[12]\d|3[01])[-/](?:0?[1-9]|1[0-2])[-/](?:20)?\d{2}\b",
        " ",
        value,
    )
    value = re.sub(
        r"\b(?:january|february|march|april|may|june|july|august|"
        r"september|october|november|december)\s+\d{1,2},?\s+20\d{2}\b",
        " ",
        value,
    )

    for pattern in IGNORE_PATTERNS:
        value = re.sub(pattern, " ", value, flags=re.I)

    value = re.sub(r"\s+", " ", value).strip()
    return value


def digest(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def short_excerpt(text: str, limit: int = 700) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit] + ("…" if len(text) > limit else "")


def load_state() -> dict:
    if not STATE_FILE.exists():
        return {}
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_state(state: dict) -> None:
    STATE_FILE.write_text(
        json.dumps(state, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


def telegram_send(message: str) -> None:
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    chat_id = os.getenv("TELEGRAM_CHAT_ID")

    if not token or not chat_id:
        print("\n[Telegram not configured]")
        print(message)
        return

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    response = requests.post(
        url,
        json={
            "chat_id": chat_id,
            "text": message,
            "disable_web_page_preview": True,
        },
        timeout=30,
    )
    response.raise_for_status()


def main() -> int:
    old_state = load_state()
    new_state = {}
    changes = []
    failures = []

    now = datetime.now(IST)
    checked_at = now.strftime("%d %b %Y, %I:%M %p IST")

    for name, url in SOURCES.items():
        try:
            raw = fetch_visible_text(url)
            cleaned = normalize(raw)

            if len(cleaned) < 30:
                raise RuntimeError(
                    "Page returned too little readable text; IMD may have changed the page."
                )

            fingerprint = digest(cleaned)
            previous = old_state.get(name, {})
            previous_hash = previous.get("hash")

            new_state[name] = {
                "hash": fingerprint,
                "checked_at": now.isoformat(),
                "url": url,
                "excerpt": short_excerpt(raw),
            }

            if previous_hash and previous_hash != fingerprint:
                changes.append(
                    {
                        "name": name,
                        "url": url,
                        "excerpt": short_excerpt(raw),
                    }
                )

            print(f"OK: {name} [{fingerprint[:10]}]")

        except Exception as exc:
            failures.append(f"{name}: {exc}")
            # Preserve the previous successful state for this source.
            if name in old_state:
                new_state[name] = old_state[name]
            print(f"ERROR: {name}: {exc}", file=sys.stderr)

    first_run = not bool(old_state)
    save_state(new_state)

    if first_run:
        telegram_send(
            "✅ Chennai Rain Watch is active.\n\n"
            "Baseline saved successfully. I will alert only when the monitored "
            "IMD Chennai nowcast/warning content changes.\n\n"
            f"Checked: {checked_at}"
        )
        return 0

    if changes:
        lines = [
            "🌦️ Chennai Rain Watch",
            "",
            "IMD Chennai information changed:",
            "",
        ]
        for item in changes:
            lines.append(f"• {item['name']}")
            lines.append(item["excerpt"])
            lines.append("")
        lines.append(f"Checked: {checked_at}")
        lines.append("")
        lines.append("Source: India Meteorological Department (IMD)")
        telegram_send("\n".join(lines))

    if failures and not changes:
        # Don't spam Telegram for transient network failures.
        print("Some sources failed, but no weather-change alert was sent.")

    if not changes:
        print("No meaningful monitored-page change detected.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
