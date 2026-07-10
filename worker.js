/**
 * Telegram 群组 "Guest AI Bots" 拦截机器人 —— 单文件版
 * 可直接复制粘贴到 Cloudflare Workers 在线编辑器 (Quick Edit) 使用。
 *
 * 背景：
 *   Telegram Bot API 10.0 (2026-05-08) 加入了 Guest Mode ——任何支持该功能的 AI Bot，
 *   即使没有被拉进群组、不是群成员，只要有人在消息里 @它的用户名，它就会直接在群里回复那条消息。
 *   参考：https://telegram.org/blog/ai-bot-revolution-11-new-features#guest-bots
 *
 *   关键点：Telegram 官方在 Message 对象上直接加了字段来标记这种情况，不需要猜测：
 *     - guest_bot_caller_user: 如果这条消息是 Guest Bot 发的，这就是触发它回复的那个用户
 *     - guest_bot_caller_chat: 触发它回复的那个聊天
 *     - guest_query_id:        这次 guest 调用的唯一标识
 *   官方文档: https://core.telegram.org/bots/api#message (搜索 guest_bot_caller_user)
 *
 * 功能：
 *  1. 收到群消息，如果 message.guest_bot_caller_user 存在，说明这是一条 Guest Bot 消息
 *  2. 封禁这个 Guest Bot（message.from）
 *  3. 封禁触发它的用户（message.guest_bot_caller_user）
 *  4. 可选：删除这条 Guest Bot 消息，以及触发它的那条原始消息（如果能定位到）
 *
 * ============ 部署步骤 ============
 * 1. Cloudflare Dashboard -> Workers & Pages -> Create -> 创建一个 Worker
 * 2. 进入该 Worker -> Edit code，把本文件全部内容粘贴进去，点 Deploy
 * 3. Settings -> Variables and Secrets，添加：
 *      BOT_TOKEN              (Secret) = 你的 Telegram Bot Token
 *      WEBHOOK_SECRET         (Secret) = 任意一串随机字符串
 *      ALLOWED_BOT_USERNAMES  (纯文本，可留空) = 想放行、不封禁的 Guest Bot 用户名，逗号分隔
 * 4. 浏览器访问一次: https://<你的worker地址>/install  —— 自动设置 Telegram Webhook
 *    注意：allowed_updates 必须包含 "message"（本脚本已自动配置好）
 * 5. 把这个反制 Bot 拉进目标群组并设为管理员，勾选"封禁用户"和"删除消息"权限
 *    (只有管理员身份才能看到群里所有消息，绕开隐私模式限制)
 * 6. 想查看 Webhook 状态: https://<你的worker地址>/status
 * 7. 想看实时日志: Cloudflare Dashboard -> 该 Worker -> Logs -> Begin log stream
 * ===================================
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 辅助路由：访问一次即可自动把 Telegram Webhook 指向本 Worker
    if (url.pathname === "/install" && request.method === "GET") {
      const workerWebhookUrl = `${url.origin}/webhook`;
      const result = await callTelegram(env, "setWebhook", {
        url: workerWebhookUrl,
        secret_token: env.WEBHOOK_SECRET || undefined,
        allowed_updates: ["message", "channel_post"],
        drop_pending_updates: true,
      });
      return jsonResponse(result);
    }

    // 查看当前 Webhook 状态，方便排查问题
    if (url.pathname === "/status" && request.method === "GET") {
      const result = await callTelegram(env, "getWebhookInfo", {});
      return jsonResponse(result);
    }

    if (url.pathname !== "/webhook" || request.method !== "POST") {
      return new Response("OK", { status: 200 });
    }

    // 校验 Telegram 的 secret token，防止别人伪造请求调用你的 Worker
    if (env.WEBHOOK_SECRET) {
      const secretHeader = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
      if (secretHeader !== env.WEBHOOK_SECRET) {
        return new Response("Unauthorized", { status: 401 });
      }
    }

    let update;
    try {
      update = await request.json();
    } catch (e) {
      return new Response("Bad Request", { status: 400 });
    }

    // 用 waitUntil 让 Telegram 先收到 200，我们在后台慢慢处理封禁逻辑
    ctx.waitUntil(handleUpdate(update, env));

    return new Response("OK", { status: 200 });
  },
};

async function handleUpdate(update, env) {
  try {
    const message = update.message || update.channel_post;
    if (!message || !message.chat) return;

    // === 核心判断：官方字段 guest_bot_caller_user 存在 = 这是一条 Guest Bot 消息 ===
    const callerUser = message.guest_bot_caller_user;
    if (!callerUser) return;

    const from = message.from; // 发这条消息的 Guest Bot 本身
    if (!from) return;

    const chatId = message.chat.id;
    const botUserId = from.id;
    const username = (from.username || "").toLowerCase();

    // 白名单：想放行、保留正常工作的 Guest Bot，直接跳过
    const allowedList = (env.ALLOWED_BOT_USERNAMES || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (allowedList.length > 0 && allowedList.includes(username)) {
      return;
    }

    console.log(
      `[检测到Guest Bot消息] chat=${chatId} bot=@${from.username || ""} (${botUserId}) ` +
        `触发用户=@${callerUser.username || ""} (${callerUser.id}) ` +
        `guest_query_id=${message.guest_query_id || ""}`
    );

    const tasks = [];

    // 1. 封禁这个 Guest AI Bot
    tasks.push(
      banChatMember(env, chatId, botUserId).then((r) =>
        logResult("封禁Guest Bot", r, botUserId)
      )
    );

    // 2. 封禁触发它的用户（官方字段直接给出，不用再猜）
    if (!callerUser.is_bot) {
      tasks.push(
        banChatMember(env, chatId, callerUser.id).then((r) =>
          logResult("封禁触发用户", r, callerUser.id)
        )
      );
    }

    // 3. 可选：删除消息
    // if (parseBool(env.DELETE_MESSAGES)) {
    if (true) {
      // 删除 Guest Bot 这条回复
      tasks.push(deleteMessage(env, chatId, message.message_id));
      // 如果能定位到触发它的原始消息（同一个聊天里的 reply），一并删除
      const replyTo = message.reply_to_message;
      if (replyTo && replyTo.from && replyTo.from.id === callerUser.id) {
        tasks.push(deleteMessage(env, chatId, replyTo.message_id));
      }
    }

    await Promise.allSettled(tasks);
  } catch (err) {
    console.error("处理 update 出错:", err);
  }
}

async function banChatMember(env, chatId, userId) {
  return callTelegram(env, "banChatMember", {
    chat_id: chatId,
    user_id: userId,
    revoke_messages: true,
  });
}

async function deleteMessage(env, chatId, messageId) {
  return callTelegram(env, "deleteMessage", {
    chat_id: chatId,
    message_id: messageId,
  });
}

async function callTelegram(env, method, params) {
  const apiUrl = `https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`;
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!data.ok) {
    console.error(`Telegram API [${method}] 调用失败:`, JSON.stringify(data));
  }
  return data;
}

function logResult(label, result, userId) {
  if (result && result.ok) {
    console.log(`${label} 成功: user_id=${userId}`);
  } else {
    console.error(`${label} 失败: user_id=${userId}`, JSON.stringify(result));
  }
}

function parseBool(v) {
  return String(v).toLowerCase() === "true";
}

function jsonResponse(obj) {
  return new Response(JSON.stringify(obj, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
}
