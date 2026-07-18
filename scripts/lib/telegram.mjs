// Minimal Telegram sender for the GitHub Actions monitors.
// Sends an HTML message to the configured chat. Throws on API failure so the
// workflow step records the error (and the run shows red in Actions).

export async function sendTelegram(html) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN not set");
  if (!chatId) throw new Error("TELEGRAM_CHAT_ID not set");

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: html,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`telegram sendMessage HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
}
