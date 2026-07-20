# anti-guestai-bot
当在群组中发现有 Guest AI Bots 发消息时, 封禁 Guest AI Bots, 并且封禁发消息触发Guest AI Bots的那条消息的用户.

# 部署步骤
1. Cloudflare Dashboard -> Workers & Pages -> Create -> 创建一个 Worker
2. 进入该 Worker -> Edit code，把本文件全部内容粘贴进去，点 Deploy
3. Settings -> Variables and Secrets，添加：
     BOT_TOKEN              (Secret) = 你的 Telegram Bot Token
     WEBHOOK_SECRET         (Secret) = 任意一串随机字符串
     ALLOWED_BOT_USERNAMES  (纯文本，可留空) = 想放行、不封禁的 Guest Bot 用户名，逗号分隔
4. 浏览器访问一次: https://<你的worker地址>/install  —— 自动设置 Telegram Webhook
5. 把这个反制 Bot 拉进目标群组并设为管理员，勾选"封禁用户"和"删除消息"权限

# 面向GPT开发
用到的AI是网页版免费账号claude  
以下内容为我发送的自然语言
```
我需要一个基于 cloudflare 的worker的 telegram 机器人bot
功能是:
当在群组中发现有 Guest AI Bots 发消息时, 封禁 Guest AI Bots, 并且封禁发消息触发Guest AI Bots的那条消息的用户.
```
```
这是一个直接写在worker编辑器的 worker.js 脚本
```
```
你知道我说的Guest AI Bots 是什么意思吗？https://telegram.org/blog/ai-bot-revolution-11-new-features#guest-bots
```
```
telegram 有专门的api可以查询 这个bot是否 Guest Mode 吗？
```
完
