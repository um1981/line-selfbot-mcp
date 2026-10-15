# LINE SelfBot MCP Plugin สำหรับ Claude Desktop

คู่มือรวบรวมแนวทางการสร้าง MCP Server ที่ควบคุมบัญชี LINE ส่วนตัวผ่านไลบรารี `@evex/linejs` (LINE SelfBot) และติดตั้งเป็น Plugin ให้ Claude Desktop ใช้งานอ่าน/ส่งข้อความ รูปภาพ ไฟล์ และรับข้อความแบบ real-time จาก LINE ได้โดยตรง โดยไม่ต้องควบคุม UI ของโปรแกรม LINE Desktop

เวอร์ชันเอกสาร: 2.0.0 (14 tools)

---

## 1. ภาพรวมสถาปัตยกรรม

```
Claude Desktop
    │  (MCP over stdio / JSON-RPC)
    ▼
mcp-server.js  (Node.js + @modelcontextprotocol/sdk)
    │
    ▼
@evex/linejs   (จำลอง LINE Client, Apache Thrift RPC, E2EE)
    │  HTTPS / Long-polling
    ▼
LINE Server (legy.line-apps.com, obs.line-apps.com)
```

| องค์ประกอบ | หน้าที่ |
|---|---|
| `@evex/linejs` | ไลบรารี LINE SelfBot เชื่อมต่อเซิร์ฟเวอร์ LINE โดยตรง รองรับ Node.js / Deno / Bun |
| `run.js` | สคริปต์ล็อกอินครั้งแรกผ่าน QR Code และบันทึก Token ลง `storage.json` |
| `mcp-server.js` | MCP Server เปิด Tools ให้ Claude เรียกใช้ |
| `storage.json` | เก็บ AuthToken, Certificate และ E2EE Key (ข้อมูลลับ ห้ามแชร์) |
| `downloads\` | โฟลเดอร์ปลายทางของไฟล์ที่ดาวน์โหลดจาก LINE (สร้างอัตโนมัติ) |
| `claude_desktop_config.json` | ไฟล์ตั้งค่า MCP ของ Claude Desktop |

### เปรียบเทียบกับแนวทางอื่น

| แนวทาง | ข้อดี | ข้อเสีย |
|---|---|---|
| **LINE SelfBot (linejs)** – แนวทางนี้ | ไม่ต้องเปิด LINE Desktop, รัน Headless ได้, เร็ว, รับ-ส่งรูป/ไฟล์ได้, รับ push แบบ real-time | เสี่ยงผิดเงื่อนไขการใช้งาน LINE, อาจโดนระงับบัญชี |
| GUI Automation (line-desktop-mcp) | ใช้บัญชีที่ล็อกอินใน LINE Desktop อยู่แล้ว | แย่งเมาส์/คีย์บอร์ด, เปราะบางต่อการเปลี่ยน UI, ช้า |
| Official Messaging API | ปลอดภัย เสถียรที่สุด | ใช้ได้เฉพาะบัญชี Bot (OA) ไม่ใช่บัญชีส่วนตัว |

---

## 2. ความต้องการของระบบ

- Windows 10/11
- Node.js 22 ขึ้นไป (ทดสอบบน v24)
- Claude Desktop (เวอร์ชันล่าสุด)
- โทรศัพท์ที่ล็อกอิน LINE บัญชีที่ต้องการเชื่อม (ใช้สแกน QR และยืนยัน PIN)

> **ข้อแนะนำ:** ใช้บัญชี LINE สำรองในการทดสอบก่อนเสมอ และหลีกเลี่ยงการส่งข้อความถี่เกินไป

---

## 3. ขั้นตอนติดตั้ง

### 3.1 สร้างโปรเจกต์

เลือกโฟลเดอร์ที่ไม่อยู่ภายใต้ OneDrive และไม่มีภาษาไทย/ช่องว่างใน path หากเป็นไปได้ (ตัวอย่างในคู่มือใช้ `C:\Users\umsit\LINE SelfBot`)

```powershell
mkdir "C:\Users\umsit\LINE SelfBot"
cd "C:\Users\umsit\LINE SelfBot"
npm init -y
npm pkg set type="module"
```

### 3.2 ติดตั้งไลบรารี

```powershell
npx jsr add @evex/linejs
npm install @modelcontextprotocol/sdk qrcode-terminal
```

คำเตือน `npm warn deprecated` และ `npm audit` ที่ปรากฏไม่กระทบการทำงาน

---

## 4. ไฟล์ `run.js` – ล็อกอินครั้งแรก

ไฟล์นี้ใช้รันใน PowerShell เพียงครั้งแรก (หรือเมื่อ Token หมดอายุ) เพื่อสแกน QR Code และบันทึก `savedAuthToken` ลง `storage.json`

```javascript
import { loginWithQR, loginWithAuthToken } from "@evex/linejs";
import { FileStorage } from "@evex/linejs/storage";
import qrcode from "qrcode-terminal";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const storage = new FileStorage(path.join(__dirname, "storage.json"));

const savedToken = await storage.get("savedAuthToken");
let client;

if (savedToken && typeof savedToken === "string") {
  console.log("พบ Token เดิม กำลังเข้าสู่ระบบด้วย Token...");
  try {
    client = await loginWithAuthToken(savedToken, {
      device: "DESKTOPWIN",
      storage: storage,
    });
    console.log("เข้าสู่ระบบด้วย Token สำเร็จ!");
  } catch (err) {
    console.warn("Token เดิมหมดอายุหรือไม่ถูกต้อง:", err.message);
  }
}

if (!client) {
  console.log("กำลังสร้าง QR Code...");
  client = await loginWithQR({
    onReceiveQRUrl(url) {
      console.log("\nสแกน QR Code ด้านล่างนี้ด้วยแอป LINE บนมือถือ:\n");
      qrcode.generate(url, { small: true });
    },
    onPincodeRequest(pin) {
      console.log("\n>>> กรอกรหัส PIN นี้ในมือถือ:", pin, "<<<\n");
    },
  }, {
    device: "DESKTOPWIN",
    storage: storage,
  });

  const token = client.base.authToken;
  if (token) {
    await storage.set("savedAuthToken", token);
    console.log("บันทึก AuthToken สำเร็จ!");
  }
}

console.log("\nกำลังทดสอบดึงรายชื่อแชท...");
const chats = await client.fetchJoinedChats();
console.log(`\nสำเร็จ! พบห้องแชทกลุ่มทั้งหมด ${chats.length} รายการ:`);
chats.slice(0, 5).forEach((c, idx) => {
  console.log(`${idx + 1}. ${c.name || "ไม่มีชื่อ"} (MID: ${c.mid})`);
});
```

### วิธีรัน

```powershell
node run.js
```

1. QR Code จะแสดงบนหน้าจอ PowerShell
2. เปิดแอป LINE บนมือถือ สแกน QR Code
3. กรอกรหัส PIN ที่แสดงใน PowerShell ลงในมือถือ
4. เมื่อขึ้นข้อความ "สำเร็จ! พบห้องแชทกลุ่มทั้งหมด..." แสดงว่า `storage.json` พร้อมใช้งาน

---

## 5. ไฟล์ `mcp-server.js` – MCP Server (v2.0.0)

```javascript
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
      users.forEach(u => {
        names[u.mid] = { displayName: u.displayName || "", statusMessage: u.statusMessage || "" };
      });
    } catch (e) {
      console.error("[resolveNames] chunk failed", e);
    }
  }
  return names;
}

// MIME type ตามนามสกุลไฟล์
const MIME_MAP = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp",
  ".mp4": "video/mp4", ".mov": "video/quicktime",
  ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".wav": "audio/wav",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".txt": "text/plain", ".csv": "text/csv", ".json": "application/json",
  ".zip": "application/zip", ".rar": "application/vnd.rar", ".7z": "application/x-7z-compressed",
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
      const ext = Object.keys(MIME_MAP).find(k => MIME_MAP[k] === mime) || "";
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
      const chatMid = isGroup ? m.to.id : (m.isMyMessage ? m.to.id : m.from.id);
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
        description: "เปลี่ยนชื่อที่แสดง (displayName) และ/หรือข้อความสถานะ (statusMessage) ของบัญชี LINE ตัวเอง ต้องยืนยันกับผู้ใช้ก่อนเปลี่ยน",
        inputSchema: {
          type: "object",
          properties: {
            displayName: { type: "string", description: "ชื่อใหม่ (ไม่เกิน 20 ตัวอักษร) ไม่ระบุ = ไม่เปลี่ยน" },
            statusMessage: { type: "string", description: "ข้อความสถานะใหม่ (ไม่เกิน 500 ตัวอักษร) ไม่ระบุ = ไม่เปลี่ยน" },
          },
        },
      },
      {
        name: "rename_friend",
        description: "ตั้งชื่อที่แสดงของเพื่อนในเครื่องเรา (เหมือนแก้ชื่อเพื่อนในแอป) ไม่กระทบชื่อจริงของเขา ส่งค่าว่างเพื่อคืนชื่อเดิม",
        inputSchema: {
          type: "object",
          properties: {
            userMid: { type: "string", description: "MID ของเพื่อน (ขึ้นต้นด้วย u)" },
            newName: { type: "string", description: "ชื่อใหม่ หรือ \"\" เพื่อยกเลิกการตั้งชื่อ" },
          },
          required: ["userMid", "newName"],
        },
      },
      {
        name: "list_chats",
        description: "ดึงรายชื่อแชทล่าสุดทั้งหมด (ทั้งแชทส่วนตัว 1-on-1 และแชทกลุ่ม) เรียงตามการสนทนาล่าสุด",
        inputSchema: {
          type: "object",
          properties: {
            limit: { type: "number", description: "จำนวนห้องแชทที่ต้องการดึง (ค่าเริ่มต้น 30)", default: 30 },
          },
        },
      },
      {
        name: "list_friends",
        description: "ดึงรายชื่อเพื่อนทั้งหมดในสมุดรายชื่อ LINE พร้อม MID และข้อความสถานะ",
        inputSchema: {
          type: "object",
          properties: {
            search: { type: "string", description: "กรองชื่อเพื่อนที่มีคำนี้ (ไม่บังคับ)" },
          },
        },
      },
      {
        name: "list_group_members",
        description: "ดึงรายชื่อสมาชิกทั้งหมดในกลุ่ม พร้อม MID, ผู้สร้างกลุ่ม และผู้ที่ถูกเชิญแต่ยังไม่ตอบรับ",
        inputSchema: {
          type: "object",
          properties: {
            chatMid: { type: "string", description: "MID ของกลุ่ม (ขึ้นต้นด้วย c)" },
          },
          required: ["chatMid"],
        },
      },
      {
        name: "get_chat_messages",
        description: "อ่านประวัติข้อความล่าสุดในแชท หากข้อความเป็นรูปภาพ/ไฟล์จะแสดง [IMAGE]/[FILE] พร้อม messageId",
        inputSchema: {
          type: "object",
          properties: {
            chatMid: { type: "string", description: "MID ของแชท" },
            limit: { type: "number", description: "จำนวนข้อความที่ต้องการอ่าน (ค่าเริ่มต้น 20)", default: 20 },
          },
          required: ["chatMid"],
        },
      },
      {
        name: "get_message_image",
        description: "ดึงรูปภาพจากข้อความที่มี ID ระบุ เพื่อให้ AI มองเห็นรูปภาพนั้นโดยตรง",
        inputSchema: {
          type: "object",
          properties: {
            chatMid: { type: "string", description: "MID ของห้องแชท" },
            messageId: { type: "string", description: "ID ของข้อความที่เป็นรูปภาพ" },
          },
          required: ["chatMid", "messageId"],
        },
      },
      {
        name: "download_message_file",
        description: "ดาวน์โหลดไฟล์แนบ (FILE/IMAGE/VIDEO/AUDIO) จากข้อความ บันทึกลงเครื่อง คืน path ของไฟล์",
        inputSchema: {
          type: "object",
          properties: {
            chatMid: { type: "string", description: "MID ของห้องแชท" },
            messageId: { type: "string", description: "ID ของข้อความที่มีไฟล์แนบ" },
            saveDir: { type: "string", description: "โฟลเดอร์ปลายทาง (ค่าเริ่มต้น: โฟลเดอร์ downloads ข้างไฟล์ server)" },
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
            chatMid: { type: "string", description: "MID ของห้องแชทหรือผู้รับ" },
            message: { type: "string", description: "ข้อความที่จะส่ง" },
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
            chatMid: { type: "string", description: "MID ของห้องแชทหรือผู้รับ" },
            filePath: { type: "string", description: "path เต็มของไฟล์รูปในเครื่อง เช่น C:\\temp\\a.jpg" },
            imageUrl: { type: "string", description: "URL ของรูปภาพ (http/https)" },
          },
          required: ["chatMid"],
        },
      },
      {
        name: "send_file",
        description: "ส่งไฟล์ (PDF, Word, Excel, ZIP, วิดีโอ, เสียง ฯลฯ) ไปยังห้องแชทหรือบุคคล ระบุ filePath หรือ fileUrl อย่างใดอย่างหนึ่ง",
        inputSchema: {
          type: "object",
          properties: {
            chatMid: { type: "string", description: "MID ของห้องแชทหรือผู้รับ" },
            filePath: { type: "string", description: "path เต็มของไฟล์ในเครื่อง เช่น C:\\temp\\report.pdf" },
            fileUrl: { type: "string", description: "URL ของไฟล์ (http/https)" },
            fileName: { type: "string", description: "ชื่อไฟล์ที่จะแสดงใน LINE (ไม่บังคับ)" },
          },
          required: ["chatMid"],
        },
      },
      {
        name: "wait_for_message",
        description: "รอข้อความใหม่จาก LINE แบบ real-time (สูงสุด 50 วินาทีต่อครั้ง) คืนข้อความที่เข้ามาระหว่างรอ ระบุ chatMid เพื่อรอเฉพาะห้อง เรียกซ้ำได้หากยังไม่มีข้อความ",
        inputSchema: {
          type: "object",
          properties: {
            chatMid: { type: "string", description: "รอเฉพาะห้องนี้ (ไม่บังคับ)" },
            timeoutSec: { type: "number", description: "วินาทีที่รอ (ค่าเริ่มต้น 50 สูงสุด 50)", default: 50 },
          },
        },
      },
      {
        name: "get_new_messages",
        description: "ดึงข้อความใหม่ที่เข้ามาตั้งแต่เริ่มฟัง (ไม่รอ คืนทันที) ใช้เช็คว่ามีใครตอบมาบ้างระหว่างที่ไม่ได้ดู",
        inputSchema: {
          type: "object",
          properties: {
            chatMid: { type: "string", description: "กรองเฉพาะห้องนี้ (ไม่บังคับ)" },
            clear: { type: "boolean", description: "ล้าง buffer หลังอ่าน (ค่าเริ่มต้น true)", default: true },
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
        content: [{ type: "text", text: JSON.stringify({
          displayName: p.displayName,
          mid: p.mid,
          statusMessage: p.statusMessage || "",
          userid: p.userid || "",
        }, null, 2) }],
      };
    }

    if (name === "update_my_profile") {
      if (!args.displayName && args.statusMessage === undefined) {
        throw new Error("ต้องระบุ displayName หรือ statusMessage อย่างน้อย 1 อย่าง");
      }
      const changed = [];
      if (args.displayName) {
        if (args.displayName.length > 20) throw new Error("displayName ยาวเกิน 20 ตัวอักษร");
        await c.updateMyDisplayName(args.displayName);
        changed.push(`ชื่อ → "${args.displayName}"`);
      }
      if (args.statusMessage !== undefined) {
        await c.updateMyStatusMessage(args.statusMessage);
        changed.push(`สถานะ → "${args.statusMessage}"`);
      }
      const profile = await c.getMyProfile();
      return {
        content: [{ type: "text", text: `เปลี่ยนแล้ว: ${changed.join(", ")}\nโปรไฟล์ปัจจุบัน: ${profile.displayName} / ${profile.statusMessage || ""}` }],
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
        content: [{ type: "text", text: args.newName
          ? `ตั้งชื่อเพื่อน ${args.userMid} เป็น "${args.newName}" แล้ว`
          : `คืนชื่อเดิมของเพื่อน ${args.userMid} แล้ว` }],
      };
    }

    if (name === "list_chats") {
      const limit = args.limit || 30;
      const boxesRes = await c.base.talk.getMessageBoxes({
        messageBoxListRequest: {},
      });
      const boxes = (boxesRes.messageBoxes || []).slice(0, limit);

      const userMids = boxes.filter(b => b.id.startsWith("u")).map(b => b.id);
      const groupMids = boxes.filter(b => b.id.startsWith("c")).map(b => b.id);

      const userNames = await resolveNames(c, userMids);

      const groupNames = {};
      if (groupMids.length > 0) {
        try {
          const groupsRes = await c.base.talk.getChats({ chatMids: groupMids });
          (groupsRes.chats || []).forEach(g => { groupNames[g.chatMid] = g.chatName; });
        } catch (_) {}
      }

      const result = boxes.map(b => {
        const isUser = b.id.startsWith("u");
        const name = isUser ? (userNames[b.id]?.displayName || "แชทส่วนตัว") : (groupNames[b.id] || "กลุ่ม");
        return {
          type: isUser ? "INDIVIDUAL (1-on-1)" : "GROUP",
          name: name,
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

      let result = mids.map(mid => ({
        name: names[mid]?.displayName || "ไม่มีชื่อ",
        mid: mid,
        statusMessage: names[mid]?.statusMessage || "",
      }));

      if (args.search) {
        const q = String(args.search).toLowerCase();
        result = result.filter(r => r.name.toLowerCase().includes(q));
      }

      result.sort((a, b) => a.name.localeCompare(b.name, "th"));

      return {
        content: [{ type: "text", text: `เพื่อนทั้งหมด ${mids.length} คน แสดง ${result.length} รายการ\n` + JSON.stringify(result, null, 2) }],
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
        name: mid === myMid ? (c.base.profile?.displayName || "ฉัน") + " (ฉัน)" : (names[mid]?.displayName || "ไม่มีชื่อ"),
        mid: mid,
        isCreator: mid === creatorMid,
      });

      const members = memberMids.map(toEntry).sort((a, b) => a.name.localeCompare(b.name, "th"));
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
        rawMessages.map(m => TalkMessage.fromRawTalk(m, c))
      );

      const senderMids = [...new Set(messages.map(m => m.from?.id).filter(Boolean))];
      const senderNames = await resolveNames(c, senderMids);

      const result = messages.map((m) => {
        const time = m.raw?.createdTime ? new Date(Number(m.raw.createdTime)).toLocaleString("th-TH") : null;
        const ct = m.raw?.contentType;
        let contentText = m.text;
        if (!contentText && ct === "IMAGE") {
          contentText = `[รูปภาพ/IMAGE] (messageId: ${m.raw.id})`;
        } else if (!contentText && ct === "FILE") {
          const fname = m.raw?.contentMetadata?.FILE_NAME || "";
          const fsize = m.raw?.contentMetadata?.FILE_SIZE || "";
          contentText = `[ไฟล์/FILE] ${fname} ${fsize ? "(" + Math.round(Number(fsize) / 1024) + " KB)" : ""} (messageId: ${m.raw.id})`;
        } else if (!contentText && ct !== "NONE") {
          contentText = `[${ct}] (messageId: ${m.raw.id})`;
        }

        return {
          id: m.raw?.id,
          fromMid: m.from?.id,
          fromName: m.isMyMessage ? "ฉัน" : (senderNames[m.from?.id]?.displayName || ""),
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

      const targetRaw = rawMessages.find(m => String(m.id) === String(args.messageId));
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

      const targetRaw = rawMessages.find(m => String(m.id) === String(args.messageId));
      if (!targetRaw) {
        throw new Error(`ไม่พบข้อความ ID: ${args.messageId} ในประวัติแชทล่าสุด`);
      }

      const targetMessage = await TalkMessage.fromRawTalk(targetRaw, c);
      const file = await targetMessage.getData();
      const buffer = Buffer.from(await file.arrayBuffer());

      const saveDir = args.saveDir || path.join(__dirname, "downloads");
      if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });

      let filename = file.name || targetRaw.contentMetadata?.FILE_NAME || `${args.messageId}.bin`;
      filename = filename.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
      const savePath = path.join(saveDir, filename);
      fs.writeFileSync(savePath, buffer);

      return {
        content: [{ type: "text", text: `บันทึกไฟล์แล้ว: ${savePath} (${Math.round(buffer.length / 1024)} KB)` }],
      };
    }

    if (name === "send_message") {
      await c.base.talk.sendMessage({
        to: args.chatMid,
        text: args.message,
      });
      return {
        content: [{ type: "text", text: `ส่งข้อความสำเร็จไปยัง ${args.chatMid}: "${args.message}"` }],
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
        content: [{ type: "text", text: `ส่งรูป ${filename} (${Math.round(buffer.length / 1024)} KB) ไปยัง ${args.chatMid} สำเร็จ` }],
      };
    }

    if (name === "send_file") {
      const { buffer, mime, filename } = await loadMedia(args);
      const oType = mime.startsWith("video/") ? "video"
                  : mime.startsWith("audio/") ? "audio"
                  : "file";
      const blob = new Blob([buffer], { type: mime });
      await c.base.obs.uploadMediaByE2EE({
        data: blob,
        oType: oType,
        to: args.chatMid,
        filename: filename,
      });
      return {
        content: [{ type: "text", text: `ส่งไฟล์ ${filename} (${Math.round(buffer.length / 1024)} KB, ${oType}) ไปยัง ${args.chatMid} สำเร็จ` }],
      };
    }

    if (name === "wait_for_message") {
      await startListening();
      const timeout = Math.min(args.timeoutSec || 50, 50) * 1000;
      const since = Date.now();
      const deadline = since + timeout;
      const match = (m) => !m.isMine && m.receivedAt >= since && (!args.chatMid || m.chatMid === args.chatMid);

      while (Date.now() < deadline) {
        const found = inbox.filter(match);
        if (found.length) {
          const senderNames = await resolveNames(c, [...new Set(found.map(m => m.fromMid))]);
          const result = found.map(m => ({
            ...m,
            fromName: senderNames[m.fromMid]?.displayName || "",
            receivedAt: new Date(m.receivedAt).toLocaleString("th-TH"),
          }));
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }
        await new Promise(r => setTimeout(r, 1000));
      }
      return { content: [{ type: "text", text: `ไม่มีข้อความใหม่ใน ${timeout / 1000} วินาที (เรียกซ้ำเพื่อรอต่อได้)` }] };
    }

    if (name === "get_new_messages") {
      await startListening();
      const clear = args.clear !== false;
      let found = inbox.filter(m => !m.isMine && (!args.chatMid || m.chatMid === args.chatMid));

      if (found.length === 0) {
        return { content: [{ type: "text", text: "ยังไม่มีข้อความใหม่ตั้งแต่เริ่มฟัง" }] };
      }

      const senderNames = await resolveNames(c, [...new Set(found.map(m => m.fromMid))]);
      const result = found.map(m => ({
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

      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    throw new Error(`ไม่พบ Tool: ${name}`);
  } catch (err) {
    console.error("[LINE-SelfBot Error]", err);
    return {
      isError: true,
      content: [{ type: "text", text: `เกิดข้อผิดพลาด: ${err.message || String(err)}` }],
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

### จุดสำคัญในการออกแบบ

| ประเด็น | เหตุผล |
|---|---|
| ใช้ `path.join(__dirname, "storage.json")` | Claude Desktop รัน process ด้วย working directory `C:\Windows\System32` การใช้ path สัมพัทธ์จะทำให้เขียนไฟล์ไม่ได้ (EPERM) |
| ใช้ `loginWithAuthToken` เท่านั้น | MCP Server ห้ามรอ QR/PIN เพราะไม่มีหน้าจอให้ผู้ใช้สแกน จะค้างจน timeout |
| ห้าม `console.log` ใน MCP Server | stdout ถูกใช้สำหรับ JSON-RPC การพิมพ์ข้อความออก stdout จะทำให้โปรโตคอลพัง ให้ใช้ `console.error` แทน |
| ใช้ `getMessageBoxes` แทน `fetchJoinedChats` | `fetchJoinedChats` คืนเฉพาะกลุ่ม (MID ขึ้นต้น `c`) ส่วน `getMessageBoxes` คืนทั้งกลุ่มและแชทส่วนตัว (MID ขึ้นต้น `u`) |
| ใช้ `getRecentMessagesV2` | อ่านข้อความได้ทั้งแชทกลุ่มและแชทส่วนตัวในคำสั่งเดียว |
| `import { TalkMessage } from "@evex/linejs"` | ไลบรารีไม่อนุญาต import path ย่อย (`ERR_PACKAGE_PATH_NOT_EXPORTED`) |
| ใช้ `relation.getUserFriendIds` + `talk.getContacts` | คลาส `User` ของ linejs ไม่มี property `name` การดึงชื่อต้องผ่าน `getContacts` ซึ่งคืน `displayName` |
| ใช้ `talk.getChat({ withMembers: true })` | สมาชิกกลุ่มอยู่ใน `extra.groupExtra.memberMids` (map ของ MID → timestamp) |
| `resolveNames()` แบ่งทีละ 100 MID | ป้องกัน request ใหญ่เกินไปเมื่อมีเพื่อน/สมาชิกจำนวนมาก |
| รับรูปเป็น `{ type: "image", data, mimeType }` | รูปแบบมาตรฐาน MCP ทำให้ Claude มองเห็นและวิเคราะห์ภาพได้ |
| ส่งรูป/ไฟล์ด้วย `obs.uploadMediaByE2EE` | อัปโหลดแบบเข้ารหัส E2EE และส่งเข้าแชทในคำสั่งเดียว เลือก `oType` (image/gif/video/audio/file) ตาม MIME รองรับเฉพาะ MID `u...` และ `c...` |
| `client.listen({ talk: true })` + buffer `inbox` | รับ push event จาก LINE แบบ real-time เก็บไว้ให้ Claude ดึงผ่าน `wait_for_message` / `get_new_messages` |
| `wait_for_message` จำกัด 50 วินาที | MCP tool call มี timeout ประมาณ 60 วินาที ต้องคืนผลก่อน |
| ดักจับ Error แล้วคืน `isError: true` | Claude เห็นสาเหตุที่แท้จริงแทนข้อความ "connector returned an error" |

---

## 6. ติดตั้งเป็น Plugin บน Claude Desktop

### วิธีที่ 1: ตั้งค่าผ่าน `claude_desktop_config.json` (แนะนำสำหรับใช้งานส่วนตัว)

เปิดไฟล์ `%APPDATA%\Claude\claude_desktop_config.json` แล้วเพิ่ม:

```json
{
  "mcpServers": {
    "LINE-SelfBot": {
      "command": "node",
      "args": ["C:\\Users\\umsit\\LINE SelfBot\\mcp-server.js"],
      "cwd": "C:\\Users\\umsit\\LINE SelfBot"
    }
  }
}
```

จากนั้น Restart Claude Desktop

### วิธีที่ 2: แพ็กเป็น Desktop Extension (`.mcpb`) สำหรับแจกจ่าย/ติดตั้งด้วยคลิกเดียว

สร้างไฟล์ `manifest.json` ในโฟลเดอร์โปรเจกต์:

```json
{
  "manifest_version": "0.2",
  "name": "line-selfbot-mcp",
  "display_name": "LINE SelfBot",
  "version": "2.0.0",
  "description": "อ่าน ส่ง และรับข้อความ รูปภาพ ไฟล์จากบัญชี LINE ส่วนตัวผ่าน Claude",
  "author": {
    "name": "Your Name"
  },
  "server": {
    "type": "node",
    "entry_point": "mcp-server.js",
    "mcp_config": {
      "command": "node",
      "args": ["${__dirname}/mcp-server.js"]
    }
  },
  "tools": [
    { "name": "get_my_profile", "description": "ดูโปรไฟล์ตัวเอง" },
    { "name": "update_my_profile", "description": "เปลี่ยนชื่อ/สถานะตัวเอง" },
    { "name": "rename_friend", "description": "ตั้งชื่อเพื่อน" },
    { "name": "list_chats", "description": "ดึงรายชื่อแชทล่าสุด" },
    { "name": "list_friends", "description": "ดึงรายชื่อเพื่อน" },
    { "name": "list_group_members", "description": "ดึงสมาชิกในกลุ่ม" },
    { "name": "get_chat_messages", "description": "อ่านประวัติข้อความ" },
    { "name": "get_message_image", "description": "ดูรูปภาพจากข้อความ" },
    { "name": "download_message_file", "description": "ดาวน์โหลดไฟล์แนบ" },
    { "name": "send_message", "description": "ส่งข้อความ" },
    { "name": "send_image", "description": "ส่งรูปภาพ" },
    { "name": "send_file", "description": "ส่งไฟล์" },
    { "name": "wait_for_message", "description": "รอข้อความใหม่แบบ real-time" },
    { "name": "get_new_messages", "description": "ดึงข้อความใหม่ที่เข้ามา" }
  ],
  "compatibility": {
    "platforms": ["win32", "darwin"],
    "runtimes": { "node": ">=22.0.0" }
  }
}
```

แพ็กและติดตั้ง:

```powershell
npx @anthropic-ai/mcpb pack
```

จะได้ไฟล์ `line-selfbot-mcp.mcpb` ดับเบิลคลิกเพื่อติดตั้งใน Claude Desktop (Settings → Extensions)

> **หมายเหตุ:** ไฟล์ `.mcpb` จะรวม `node_modules` เข้าไปด้วย ควรสร้าง `.mcpbignore` เพื่อยกเว้น `storage.json`, `downloads/`, `run.js`, `test-*.js` ไม่ให้ติดไปในแพ็กเกจ และผู้ติดตั้งต้องรัน `run.js` เพื่อล็อกอินในโฟลเดอร์ที่ Extension ถูกติดตั้งเองอีกครั้ง

---

## 7. Tools ที่เปิดให้ Claude ใช้ (14 tools)

### โปรไฟล์

| Tool | Input | ผลลัพธ์ |
|---|---|---|
| `get_my_profile` | – | ชื่อ, MID, ข้อความสถานะ, LINE ID |
| `update_my_profile` | `displayName` (≤20 ตัวอักษร), `statusMessage` (≤500) อย่างน้อย 1 อย่าง | ยืนยันการเปลี่ยน + โปรไฟล์ปัจจุบัน |
| `rename_friend` | `userMid`, `newName` (`""` = คืนชื่อเดิม) | ยืนยันการตั้งชื่อ |

### รายชื่อ

| Tool | Input | ผลลัพธ์ |
|---|---|---|
| `list_chats` | `limit` (ค่าเริ่มต้น 30) | แชทส่วนตัวและกลุ่ม พร้อม MID, ประเภท, จำนวนยังไม่อ่าน |
| `list_friends` | `search` (ไม่บังคับ) | เพื่อนทั้งหมด พร้อม MID และข้อความสถานะ เรียงตามชื่อ |
| `list_group_members` | `chatMid` (`c...`) | ชื่อกลุ่ม, สมาชิก, ผู้สร้าง (`isCreator`), ผู้ถูกเชิญที่ยังไม่ตอบรับ |

### อ่าน

| Tool | Input | ผลลัพธ์ |
|---|---|---|
| `get_chat_messages` | `chatMid`, `limit` (ค่าเริ่มต้น 20) | ข้อความล่าสุด พร้อม ID, ชื่อผู้ส่ง, เวลา, ประเภทเนื้อหา (`[IMAGE]`/`[FILE]` พร้อม messageId) |
| `get_message_image` | `chatMid`, `messageId` | รูปภาพ Base64 ที่ Claude มองเห็นได้ |
| `download_message_file` | `chatMid`, `messageId`, `saveDir` (ไม่บังคับ) | path ของไฟล์ที่บันทึก (ค่าเริ่มต้น `downloads\`) |

### ส่ง

| Tool | Input | ผลลัพธ์ |
|---|---|---|
| `send_message` | `chatMid`, `message` | ยืนยันการส่ง |
| `send_image` | `chatMid`, `filePath` หรือ `imageUrl` | ยืนยันการส่ง พร้อมชื่อไฟล์และขนาด |
| `send_file` | `chatMid`, `filePath` หรือ `fileUrl`, `fileName` (ไม่บังคับ) | ยืนยันการส่ง พร้อมประเภท (file/video/audio) |

### Real-time

| Tool | Input | ผลลัพธ์ |
|---|---|---|
| `wait_for_message` | `chatMid` (ไม่บังคับ), `timeoutSec` (≤50) | ข้อความใหม่ที่เข้ามาระหว่างรอ หรือแจ้งว่าไม่มี |
| `get_new_messages` | `chatMid` (ไม่บังคับ), `clear` (ค่าเริ่มต้น true) | ข้อความใหม่ใน buffer ตั้งแต่เริ่มฟัง คืนทันที |

### ตัวอย่างคำสั่งใน Claude

- "ดูรายชื่อแชท LINE ล่าสุด"
- "ดูรายชื่อเพื่อน LINE ที่ชื่อมีคำว่า ทัดดาว"
- "ใครอยู่ในกลุ่ม BPC Dynamics Team บ้าง"
- "อ่าน 10 ข้อความล่าสุดในห้อง BPC Dynamics Team"
- "ในห้อง ... ถ้ามีรูปภาพ ให้ดึงมาดูแล้วอธิบายว่าในรูปคืออะไร"
- "ดาวน์โหลดไฟล์ PDF ล่าสุดในห้อง ... แล้วสรุปเนื้อหา"
- "สรุปบทสนทนาวันนี้ในกลุ่ม ... แล้วส่งสรุปกลับเข้าห้องเดิม"
- "ส่งรูป `C:\Users\umsit\Pictures\report.png` ไปห้อง BPC Dynamics Team"
- "ส่งไฟล์ `C:\Users\umsit\Documents\report.pdf` ไปหาทัดดาว"
- "ส่ง 'ประชุมกี่โมง' หาทัดดาว แล้วรอคำตอบ สรุปให้"
- "เปลี่ยนชื่อ LINE ฉันเป็น Sittha (BPC)"

### ข้อจำกัดของการส่งรูป/ไฟล์

- รองรับเฉพาะแชทส่วนตัว (`u...`) และกลุ่ม (`c...`) ไม่รองรับ OpenChat (`m...`/`t...`)
- รูปที่ผู้ใช้แนบในหน้าต่าง Claude ไม่ถูกบันทึกเป็นไฟล์อัตโนมัติ ต้องมีไฟล์ในเครื่องหรือ URL ที่เข้าถึงได้
- LINE จำกัดไฟล์ทั่วไปประมาณ 1 GB วิดีโอประมาณ 200 MB ไฟล์ใหญ่อาจ timeout (60 วินาที) ก่อนอัปโหลดเสร็จ

### ข้อจำกัดของ Real-time

- Claude Desktop เป็น request/response Claude จะไม่เริ่มสนทนาเองเมื่อมีข้อความเข้า ต้องให้ผู้ใช้สั่งก่อนเสมอ
- `wait_for_message` รอได้ครั้งละไม่เกิน 50 วินาที Claude ต้องเรียกซ้ำหากต้องการรอนานกว่านั้น และอาจหยุดวนเองหลังหลายรอบ
- `listen()` เริ่มทำงานเมื่อเรียก `wait_for_message` หรือ `get_new_messages` ครั้งแรก และฟังต่อเนื่องจนกว่า Claude Desktop ปิด ใช้ long-polling 1 session ตลอดเวลา
- buffer `inbox` เก็บสูงสุด 500 ข้อความ ข้อความเก่าถูกทิ้ง
- หากต้องการ auto-reply ตลอด 24 ชม. โดยไม่ต้องมีคนสั่ง ให้เขียนบอทแยก (`client.on("message")` + เรียก LLM API โดยตรง) รันด้วย PM2 แทนการใช้ผ่าน Claude Desktop

### การเพิ่ม Tool ในอนาคต

| Tool | เมธอดใน linejs |
|---|---|
| `reply_message` | `TalkMessage.reply(text)` |
| `send_reaction` | `client.base.talk.react({ id: BigInt(messageId), reaction: "NICE" })` |
| `unsend_message` | `TalkMessage.unsend()` |
| `update_profile_image` | `client.uploadMyProfileImage(blob)` |
| `invite_to_group` / `kick_from_group` | `Chat.invite(mids)` / `Chat.kick(mid)` |
| `list_openchats` | `client.fetchJoinedSquares()` |

---

## 8. การเปิด-ปิดระบบ

- **MCP Server:** Claude Desktop จะ spawn process `node mcp-server.js` เองเมื่อเปิดโปรแกรม และ kill เมื่อปิดโปรแกรม ไม่ต้องสั่งรันเอง
- **ล็อกอินใหม่:** รัน `node run.js` ใน PowerShell เมื่อ Token หมดอายุ (สังเกตจาก Error 403 ใน Claude)
- **ถอนการติดตั้ง:** ลบ block `LINE-SelfBot` ออกจาก `claude_desktop_config.json` และลบไฟล์ `storage.json` เพื่อยกเลิก session

---

## 9. ปัญหาที่พบบ่อยและวิธีแก้

| อาการ | สาเหตุ | วิธีแก้ |
|---|---|---|
| `EPERM: operation not permitted, open 'C:\Windows\System32\storage.json'` | Claude รัน process ที่ `System32` | ใช้ `path.join(__dirname, ...)` แทน path สัมพัทธ์ |
| `Request internal failed: status=403` | ไม่มี AuthToken หรือ Token หมดอายุ | รัน `node run.js` ล็อกอินใหม่ |
| `node run.js` ค้างหลัง `[login] ForSecure: ...` | ไม่ได้ผูก event `qrcall` จึงไม่แสดง QR | ใช้ `loginWithQR` จาก `@evex/linejs` โดยตรง |
| URL `https://line.me/R/au/lgn/sq/...` ไม่มี QR Code | URL คือข้อมูลใน QR ไม่ใช่รูป | ใช้ `qrcode-terminal` วาด QR บนหน้าจอ |
| Claude ค้างนานเมื่อเรียก Tool | MCP Server พยายามสร้าง QR และรอสแกน | ใน MCP ให้ใช้ `loginWithAuthToken` เท่านั้น และ throw Error ทันทีหากไม่มี Token |
| `chat.getMessages is not a function` | ชื่อเมธอดผิด | ใช้ `chat.fetchMessages(limit)` หรือ `talk.getRecentMessagesV2` |
| `ERR_PACKAGE_PATH_NOT_EXPORTED` | import path ย่อยของ linejs | import `TalkMessage` จาก `@evex/linejs` |
| `list_chats` แสดงเฉพาะกลุ่ม | `fetchJoinedChats` คืนเฉพาะ MID `c...` | ใช้ `getMessageBoxes` |
| `list_friends` ชื่อว่างทั้งหมด | ใช้ `User.name` ซึ่งไม่มีอยู่ | ใช้ `talk.getContacts` อ่าน `displayName` |
| สมาชิกกลุ่มบางคนแสดง "ไม่มีชื่อ" | ไม่ได้เป็นเพื่อนกัน `getContacts` คืนชื่อว่าง | ปกติ ใช้ MID อ้างอิงแทน |
| `send_image` ล้มเหลวเมื่อส่ง PDF | `send_image` รับเฉพาะ MIME `image/*` | ใช้ `send_file` |
| `wait_for_message` คืน "ไม่มีข้อความใหม่" ทั้งที่มีคนตอบ | ข้อความเป็นของตัวเอง (`isMine`) หรือ chatMid ไม่ตรง | ตรวจ `chatMid` ที่ส่ง หรือเรียก `get_new_messages` โดยไม่ระบุ chatMid |
| "The connector returned an error" โดยไม่มีรายละเอียด | Error ถูก throw ออกจาก handler | ครอบ try-catch และคืน `isError: true` พร้อมข้อความ |

---

## 10. ความปลอดภัยและความเสี่ยง

1. **`storage.json` คือกุญแจเข้าบัญชี LINE** ประกอบด้วย AuthToken, RefreshToken, Certificate และ E2EE Private Key ห้ามแชร์ ห้าม commit ลง Git ห้ามวางในโฟลเดอร์ที่ซิงค์ขึ้นคลาวด์
2. **SelfBot ขัดต่อเงื่อนไขการใช้งานของ LINE** บัญชีอาจถูกระงับหากส่งข้อความถี่ผิดปกติหรือล็อกอินหลายครั้งติดกัน ควรใช้บัญชีสำรองทดสอบก่อน
3. **ความเสถียรขึ้นกับผู้พัฒนา linejs** เมื่อ LINE เปลี่ยนโปรโตคอล ไลบรารีอาจหยุดทำงานจนกว่าจะมีอัปเดต ตรวจสอบเวอร์ชันใหม่ด้วย `npx jsr add @evex/linejs` เป็นระยะ
4. **ควบคุมสิทธิ์การเปลี่ยนแปลง** Claude สามารถส่งข้อความ ส่งไฟล์ และเปลี่ยนชื่อโปรไฟล์ในนามบัญชีผู้ใช้ได้ทันที description ของ `update_my_profile` ระบุให้ยืนยันก่อน หากต้องการให้ยืนยันก่อนส่งข้อความด้วย ให้ปรับ description ของ `send_message` / `send_image` / `send_file` ว่า "ต้องขอยืนยันจากผู้ใช้ก่อนทุกครั้ง"
5. **ไฟล์ที่ดาวน์โหลด** จาก `download_message_file` ถูกบันทึกในเครื่องโดยไม่สแกนไวรัส ควรตรวจสอบก่อนเปิด

---

## 11. โครงสร้างไฟล์สุดท้าย

```
C:\Users\umsit\LINE SelfBot\
├── package.json          ("type": "module")
├── node_modules\
├── run.js                ล็อกอินครั้งแรก / ต่ออายุ Token
├── mcp-server.js         MCP Server v2.0.0 (14 tools)
├── storage.json          ข้อมูลลับ (สร้างอัตโนมัติหลังล็อกอิน)
├── downloads\            ไฟล์ที่ดาวน์โหลดจาก LINE (สร้างอัตโนมัติ)
└── manifest.json         (ไม่บังคับ) สำหรับแพ็กเป็น .mcpb
```

---

## 12. ประวัติเวอร์ชัน

| เวอร์ชัน | การเปลี่ยนแปลง |
|---|---|
| 1.0–1.2 | `list_chats`, `send_message`, `get_chat_messages` (เฉพาะกลุ่ม) |
| 1.3 | รองรับแชทส่วนตัว (`getMessageBoxes`, `getRecentMessagesV2`) |
| 1.4 | `get_message_image` – Claude มองเห็นรูปในแชท |
| 1.5 | `send_image` |
| 1.6 | `list_friends` |
| 1.7 | `list_group_members`, `fromName` ใน `get_chat_messages`, `resolveNames()` |
| 1.8 | `wait_for_message`, `get_new_messages` – real-time inbox |
| 1.9 | `send_file`, `download_message_file`, `loadMedia()`, `MIME_MAP` |
| 2.0 | `get_my_profile`, `update_my_profile`, `rename_friend` |

---

## อ้างอิง

- LINEJS: https://github.com/evex-dev/linejs
- LINEJS Docs: https://linejs.evex.land
- MCP SDK: https://github.com/modelcontextprotocol/typescript-sdk
- Claude Desktop Extensions (MCPB): https://github.com/anthropics/mcpb
