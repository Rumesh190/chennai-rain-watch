# Chennai Rain Watch

A zero-cost learning project that checks official IMD Chennai city nowcast and
warning pages and sends a Telegram message only when monitored content changes.

## What V1 monitors

- IMD Chennai City Nowcast
- IMD Chennai City Warning
- Runs every 15 minutes using GitHub Actions
- Stores the previous state using GitHub Actions cache
- Sends alerts through Telegram

This first version deliberately does **not** interpret radar imagery. Radar
analysis can be added after the official-warning monitor is stable.

## 1. Run locally

Requires Python 3.11+.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python weather_check.py
```

Without Telegram credentials, the script prints the notification to Terminal.

Run it once to create a baseline. Run it again later; an alert is generated only
if the normalized IMD page content changed.

## 2. Create your free Telegram bot

1. Open Telegram.
2. Search for `@BotFather`.
3. Send `/newbot`.
4. Give the bot a name, for example `Chennai Rain Watch`.
5. Give it a username ending in `bot`.
6. BotFather gives you a bot token. Keep it private.
7. Open your newly created bot and press **Start** / send `hello`.

### Find your chat ID

After sending a message to your bot, open this in your browser, replacing TOKEN:

```text
https://api.telegram.org/botTOKEN/getUpdates
```

Look for:

```json
"chat": {
  "id": 123456789
}
```

That number is your `TELEGRAM_CHAT_ID`.

## 3. Test Telegram locally

macOS/Linux:

```bash
export TELEGRAM_BOT_TOKEN="YOUR_TOKEN"
export TELEGRAM_CHAT_ID="YOUR_CHAT_ID"
python weather_check.py
```

Delete `state.json` or replace it with `{}` if you want to repeat the
first-run activation message.

## 4. Put it on GitHub

Create a repository and push these files.

Then open:

**GitHub repository → Settings → Secrets and variables → Actions**

Create two repository secrets:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

Do not put these values directly in code or commit them to GitHub.

## 5. Test GitHub Actions

Open:

**Actions → Chennai Rain Watch → Run workflow**

The first successful run establishes the baseline and sends an activation
message. Scheduled checks then run every 15 minutes.

GitHub notes that scheduled workflows can sometimes be delayed, especially
during periods of heavy load, so this is a learning monitor rather than an
emergency-alert system.

## V2

Once this version runs reliably:

1. Download current Chennai radar Surface Rainfall Intensity image.
2. Retain the previous radar frame.
3. Compare image regions/pixels.
4. Detect stronger/weaker rain echoes near Chennai.
5. Notify only above a chosen change threshold.

## Data source

India Meteorological Department / Regional Meteorological Centre Chennai.

This project is for personal learning. Official IMD warnings remain the
authoritative source.
