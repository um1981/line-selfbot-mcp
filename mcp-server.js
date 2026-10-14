import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { loginWithAuthToken, TalkMessage } from "@evex/linejs";
import { FileStorage } from "@evex/linejs/storage";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const storagePath = path.join(__dirname, "storage.json");
const storage = new FileStorage(storagePath);

let client = null;

async function getClient() {
  if (client) return client;

  if (!fs.existsSync(storagePath)) {
    throw new Error("ยังไม่มีไฟล์ storage.json กรุณารัน 'npm run login' (node run.js) ในเทอร์มินัลก่อน");
  }

  const token = await storage.get("savedAuthToken");
  if (!token) {
    throw new Error("ยังไม่พบบัญชี LINE ที่ล็อกอิน กรุณารัน 'npm run login' (node run.js) ในเทอร์มินัลก่อน");
  }

  client = await loginWithAuthToken(token, {
    device: "DESKTOPWIN",
    storage: storage,
  });

  return client;
}

const server = new Server(
  { name: "line-selfbot-mcp", version: "1.5.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "list_chats",
        description: "ดึงรายชื่อแชทล่าสุดทั้งหมด (ทั้งแชทส่วนตัว 1-on-1 และแชทกลุ่ม) เรียงตามการสนทนาล่าสุด",
        inputSchema: {
          type: "object",
          properties: {
            limit: {
              type: "number",
              description: "จำนวนห้องแชทที่ต้องการดึง (ค่าเริ่มต้น 30)",
              default: 30,
            },
          },
        },
      },
      {
        name: "get_chat_messages",
        description: "อ่านประวัติข้อความล่าสุดในแชท หากข้อความเป็นรูปภาพจะแสดง [รูปภาพ/IMAGE] พร้อม messageId",
        inputSchema: {
          type: "object",
          properties: {
            chatMid: {
              type: "string",
              description: "MID ของแชท (เช่น u... สำหรับคน หรือ c... สำหรับกลุ่ม)",
            },
            limit: {
              type: "number",
              description: "จำนวนข้อความที่ต้องการอ่าน (ค่าเริ่มต้น 20)",
              default: 20,
            },
          },
          required: ["chatMid"],
        },
      },
      {
        name: "get_message_image",
        description: "ดึงรูปภาพจากข้อความที่มี messageId ระบุ เพื่อให้ AI มองเห็นรูปภาพนั้นโดยตรง",
        inputSchema: {
          type: "object",
          properties: {
            chatMid: {
              type: "string",
              description: "MID ของห้องแชท",
            },
            messageId: {
              type: "string",
              description: "ID ของข้อความที่เป็นรูปภาพ",
            },
          },
          required: ["chatMid", "messageId"],
        },
      },
      {
        name: "send_message",
        description: "ส่งข้อความไปยังห้องแชทหรือบุคคล",
        inputSchema: {
          type: "object",
          properties: {
            chatMid: {
              type: "string",
              description: "MID ของห้องแชทหรือผู้รับ",
            },
            message: {
              type: "string",
              description: "ข้อความที่จะส่ง",
            },
          },
          required: ["chatMid", "message"],
        },
      },
      {
        name: "send_image",
        description: "ส่งรูปภาพไปยังห้องแชทหรือบุคคล ระบุ filePath (ไฟล์ในเครื่อง) หรือ imageUrl อย่างใดอย่างหนึ่ง",
        inputSchema: {
          type: "object",
          properties: {
            chatMid: {
              type: "string",
              description: "MID ของห้องแชทหรือผู้รับ",
            },
            filePath: {
              type: "string",
              description: "Path เต็มของไฟล์รูปในเครื่อง เช่น C:\\temp\\photo.jpg",
            },
            imageUrl: {
              type: "string",
              description: "URL ของรูปภาพ (http/https)",
            },
          },
          required: ["chatMid"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const c = await getClient();

    if (name === "list_chats") {
      const limit = args.limit || 30;
      const boxesRes = await c.base.talk.getMessageBoxes({
        messageBoxListRequest: {},
      });
      const boxes = (boxesRes.messageBoxes || []).slice(0, limit);

      const userMids = boxes.filter((b) => b.id.startsWith("u")).map((b) => b.id);
      const groupMids = boxes.filter((b) => b.id.startsWith("c")).map((b) => b.id);

      const userNames = {};
      if (userMids.length > 0) {
        try {
          const users = await c.base.talk.getContacts({ mids: userMids });
          users.forEach((u) => {
            userNames[u.mid] = u.displayName;
          });
        } catch (_) {}
      }

      const groupNames = {};
      if (groupMids.length > 0) {
        try {
          const groupsRes = await c.base.talk.getChats({ chatMids: groupMids });
          (groupsRes.chats || []).forEach((g) => {
            groupNames[g.chatMid] = g.chatName;
          });
        } catch (_) {}
      }

      const result = boxes.map((b) => {
        const isUser = b.id.startsWith("u");
        const chatName = isUser
          ? userNames[b.id] || "แชทส่วนตัว"
          : groupNames[b.id] || "กลุ่ม";
        return {
          type: isUser ? "INDIVIDUAL (1-on-1)" : "GROUP",
          name: chatName,
          mid: b.id,
          unreadCount: b.unreadCount || 0,
        };
      });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    if (name === "get_chat_messages") {
      const limit = args.limit || 20;
      const rawMessages = await c.base.talk.getRecentMessagesV2({
        messageBoxId: args.chatMid,
        messagesCount: limit,
      });

      const messages = await Promise.all(
        rawMessages.map((m) => TalkMessage.fromRawTalk(m, c))
      );

      const result = messages.map((m) => {
        const time = m.raw?.createdTime
          ? new Date(Number(m.raw.createdTime)).toLocaleString("th-TH")
          : null;
        let contentText = m.text;
        if (!contentText && m.raw?.contentType === "IMAGE") {
          contentText = `[รูปภาพ/IMAGE] (messageId: ${m.raw.id})`;
        } else if (!contentText && m.raw?.contentType !== "NONE") {
          contentText = `[${m.raw?.contentType}]`;
        }

        return {
          id: m.raw?.id,
          fromMid: m.from?.id,
          text: contentText || "",
          contentType: m.raw?.contentType,
          time: time,
          isMine: m.isMyMessage,
        };
      });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    if (name === "get_message_image") {
      const rawMessages = await c.base.talk.getRecentMessagesV2({
        messageBoxId: args.chatMid,
        messagesCount: 50,
      });

      const targetRaw = rawMessages.find(
        (m) => String(m.id) === String(args.messageId)
      );
      if (!targetRaw) {
        throw new Error(`ไม่พบข้อความ ID: ${args.messageId} ในประวัติแชทล่าสุด`);
      }

      const targetMessage = await TalkMessage.fromRawTalk(targetRaw, c);
      const blob = await targetMessage.getData();
      const buffer = Buffer.from(await blob.arrayBuffer());
      const base64Data = buffer.toString("base64");

      return {
        content: [
          {
            type: "text",
            text: `รูปภาพจากข้อความ ID: ${args.messageId}`,
          },
          {
            type: "image",
            data: base64Data,
            mimeType: "image/jpeg",
          },
        ],
      };
    }

    if (name === "send_message") {
      await c.base.talk.sendMessage({
        to: args.chatMid,
        text: args.message,
      });
      return {
        content: [
          {
            type: "text",
            text: `ส่งข้อความสำเร็จไปยัง ${args.chatMid}: "${args.message}"`,
          },
        ],
      };
    }

    if (name === "send_image") {
      let buffer, mime, filename;

      if (args.filePath) {
        if (!fs.existsSync(args.filePath)) {
          throw new Error(`ไม่พบไฟล์: ${args.filePath}`);
        }
        buffer = fs.readFileSync(args.filePath);
        filename = path.basename(args.filePath);
        const ext = path.extname(filename).toLowerCase();
        mime =
          ext === ".png"
            ? "image/png"
            : ext === ".gif"
            ? "image/gif"
            : ext === ".webp"
            ? "image/webp"
            : "image/jpeg";
      } else if (args.imageUrl) {
        const res = await fetch(args.imageUrl);
        if (!res.ok) throw new Error(`ดาวน์โหลดรูปไม่สำเร็จ: HTTP ${res.status}`);
        buffer = Buffer.from(await res.arrayBuffer());
        mime = res.headers.get("content-type") || "image/jpeg";
        filename = "image." + (mime.split("/")[1] || "jpg");
      } else {
        throw new Error("ต้องระบุ filePath หรือ imageUrl");
      }

      const blob = new Blob([buffer], { type: mime });
      await c.base.obs.uploadMediaByE2EE({
        data: blob,
        oType: mime === "image/gif" ? "gif" : "image",
        to: args.chatMid,
        filename: filename,
      });

      return {
        content: [
          {
            type: "text",
            text: `ส่งรูป ${filename} (${Math.round(
              buffer.length / 1024
            )} KB) ไปยัง ${args.chatMid} สำเร็จ`,
          },
        ],
      };
    }

    throw new Error(`ไม่พบ Tool: ${name}`);
  } catch (err) {
    console.error("[LINE-SelfBot Error]", err);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `เกิดข้อผิดพลาด: ${err.message || String(err)}`,
        },
      ],
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
