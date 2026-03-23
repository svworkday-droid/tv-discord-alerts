const express = require("express");
const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

const SECRET_KEY = process.env.SECRET_KEY || "satish123";

const WEBHOOKS = {
  es:      process.env.WEBHOOK_ES,
  gold:    process.env.WEBHOOK_GOLD,
  spx:     process.env.WEBHOOK_SPX,
  nq:      process.env.WEBHOOK_NQ,
  default: process.env.WEBHOOK_DEFAULT,
};

const COLORS = { BUY: 0x00e676, SELL: 0xff1744, INFO: 0x2196f3 };
const EMOJI  = { BUY: "🟢", SELL: "🔴" };

app.get("/", (req, res) => res.send("TV->Discord Alert Server is running"));

app.post("/alert", async (req, res) => {
  try {
    const body = req.body;
    if (body.secret && body.secret !== SECRET_KEY) return res.status(403).send("Forbidden");

    const {
      action = "INFO", ticker = "N/A", price = "N/A",
      stop = "N/A", tp1 = "N/A", tp2 = "N/A", tp3 = "N/A",
      rr = "N/A", session = "RTH", timeframe = "5m",
      bias = "N/A", signal = "N/A", pnl = "N/A",
      winrate = "N/A", note = "",
      channel = "default",
      chart_url = ""       // <-- TradingView {{chart_url}} goes here
    } = body;

    const webhookUrl = WEBHOOKS[channel.toLowerCase()] || WEBHOOKS.default;
    if (!webhookUrl) {
      console.error("No webhook URL found for channel:", channel);
      return res.status(500).send("No webhook configured for channel: " + channel);
    }

    const actionUpper = action.toUpperCase();
    const color = COLORS[actionUpper] || COLORS.INFO;
    const emoji = EMOJI[actionUpper] || "📡";

    const embed = {
      embeds: [{
        title: emoji + " " + actionUpper + " — " + ticker + " [" + timeframe + "]",
        color,
        fields: [
          { name: "💰 Entry",      value: "`" + price + "`",     inline: true },
          { name: "🕐 Timeframe",  value: "`" + timeframe + "`", inline: true },
          { name: "📊 Session",    value: "`" + session + "`",   inline: true },
          { name: "🎯 TP1",        value: "`" + tp1 + "`",       inline: true },
          { name: "🎯 TP2",        value: "`" + tp2 + "`",       inline: true },
          { name: "🎯 TP3",        value: "`" + tp3 + "`",       inline: true },
          { name: "🛑 Stop",       value: "`" + stop + "`",      inline: true },
          { name: "⚖️ R:R",        value: "`" + rr + "`",        inline: true },
          { name: "📈 HTF Bias",   value: "`" + bias + "`",      inline: true },
          { name: "🔍 Signal",     value: "`" + signal + "`",    inline: false },
        ],
        // Chart screenshot embedded as image
        image: chart_url ? { url: chart_url } : undefined,
        footer: { text: note ? note : "WVF Ultimate | Satish Trading System" },
        timestamp: new Date().toISOString()
      }]
    };

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(embed)
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
app.listen(PORT, () => console.log("Server running on port " + PORT));
