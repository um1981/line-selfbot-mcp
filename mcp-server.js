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
    throw new Error("ยังไม่มีไฟล์ storage.json กรุณารัน node run.js ใน PowerShell ก่อน");
  }

  const token = await storage.get("savedAuthToken");
  if (!token) {
    throw new Error("ยังไม่พบบัญชี LINE ที่ล็อกอิน กรุณารัน node run.js ใน PowerShell ก่อน");
  }

  client = await loginWithAuthToken(token, {
    device: "DESKTOPWIN",
    storage: storage,
  });

  return client;
}

// ดึงชื่อจาก MID หลายคน (แบ่งทีละ 100)
async function resolveNames(c, mids) {
  const names = {};
  for (let i = 0; i < mids.length; i += 100) {
    const chunk = mids.slice(i, i + 100);
    try {
      const users = await c.base.talk.getContacts({ mids: chunk });
      users.forEach((u) => {
        names[u.mid] = {
          displayName: u.displayName || "",
          statusMessage: u.statusMessage || "",
        };
      });
    } catch (e) {
      console.error("[resolveNames] chunk failed", e);
    }
  }
  return names;
}

// MIME type ตามนามสกุลไฟล์
const MIME_MAP = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".json": "application/json",
  ".zip": "application/zip",
  ".rar": "application/vnd.rar",
  ".7z": "application/x-7z-compressed",
};

function mimeOf(filename) {
  return MIME_MAP[path.extname(filename).toLowerCase()] || "application/octet-stream";
}

// โหลดข้อมูลจาก filePath หรือ url คืน { buffer, mime, filename }
async function loadMedia(args) {
  if (args.filePath) {
    if (!fs.existsSync(args.filePath)) {
      throw new Error(`ไม่พบไฟล์: ${args.filePath}`);
    }
    const buffer = fs.readFileSync(args.filePath);
    const filename = args.fileName || path.basename(args.filePath);
    return { buffer, mime: mimeOf(filename), filename };
  }
  const url = args.imageUrl || args.fileUrl;
  if (url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ดาวน์โหลดไม่สำเร็จ: HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    let filename = args.fileName || path.basename(new URL(url).pathname) || "file";
    let mime = res.headers.get("content-type")?.split(";")[0] || mimeOf(filename);
    if (!path.extname(filename)) {
      const ext = Object.keys(MIME_MAP).find((k) => MIME_MAP[k] === mime) || "";
      filename += ext;
    }
    return { buffer, mime, filename };
  }
  throw new Error("ต้องระบุ filePath หรือ URL");
}

// ---- Real-time inbox: รับ push event จาก LINE เก็บไว้ใน buffer ----
const inbox = [];
let listening = false;

async function startListening() {
  if (listening) return;
  const c = await getClient();

  c.on("message", (m) => {
    try {
      const isGroup = m.to?.type === "GROUP" || m.to?.type === "ROOM";
      const chatMid = isGroup ? m.to.id : m.isMyMessage ? m.to.id : m.from.id;
      inbox.push({
        id: m.raw?.id,
        chatMid: chatMid,
        chatType: isGroup ? "GROUP" : "INDIVIDUAL",
        fromMid: m.from?.id,
        text: m.text || `[${m.raw?.contentType}]`,
        contentType: m.raw?.contentType,
        receivedAt: Date.now(),
        isMine: m.isMyMessage,
      });
      if (inbox.length > 500) inbox.shift();
    } catch (e) {
      console.error("[inbox] push failed", e);
    }
  });

  c.listen({ talk: true });
  listening = true;
  console.error("[LINE-SelfBot] listening started");
}

const server = new Server(
  { name: "line-selfbot-mcp", version: "2.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_my_profile",
        description: "ดูโปรไฟล์บัญชี LINE ของเรา (ชื่อ, MID, ข้อความสถานะ)",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "update_my_profile",
        description:
          "เปลี่ยนชื่อที่แสดง (displayName) และ/หรือข้อความสถานะ (statusMessage) ของบัญชี LINE ตัวเอง ต้องยืนยันกับผู้ใช้ก่อนเปลี่ยน",
        inputSchema: {
          type: "object",
          properties: {
            displayName: {
              type: "string",
              description: "ชื่อใหม่ (ไม่เกิน 20 ตัวอักษร) ไม่ระบุ = ไม่เปลี่ยน",
            },
            statusMessage: {
              type: "string",
              description: "ข้อความสถานะใหม่ (ไม่เกิน 500 ตัวอักษร) ไม่ระบุ = ไม่เปลี่ยน",
            },
          },
        },
      },
      {
        name: "rename_friend",
        description:
          'ตั้งชื่อที่แสดงของเพื่อนในเครื่องเรา (เหมือนแก้ชื่อเพื่อนในแอป) ไม่กระทบชื่อจริงของเขา ส่งค่าว่างเพื่อคืนชื่อเดิม',
        inputSchema: {
          type: "object",
          properties: {
            userMid: { type: "string", description: "MID ของเพื่อน (ขึ้นต้นด้วย u)" },
            newName: {
              type: "string",
              description: 'ชื่อใหม่ หรือ "" เพื่อยกเลิกการตั้งชื่อ',
            },
          },
          required: ["userMid", "newName"],
        },
      },
      {
        name: "list_chats",
        description:
          "ดึงรายชื่อแชทล่าสุดทั้งหมด (ทั้งแชทส่วนตัว 1-on-1 และแชทกลุ่ม) เรียงตามการสนทนาล่าสุด",
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
        name: "list_friends",
        description:
          "ดึงรายชื่อเพื่อนทั้งหมดในสมุดรายชื่อ LINE พร้อม MID และข้อความสถานะ",
        inputSchema: {
          type: "object",
          properties: {
            search: {
              type: "string",
              description: "กรองชื่อเพื่อนที่มีคำนี้ (ไม่บังคับ)",
            },
          },
        },
      },
      {
        name: "list_group_members",
        description:
          "ดึงรายชื่อสมาชิกทั้งหมดในกลุ่ม พร้อม MID, ผู้สร้างกลุ่ม และผู้ที่ถูกเชิญแต่ยังไม่ตอบรับ",
        inputSchema: {
          type: "object",
          properties: {
            chatMid: {
              type: "string",
              description: "MID ของกลุ่ม (ขึ้นต้นด้วย c)",
            },
          },
          required: ["chatMid"],
        },
      },
      {
        name: "get_chat_messages",
        description:
          "อ่านประวัติข้อความล่าสุดในแชท หากข้อความเป็นรูปภาพ/ไฟล์จะแสดง [IMAGE]/[FILE] พร้อม messageId",
        inputSchema: {
          type: "object",
          properties: {
            chatMid: { type: "string", description: "MID ของแชท" },
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
        description:
          "ดึงรูปภาพจากข้อความที่มี ID ระบุ เพื่อให้ AI มองเห็นรูปภาพนั้นโดยตรง",
        inputSchema: {
          type: "object",
          properties: {
            chatMid: { type: "string", description: "MID ของห้องแชท" },
            messageId: {
              type: "string",
              description: "ID ของข้อความที่เป็นรูปภาพ",
            },
          },
          required: ["chatMid", "messageId"],
        },
      },
      {
        name: "download_message_file",
        description:
          "ดาวน์โหลดไฟล์แนบ (FILE/IMAGE/VIDEO/AUDIO) จากข้อความ บันทึกลงเครื่อง คืน path ของไฟล์",
        inputSchema: {
          type: "object",
          properties: {
            chatMid: { type: "string", description: "MID ของห้องแชท" },
            messageId: {
              type: "string",
              description: "ID ของข้อความที่มีไฟล์แนบ",
            },
            saveDir: {
              type: "string",
              description:
                "โฟลเดอร์ปลายทาง (ค่าเริ่มต้น: โฟลเดอร์ downloads ข้างไฟล์ server)",
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
            message: { type: "string", description: "ข้อความที่จะส่ง" },
          },
          required: ["chatMid", "message"],
        },
      },
      {
        name: "send_image",
        description:
          "ส่งรูปภาพไปยังห้องแชทหรือบุคคล ระบุ filePath (ไฟล์ในเครื่อง) หรือ imageUrl อย่างใดอย่างหนึ่ง",
        inputSchema: {
          type: "object",
          properties: {
            chatMid: {
              type: "string",
              description: "MID ของห้องแชทหรือผู้รับ",
            },
            filePath: {
              type: "string",
              description: "path เต็มของไฟล์รูปในเครื่อง เช่น C:\\temp\\a.jpg",
            },
            imageUrl: {
              type: "string",
              description: "URL ของรูปภาพ (http/https)",
            },
          },
          required: ["chatMid"],
        },
      },
      {
        name: "send_file",
        description:
          "ส่งไฟล์ (PDF, Word, Excel, ZIP, วิดีโอ, เสียง ฯลฯ) ไปยังห้องแชทหรือบุคคล ระบุ filePath หรือ fileUrl อย่างใดอย่างหนึ่ง",
        inputSchema: {
          type: "object",
          properties: {
            chatMid: {
              type: "string",
              description: "MID ของห้องแชทหรือผู้รับ",
            },
            filePath: {
              type: "string",
              description: "path เต็มของไฟล์ในเครื่อง เช่น C:\\temp\\report.pdf",
            },
            fileUrl: {
              type: "string",
              description: "URL ของไฟล์ (http/https)",
            },
            fileName: {
              type: "string",
              description: "ชื่อไฟล์ที่จะแสดงใน LINE (ไม่บังคับ)",
            },
          },
          required: ["chatMid"],
        },
      },
      {
        name: "wait_for_message",
        description:
          "รอข้อความใหม่จาก LINE แบบ real-time (สูงสุด 50 วินาทีต่อครั้ง) คืนข้อความที่เข้ามาระหว่างรอ ระบุ chatMid เพื่อรอเฉพาะห้อง เรียกซ้ำได้หากยังไม่มีข้อความ",
        inputSchema: {
          type: "object",
          properties: {
            chatMid: { type: "string", description: "รอเฉพาะห้องนี้ (ไม่บังคับ)" },
            timeoutSec: {
              type: "number",
              description: "วินาทีที่รอ (ค่าเริ่มต้น 50 สูงสุด 50)",
              default: 50,
            },
          },
        },
      },
      {
        name: "get_new_messages",
        description:
          "ดึงข้อความใหม่ที่เข้ามาตั้งแต่เริ่มฟัง (ไม่รอ คืนทันที) ใช้เช็คว่ามีใครตอบมาบ้างระหว่างที่ไม่ได้ดู",
        inputSchema: {
          type: "object",
          properties: {
            chatMid: { type: "string", description: "กรองเฉพาะห้องนี้ (ไม่บังคับ)" },
            clear: {
              type: "boolean",
              description: "ล้าง buffer หลังอ่าน (ค่าเริ่มต้น true)",
              default: true,
            },
          },
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const c = await getClient();

    if (name === "get_my_profile") {
      const p = await c.getMyProfile();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                displayName: p.displayName,
                mid: p.mid,
                statusMessage: p.statusMessage || "",
                userid: p.userid || "",
              },
              null,
              2
            ),
          },
        ],
      };
    }

    if (name === "update_my_profile") {
      if (!args.displayName && args.statusMessage === undefined) {
        throw new Error("ต้องระบุ displayName หรือ statusMessage อย่างน้อย 1 อย่าง");
      }
      const changed = [];
      if (args.displayName) {
        if (args.displayName.length > 20)
          throw new Error("displayName ยาวเกิน 20 ตัวอักษร");
        await c.updateMyDisplayName(args.displayName);
        changed.push(`ชื่อ → "${args.displayName}"`);
      }
      if (args.statusMessage !== undefined) {
        await c.updateMyStatusMessage(args.statusMessage);
        changed.push(`สถานะ → "${args.statusMessage}"`);
      }
      const profile = await c.getMyProfile();
      return {
        content: [
          {
            type: "text",
            text: `เปลี่ยนแล้ว: ${changed.join(", ")}\nโปรไฟล์ปัจจุบัน: ${
              profile.displayName
            } / ${profile.statusMessage || ""}`,
          },
        ],
      };
    }

    if (name === "rename_friend") {
      if (!String(args.userMid).startsWith("u")) {
        throw new Error("userMid ต้องขึ้นต้นด้วย u");
      }
      await c.base.talk.updateContactSetting({
        reqSeq: await c.base.getReqseq(),
        mid: args.userMid,
        flag: "CONTACT_SETTING_DISPLAY_NAME_OVERRIDE",
        value: args.newName || "",
      });
      return {
        content: [
          {
            type: "text",
            text: args.newName
              ? `ตั้งชื่อเพื่อน ${args.userMid} เป็น "${args.newName}" แล้ว`
              : `คืนชื่อเดิมของเพื่อน ${args.userMid} แล้ว`,
          },
        ],
      };
    }

    if (name === "list_chats") {
      const limit = args.limit || 30;
      const boxesRes = await c.base.talk.getMessageBoxes({
        messageBoxListRequest: {},
      });
      const boxes = (boxesRes.messageBoxes || []).slice(0, limit);

      const userMids = boxes.filter((b) => b.id.startsWith("u")).map((b) => b.id);
      const groupMids = boxes.filter((b) => b.id.startsWith("c")).map((b) => b.id);

      const userNames = await resolveNames(c, userMids);

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
          ? userNames[b.id]?.displayName || "แชทส่วนตัว"
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

    if (name === "list_friends") {
      const idsRes = await c.base.relation.getUserFriendIds({
        request: { blockStatus: "ALL" },
      });
      const mids = idsRes.userFriendMids || [];
      const names = await resolveNames(c, mids);

      let result = mids.map((mid) => ({
        name: names[mid]?.displayName || "ไม่มีชื่อ",
        mid: mid,
        statusMessage: names[mid]?.statusMessage || "",
      }));

      if (args.search) {
        const q = String(args.search).toLowerCase();
        result = result.filter((r) => r.name.toLowerCase().includes(q));
      }

      result.sort((a, b) => a.name.localeCompare(b.name, "th"));

      return {
        content: [
          {
            type: "text",
            text:
              `เพื่อนทั้งหมด ${mids.length} คน แสดง ${result.length} รายการ\n` +
              JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === "list_group_members") {
      if (!String(args.chatMid).startsWith("c")) {
        throw new Error("chatMid ต้องเป็น MID ของกลุ่ม (ขึ้นต้นด้วย c)");
      }

      const chat = await c.base.talk.getChat({
        chatMid: args.chatMid,
        withMembers: true,
        withInvitees: true,
      });

      const groupExtra = chat?.extra?.groupExtra || {};
      const memberMids = Object.keys(groupExtra.memberMids || {});
      const inviteeMids = Object.keys(groupExtra.inviteeMids || {});
      const creatorMid = groupExtra.creator || null;
      const myMid = c.base.profile?.mid;

      const names = await resolveNames(c, [...memberMids, ...inviteeMids]);

      const toEntry = (mid) => ({
        name:
          mid === myMid
            ? (c.base.profile?.displayName || "ฉัน") + " (ฉัน)"
            : names[mid]?.displayName || "ไม่มีชื่อ",
        mid: mid,
        isCreator: mid === creatorMid,
      });

      const members = memberMids
        .map(toEntry)
        .sort((a, b) => a.name.localeCompare(b.name, "th"));
      const invitees = inviteeMids.map(toEntry);

      const result = {
        groupName: chat?.chatName || "",
        groupMid: args.chatMid,
        memberCount: members.length,
        creatorMid: creatorMid,
        members: members,
        pendingInvitees: invitees,
      };

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

      const senderMids = [
        ...new Set(messages.map((m) => m.from?.id).filter(Boolean)),
      ];
      const senderNames = await resolveNames(c, senderMids);

      const result = messages.map((m) => {
        const time = m.raw?.createdTime
          ? new Date(Number(m.raw.createdTime)).toLocaleString("th-TH")
          : null;
        const ct = m.raw?.contentType;
        let contentText = m.text;
        if (!contentText && ct === "IMAGE") {
          contentText = `[รูปภาพ/IMAGE] (messageId: ${m.raw.id})`;
        } else if (!contentText && ct === "FILE") {
          const fname = m.raw?.contentMetadata?.FILE_NAME || "";
          const fsize = m.raw?.contentMetadata?.FILE_SIZE || "";
          contentText = `[ไฟล์/FILE] ${fname} ${
            fsize ? "(" + Math.round(Number(fsize) / 1024) + " KB)" : ""
          } (messageId: ${m.raw.id})`;
        } else if (!contentText && ct !== "NONE") {
          contentText = `[${ct}] (messageId: ${m.raw.id})`;
        }

        return {
          id: m.raw?.id,
          fromMid: m.from?.id,
          fromName: m.isMyMessage
            ? "ฉัน"
            : senderNames[m.from?.id]?.displayName || "",
          text: contentText || "",
          contentType: ct,
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

    if (name === "download_message_file") {
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
      const file = await targetMessage.getData();
      const buffer = Buffer.from(await file.arrayBuffer());

      const saveDir = args.saveDir || path.join(__dirname, "downloads");
      if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });

      let filename =
        file.name || targetRaw.contentMetadata?.FILE_NAME || `${args.messageId}.bin`;
      filename = filename.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
      const savePath = path.join(saveDir, filename);
      fs.writeFileSync(savePath, buffer);

      return {
        content: [
          {
            type: "text",
            text: `บันทึกไฟล์แล้ว: ${savePath} (${Math.round(
              buffer.length / 1024
            )} KB)`,
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
      const { buffer, mime, filename } = await loadMedia(args);
      if (!mime.startsWith("image/")) {
        throw new Error(`ไฟล์นี้ไม่ใช่รูปภาพ (${mime}) ใช้ send_file แทน`);
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

    if (name === "send_file") {
      const { buffer, mime, filename } = await loadMedia(args);
      const oType = mime.startsWith("video/")
        ? "video"
        : mime.startsWith("audio/")
        ? "audio"
        : "file";
      const blob = new Blob([buffer], { type: mime });
      await c.base.obs.uploadMediaByE2EE({
        data: blob,
        oType: oType,
        to: args.chatMid,
        filename: filename,
      });
      return {
        content: [
          {
            type: "text",
            text: `ส่งไฟล์ ${filename} (${Math.round(
              buffer.length / 1024
            )} KB, ${oType}) ไปยัง ${args.chatMid} สำเร็จ`,
          },
        ],
      };
    }

    if (name === "wait_for_message") {
      await startListening();
      const timeout = Math.min(args.timeoutSec || 50, 50) * 1000;
      const since = Date.now();
      const deadline = since + timeout;
      const match = (m) =>
        !m.isMine &&
        m.receivedAt >= since &&
        (!args.chatMid || m.chatMid === args.chatMid);

      while (Date.now() < deadline) {
        const found = inbox.filter(match);
        if (found.length) {
          const senderNames = await resolveNames(c, [
            ...new Set(found.map((m) => m.fromMid)),
          ]);
          const result = found.map((m) => ({
            ...m,
            fromName: senderNames[m.fromMid]?.displayName || "",
            receivedAt: new Date(m.receivedAt).toLocaleString("th-TH"),
          }));
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      return {
        content: [
          {
            type: "text",
            text: `ไม่มีข้อความใหม่ใน ${timeout / 1000} วินาที (เรียกซ้ำเพื่อรอต่อได้)`,
          },
        ],
      };
    }

    if (name === "get_new_messages") {
      await startListening();
      const clear = args.clear !== false;
      let found = inbox.filter(
        (m) => !m.isMine && (!args.chatMid || m.chatMid === args.chatMid)
      );

      if (found.length === 0) {
        return {
          content: [{ type: "text", text: "ยังไม่มีข้อความใหม่ตั้งแต่เริ่มฟัง" }],
        };
      }

      const senderNames = await resolveNames(c, [
        ...new Set(found.map((m) => m.fromMid)),
      ]);
      const result = found.map((m) => ({
        ...m,
        fromName: senderNames[m.fromMid]?.displayName || "",
        receivedAt: new Date(m.receivedAt).toLocaleString("th-TH"),
      }));

      if (clear) {
        for (const m of found) {
          const idx = inbox.indexOf(m);
          if (idx >= 0) inbox.splice(idx, 1);
        }
      }

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
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
