# Receipt bot

Snap a receipt, send it to your own Telegram bot, and it's filed. Built for Australian small businesses that run two entities (a **trust** and a **company**), but works fine with one.

Within about a minute of sending a photo or PDF, it:

1. reads the date, business name, total, GST and card number with Claude (Sonnet 5.5)
2. decides **Trust**, **Company** or **Unsure**:
   - a caption `t` or `c` decides it first
   - otherwise the card's last 4 digits decide it
   - otherwise it goes to Unsure
3. saves it to Google Drive as `Receipts/<Trust|Company|Unsure>/FY2026-27/2026-10-07 Officeworks $45.20.jpg`
4. optionally emails it to that entity's Xero / Hubdoc inbox, so it lands in the right set of books
5. replies `✓ Company · 2026-10-07 Officeworks $45.20.jpg`

If it says **Unsure**, send `t` or `c` (as a reply, or just as the next message) and it files the latest Unsure receipt. Add the shop name to fix a misread, e.g. `Aldi c`. The same works as a caption on the photo.
If something goes wrong, it replies `⚠️ Not saved…`. Nothing fails silently.

The ATO accepts clear digital copies of receipts. Keep them for 5 years; Drive is the archive.

## Easiest way to set it up: ask your AI agent

Open this folder in **Claude Code**, **Codex**, Cursor or any coding agent and say:

> Help me set this up, one step at a time.

The agent reads `AGENTS.md` and walks you through every step below, explains the costs, and helps if something doesn't work. You never need to paste your keys or card numbers into the chat; they go straight into Google's settings page.

Prefer to do it yourself? Follow the steps below.

## What it costs

| Thing | Cost |
|---|---|
| Telegram bot | Free |
| Google Apps Script + Drive | Free with any Google account (uses a sliver of your Drive storage) |
| Claude API | Pay-as-you-go, roughly **1–4 US cents per receipt** (estimate). Prepaid credit; check console.anthropic.com for the current minimum top-up |
| Xero / Hubdoc | Optional. Uses the subscription you already have; nothing extra |

So 100 receipts a month is roughly US$1–4. After your first ten receipts, check **Usage** in the Anthropic console for your real per-receipt cost. Set a monthly spend limit there too, if you like.

Free-tier limits that matter (personal Google accounts): about 90 minutes a day of background run time (this bot uses roughly 20–25) and 100 emails a day. Google Workspace accounts get more.

## One-time setup (about 20 minutes)

**1. Make the bot.** In Telegram, message **@BotFather**, send `/newbot`, pick a name and a username ending in `bot`, and copy the **token** it gives you. Treat the token like a password.

**2. Claude key.** At console.anthropic.com, sign up, add a little prepaid credit under **Billing**, then go to **API keys** and create one. Copy it somewhere safe for the next few minutes; the console only shows it once.

**3. Accounting inboxes (optional).** Skip this if you only want Drive copies. Otherwise you need one email-in address per entity:
- **Xero:** Accounting → Documents → "Email to Documents Inbox" shows the address. Do this inside each organisation (trust and company).
- **Hubdoc:** open each organisation and copy its email-in address for uploading documents.

Send the first test receipt and check it actually arrives in the right place.

**4. Apps Script.** Go to script.google.com and click **New project**. Name it "Receipt bot". Delete what's there, paste in everything from `Code.gs`, and save.

**5. Settings.** Click the cog (**Project Settings**). Check **Time zone** is yours (it's used when a receipt's date can't be read). Scroll to **Script properties** and add:

| Property | Value |
|---|---|
| `TELEGRAM_TOKEN` | the token from step 1 |
| `CLAUDE_API_KEY` | the key from step 2 |
| `TRUST_CARDS` | last 4 digits of the trust's card(s), comma-separated, e.g. `1234,5678` |
| `COMPANY_CARDS` | same for the company's card(s) |
| `TRUST_HUBDOC_EMAIL` | the trust's inbox address from step 3 (or leave out) |
| `COMPANY_HUBDOC_EMAIL` | the company's inbox address from step 3 (or leave out) |

Leave `CHAT_ID` and `ROOT_FOLDER_ID` out; they get filled in below. Only one entity? Put all your cards in `COMPANY_CARDS` and leave the trust ones out.

**6. Switch it on.** In the editor, pick `setup` from the function dropdown and click **Run**. Google asks for permission (Drive, sending email, connecting to outside services, running on a timer). Click Advanced → Go to Receipt bot → Allow. The "unverified app" warning is normal: it's your own script. This creates a `Receipts` folder in your Drive.

**7. Link your phone.** Send your bot any message. Within a minute it replies with your chat ID. Add it as `CHAT_ID` in Script properties. From then on the bot only listens to you.

**8. Test it.** Pick `selfTest` and click **Run**. It should log "selfTest passed". Then send a few real receipts.

## Changing things later

- **New card:** add its last 4 digits to `TRUST_CARDS` or `COMPANY_CARDS`.
- **Stop emailing your accounting inbox:** delete that email property.
- **Pause the bot:** Apps Script → Triggers (clock icon) → delete the `poll` trigger. Run `setup` again to restart it.
- `Code.gs` in this repo is the reference copy. The live version is the one in Apps Script; paste updates in there.

## Limits

- Up to about 1 minute delay. The bot checks Telegram once a minute, which keeps it free with no public web address.
- Send receipts one at a time. If you select several photos together, Telegram only attaches your caption to the first one; the rest get sorted by card number or go to Unsure.
- Multi-page receipts: send each page separately, or send a PDF.
- iPhone HEIC files sent as a "file" are rejected. Send them as a normal photo instead.
- Your receipt images go to Anthropic's API to be read. Anthropic doesn't train on API data by default.
