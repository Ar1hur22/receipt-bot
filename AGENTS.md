# Instructions for AI agents (Claude Code, Codex, Cursor, etc.)

This repo is a Telegram receipt bot that runs on Google Apps Script. `README.md` is the user guide; `Code.gs` is the whole program. Your job is usually to **walk a non-technical person through setup**, then help with tweaks.

## How to run the setup conversation

- Assume the user isn't technical. Plain language, short messages, no jargon without a one-line explanation.
- **One step at a time.** Give one step from the README's "One-time setup", then wait for them to say it's done (or stuck) before the next. Don't paste the whole guide at once.
- Start by asking two things: do they run one entity or two (trust + company), and do they want receipts emailed to Xero/Hubdoc or just saved to Drive? Skip steps that don't apply.
- Before step 2, explain the costs (table below) so there are no surprises.
- Use Australian English.

## Secrets: never in the chat

**Never ask the user to paste their Telegram token, Claude API key, card digits or inbox addresses into the chat.** Tell them exactly where to put each one (Apps Script → Project Settings → Script properties) and let them type it there. If they paste one into chat anyway:
- tell them to treat it as exposed: revoke the Telegram token with @BotFather (`/revoke`) or delete the Claude key in the console, and make a new one;
- never write it into any file in this repo.

The code reads every setting from Script properties, so nothing personal ever needs to go into `Code.gs` or be committed to git.

## Costs to explain

| Thing | Cost |
|---|---|
| Telegram bot | Free |
| Google Apps Script + Drive | Free with a Google account |
| Claude API (`claude-sonnet-5-5`, $2 / $10 per million input / output tokens) | About 1–4 US cents per receipt (estimate: a photo is ~1.5–5k input tokens, the answer plus thinking ~0.5–3k output tokens). Prepaid credit; the minimum top-up is shown in console.anthropic.com → Billing |
| Xero / Hubdoc inbox | Optional, included in their existing subscription |

Tell them to check console.anthropic.com → Usage after ~10 receipts for their real figure, and that they can set a monthly spend limit there.

Free-tier limits on personal Google accounts: ~90 min/day of trigger run time (polling every minute uses ~20–25) and 100 emails/day (MailApp). Workspace accounts have higher limits.

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| "Google hasn't verified this app" | Normal for your own script. Advanced → Go to Receipt bot (unsafe) → Allow |
| Bot never replies | `setup` wasn't run, or the `poll` trigger is missing (Apps Script → Triggers). Check `TELEGRAM_TOKEN` has no spaces. Look at Apps Script → Executions for errors |
| Bot replies with the chat ID every time | `CHAT_ID` isn't saved in Script properties yet |
| `⚠️ Not saved: Claude: …authentication…` | Wrong `CLAUDE_API_KEY` |
| `⚠️ Not saved: Claude: …credit balance…` | Top up credit at console.anthropic.com → Billing |
| `Telegram getUpdates: Conflict…` | A webhook is set on the bot. Run `setup` again (it removes it) |
| Receipt in Drive but not in Xero/Hubdoc | Check the `*_HUBDOC_EMAIL` property; check the Gmail **Sent** folder of the account that owns the script |
| Everything goes to Unsure | The card digits on the receipt don't match `TRUST_CARDS` / `COMPANY_CARDS`, or the receipt doesn't print them. Use a `t` / `c` caption |

## Changing the code

- Edit `Code.gs` here, then tell the user to paste the whole file into the Apps Script editor and save. The Apps Script copy is the live one.
- After any change, have them run `selfTest` in the editor; extend it if you change the sorting logic.
- Keep it small: no libraries, no build step. Everything must work in a single Apps Script file.
- Renaming the entities (e.g. "Personal" / "Business") means changing the `'Trust'` / `'Company'` strings, the `WORDS` map in `parseNote`, the property names in `sendToHubdoc`, and `selfTest`.
