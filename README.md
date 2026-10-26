# claude-cli-statusline

An unofficial two-line statusline for [Claude Code](https://code.claude.com). It shows context usage, effort level, subscription usage limits with reset times, cost and turn count, using colored progress bars. It's a single Node script with no dependencies.

```
🤖 Opus 5.5 | 🧠 ▰▱▱▱▱▱▱▱▱▱ 13% | 🎯 high | 🐱 ▰▱▱▱▱▱▱▱▱▱ 12% → 1:50 AM | 📅 ▰▰▰▰▰▱▱▱▱▱ 47% → Oct 30, 10:00 PM
💰 $3.55 session / $24.10 today / $11.40 block (1h 10m left) | 💬 17 turns
```

In the terminal, each bar is green below 50%, yellow below 80% and red from 80% up.

## What it shows

**Line 1**

| Segment | Meaning |
|---|---|
| 🤖 | Current model. |
| 🧠 | Context-window usage. Shows 0% until the first response of a session. |
| 🎯 | Effort level, as set live in Claude Code (falls back to `effortLevel` in `settings.json`). `max` is shown as `MAX`. |
| 🐱 | 5-hour usage limit, with the time it resets. |
| 📅 | Weekly usage limit, with the date and time it resets. |

The usage-limit bars only appear on Pro and Max subscriptions, after the first response of a session. With API-key billing they're hidden.

**Line 2**

| Segment | Meaning |
|---|---|
| 💰 | Cost of this session, live from Claude Code. With [ccusage](https://github.com/ryoppippi/ccusage) installed, it also shows today's total and the current 5-hour billing block. |
| 💬 | Turns: prompts you've typed this session, not counting tool results, slash commands or interrupted requests. A cue for when to `/clear` and start fresh. |

## Install

1. Download `statusline.js` into `~/.claude/`:

   ```bash
   curl -o ~/.claude/statusline.js https://raw.githubusercontent.com/mike-r129/claude-cli-statusline/main/statusline.js
   ```

   In Windows PowerShell, where `curl` is an alias for `Invoke-WebRequest`:

   ```powershell
   Invoke-WebRequest https://raw.githubusercontent.com/mike-r129/claude-cli-statusline/main/statusline.js -OutFile ~/.claude/statusline.js
   ```

2. Add this to `~/.claude/settings.json`:

   ```json
   "statusLine": {
     "type": "command",
     "command": "node ~/.claude/statusline.js"
   }
   ```

3. Optional, for the today and block totals:

   ```bash
   npm install -g ccusage
   ```

The statusline appears on the next refresh, with no restart needed.

## Requirements

- Node.js 18 or newer.
- A terminal and font that render emoji and the `▰▱` block characters.
- ccusage is optional.

Tested on Windows with Claude Code 2.1. It uses only Node's built-in modules, with no GNU tools or bash, so it should also work on macOS and Linux.

## How it works

Claude Code pipes session data as JSON to the script on every refresh. The script reads the model, context, effort, usage limits and cost from that JSON. It counts turns from the session transcript, which takes a few milliseconds even for long sessions.

ccusage is slow, because it re-reads every transcript you have. So it never runs while the statusline is being drawn. The script shows the last cached result from `~/.claude/ccusage-cache.txt` and refreshes it in a detached background process, at most every 5 minutes and one run at a time. It runs ccusage with `--no-offline` so prices for new models are current.

## Debugging

Set `STATUSLINE_DEBUG=1` before starting Claude Code to save each input to `~/.claude/statusline-input.json`. That shows exactly which fields your Claude Code version provides.

To test the script without Claude Code:

```bash
echo '{"model":{"display_name":"Opus 5.5"},"context_window":{"used_percentage":42}}' | node ~/.claude/statusline.js
```

## License

[MIT](LICENSE). Not affiliated with Anthropic.
