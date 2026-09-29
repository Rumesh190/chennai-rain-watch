const SOURCES = {
  nowcast:
    "https://mausam.imd.gov.in/chennaiums/district_nowcast_chnums.php",
  warning:
    "https://mausam.imd.gov.in/chennaiums/district_warning_chnums.php",
};

export default {
  async fetch(request, env) {
    if (request.method === "GET") {
      return new Response("Chennai Rain Watch is running ✅");
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const webhookSecret = request.headers.get(
      "X-Telegram-Bot-Api-Secret-Token"
    );

    if (webhookSecret !== env.WEBHOOK_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }

    const update = await request.json();
    const message = update?.message;

    if (!message) {
      return new Response("OK");
    }

    const chatId = String(message.chat?.id || "");
    const text = (message.text || "").trim();

    if (chatId !== env.TELEGRAM_CHAT_ID) {
      return new Response("OK");
    }

    if (text === "/start" || text === "/help") {
      await sendTelegram(
        env,
        [
          "🌦 Chennai Rain Watch",
          "",
          "/check — check IMD Chennai now",
          "/status — show last stored check",
          "/help — show commands",
          "",
          "Automatic reports: 8:00 AM & 6:00 PM IST",
        ].join("\n")
      );

      return new Response("OK");
    }

    if (text === "/check") {
      await runWeatherCheck(env, {
        alwaysNotify: true,
        reason: "Manual check",
      });

      return new Response("OK");
    }

    if (text === "/status") {
      const state = await env.WEATHER_STATE.get("weather_state", "json");

      if (!state) {
        await sendTelegram(
          env,
          "No weather state saved yet.\n\nSend /check first."
        );
      } else {
        await sendTelegram(
          env,
          [
            "🌦 Chennai Rain Watch",
            "",
            "Last stored check:",
            state.checkedAt || "Unknown",
            "",
            `Nowcast: ${state.nowcastHash ? "Available ✅" : "Unavailable"}`,
            `Warning: ${state.warningHash ? "Available ✅" : "Unavailable"}`,
          ].join("\n")
        );
      }

      return new Response("OK");
    }

    await sendTelegram(
      env,
      "Unknown command.\n\nSend /check, /status or /help."
    );

    return new Response("OK");
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(
      runWeatherCheck(env, {
        alwaysNotify: true,
        reason: "Scheduled report",
      })
    );
  },
};

async function runWeatherCheck(env, options = {}) {
  const previous =
    (await env.WEATHER_STATE.get("weather_state", "json")) || {};

  const [nowcast, warning] = await Promise.all([
    fetchIMD(SOURCES.nowcast),
    fetchIMD(SOURCES.warning),
  ]);

  const nowcastHash = await hash(nowcast.normalized);
  const warningHash = await hash(warning.normalized);

  const firstRun = !previous.nowcastHash && !previous.warningHash;

  const nowcastChanged =
    previous.nowcastHash && previous.nowcastHash !== nowcastHash;

  const warningChanged =
    previous.warningHash && previous.warningHash !== warningHash;

  const changed = Boolean(nowcastChanged || warningChanged);

  const checkedAt = formatIST(new Date());

  const state = {
    nowcastHash,
    warningHash,
    checkedAt,
  };

  await env.WEATHER_STATE.put(
    "weather_state",
    JSON.stringify(state)
  );

  let headline;

  if (firstRun) {
    headline = "✅ Baseline established";
  } else if (changed) {
    headline = "⚠️ IMD information changed";
  } else {
    headline = "✅ No meaningful change";
  }

  const lines = [
    "🌦 Chennai Rain Watch",
    "",
    headline,
    "",
    `Check: ${options.reason || "Weather check"}`,
    "",
    `Checked: ${checkedAt}`,
    "",
    "Source: India Meteorological Department",
  ];

  if (options.alwaysNotify || changed || firstRun) {
    await sendTelegram(env, lines.join("\n"));
  }

  return state;
}

async function fetchIMD(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 ChennaiRainWatch/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`IMD returned HTTP ${response.status}`);
  }

  const html = await response.text();

  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();

  const normalized = text
    .toLowerCase()
    .replace(
      /\b\d{1,2}[:.]\d{2}\s*(am|pm|hrs?|ist|utc)?\b/gi,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();

  return { normalized };
}

async function hash(value) {
  const encoded = new TextEncoder().encode(value);
  const buffer = await crypto.subtle.digest("SHA-256", encoded);

  return [...new Uint8Array(buffer)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sendTelegram(env, text) {
  const response = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text,
        disable_web_page_preview: true,
      }),
    }
  );

  if (!response.ok) {
    throw new Error(
      `Telegram sendMessage failed: ${response.status}`
    );
  }
}

function formatIST(date) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}