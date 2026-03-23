// ============================================================
//  TradingView → Discord Alert Server
//  Deploy on Render.com (free tier works fine)
//  Author: Built for Satish | ES/SPX Intraday Setup
// ============================================================

const express = require("express");
const app = express();
app.use(express.json());

// ── ENV VARS (set these in Render dashboard → Environment) ──
// DISCORD_WEBHOOK_URL  → your Discord channel webhook URL
// SECRET_KEY           → any random string, paste same in TV alert

const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK_URL;
const SECRET_KEY = process.env.SECRET_KEY || "satish123"; // change this

// ── Color codes for Discord embed sidebar ──
const COLORS = {
  BUY: 0x00e676,   // bright green
  SELL: 0xff1744,  // bright red
  INFO: 0x2196f3,  // blue
};

// ── Emoji map ──
const EMOJI = {
  BUY: "🟢",
  SELL: "🔴",
  TP1: "🎯",
  TP2: "🎯🎯",
  TP3: "🎯🎯🎯",
  SL: "🛑",
};

// ── Health check (Render pings this to keep server alive) ──
app.get("/", (req, res) => res.send("TV→Discord Alert Server is running ✅"));

// ── Main webhook endpoint ──
app.post("/alert", async (req, res) => {
  try {
    const body = req.body;

    // Basic secret check
    if (body.secret && body.secret !== SECRET_KEY) {
      return res.status(403).send("Forbidden");
    }

    const {
      action = "INFO",   // BUY | SELL
      ticker = "N/A",
      price = "N/A",
      stop = "N/A",
      tp1 = "N/A",
      tp2 = "N/A",
      tp3 = "N/A",
      rr = "N/A",
      session = "RTH",   // RTH | Globex
      timeframe = "5m",
      bias = "N/A",      // BULLISH | BEARISH | NEUTRAL
      signal = "N/A",    // e.g. WVF+EMA Confluence
      pnl = "N/A",       // session P&L from Pine dashboard
      winrate = "N/A",   // win rate from Pine dashboard
      note = "",
    } = body;

    const actionUpper = action.toUpperCase();
    const color = COLORS[actionUpper] || COLORS.INFO;
    const emoji = EMOJI[actionUpper] || "📡";

    const embed = {
      embeds: [
        {
          title: `${emoji} ${actionUpper} Signal — ${ticker}`,
          color,
          fields: [
            {
              name: "💰 Entry Price",
              value: `\`${price}\``,
              inline: true,
            },
            {
              name: "🕐 Timeframe",
              value: `\`${timeframe}\``,
              inline: true,
            },
            {
              name: "📊 Session",
              value: `\`${session}\``,
              inline: true,
            },
            {
              name: `${EMOJI.TP1} TP1`,
              value: `\`${tp1}\``,
              inline: true,
            },
            {
              name: `${EMOJI.TP2} TP2`,
              value: `\`${tp2}\``,
              inline: true,
            },
            {
              name: `${EMOJI.TP3} TP3`,
              value: `\`${tp3}\``,
              inline: true,
            },
            {
              name: `${EMOJI.SL} Stop Loss`,
              value: `\`${stop}\``,
              inline: true,
            },
            {
              name: "⚖️ R:R",
              value: `\`${rr}\``,
              inline: true,
            },
            {
              name: "📈 HTF Bias",
              value: `\`${bias}\``,
              inline: true,
            },
            {
              name: "🔍 Signal",
              value: `\`${signal}\``,
              inline: false,
            },
            {
              name: "💼 Session P&L",
              value: `\`${pnl}\``,
              inline: true,
            },
            {
              name: "🏆 Win Rate",
              value: `\`${winrate}\``,
              inline: true,
            },
          ],
          footer: {
            text: note
              ? `📝 ${note}`
              : "Alert fired by WVF Ultimate | Satish's Trading System",
          },
          timestamp: new Date().toISOString(),
        },
      ],
    };

    const response = await fetch(DISCORD_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(embed),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Discord error:", errText);
      return res.status(500).send("Discord post failed");
    }

    res.status(200).send("OK");
  } catch (err) {
    console.error("Server error:", err);
    res.status(500).send("Internal error");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
