# LINE SelfBot MCP Plugin สำหรับ Claude Desktop

คู่มือรวบรวมแนวทางการสร้าง MCP Server ที่ควบคุมบัญชี LINE ส่วนตัวผ่านไลบรารี `@evex/linejs` (LINE SelfBot) และติดตั้งเป็น Plugin ให้ Claude Desktop ใช้งานอ่าน/ส่งข้อความ LINE ได้โดยตรง โดยไม่ต้องควบคุม UI ของโปรแกรม LINE Desktop

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
    │  HTTPS
    ▼
LINE Server (legy.line-apps.com)
```

| องค์ประกอบ | หน้าที่ |
|---|---|
| `@evex/linejs` | ไลบรารี LINE SelfBot เชื่อมต่อเซิร์ฟเวอร์ LINE โดยตรง รองรับ Node.js / Deno / Bun |
| `run.js` | สคริปต์ล็อกอินครั้งแรกผ่าน QR Code และบันทึก Token ลง `storage.json` |
| `mcp-server.js` | MCP Server เปิด Tools ให้ Claude เรียกใช้ |
| `storage.json` | เก็บ AuthToken, Certificate และ E2EE Key (ข้อมูลลับ ห้ามแชร์) |
| `claude_desktop_config.json` | ไฟล์ตั้งค่า MCP ของ Claude Desktop |

### เปรียบเทียบกับแนวทางอื่น

| แนวทาง | ข้อดี | ข้อเสีย |
|---|---|---|
| **LINE SelfBot (linejs)** – แนวทางนี้ | ไม่ต้องเปิด LINE Desktop, รัน Headless ได้, เร็ว, อ่านรูปภาพได้ | เสี่ยงผิดเงื่อนไขการใช้งาน LINE, อาจโดนระงับบัญชี |
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

## 5. ไฟล์ `mcp-server.js` – MCP Server

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
            limit: { type: "number", description: "จำนวนห้องแชทที่ต้องการดึง (ค่าเริ่มต้น 30)", default: 30 },
          },
        },
      },
      {
        name: "get_chat_messages",
        description: "อ่านประวัติข้อความล่าสุดในแชท หากข้อความเป็นรูปภาพจะแสดง [IMAGE] พร้อม messageId",
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

      const userMids = boxes.filter(b => b.id.startsWith("u")).map(b => b.id);
      const groupMids = boxes.filter(b => b.id.startsWith("c")).map(b => b.id);

      const userNames = {};
      if (userMids.length > 0) {
        try {
          const users = await c.base.talk.getContacts({ mids: userMids });
          users.forEach(u => { userNames[u.mid] = u.displayName; });
        } catch (_) {}
      }

      const groupNames = {};
      if (groupMids.length > 0) {
        try {
          const groupsRes = await c.base.talk.getChats({ chatMids: groupMids });
          (groupsRes.chats || []).forEach(g => { groupNames[g.chatMid] = g.chatName; });
        } catch (_) {}
      }

      const result = boxes.map(b => {
        const isUser = b.id.startsWith("u");
        const name = isUser ? (userNames[b.id] || "แชทส่วนตัว") : (groupNames[b.id] || "กลุ่ม");
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

    if (name === "get_chat_messages") {
      const limit = args.limit || 20;
      const rawMessages = await c.base.talk.getRecentMessagesV2({
        messageBoxId: args.chatMid,
        messagesCount: limit,
      });

      const messages = await Promise.all(
        rawMessages.map(m => TalkMessage.fromRawTalk(m, c))
      );

      const result = messages.map((m) => {
        const time = m.raw?.createdTime ? new Date(Number(m.raw.createdTime)).toLocaleString("th-TH") : null;
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
      let buffer, mime, filename;

      if (args.filePath) {
        if (!fs.existsSync(args.filePath)) {
          throw new Error(`ไม่พบไฟล์: ${args.filePath}`);
        }
        buffer = fs.readFileSync(args.filePath);
        filename = path.basename(args.filePath);
        const ext = path.extname(filename).toLowerCase();
        mime = ext === ".png" ? "image/png"
             : ext === ".gif" ? "image/gif"
             : ext === ".webp" ? "image/webp"
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
        content: [{ type: "text", text: `ส่งรูป ${filename} (${Math.round(buffer.length / 1024)} KB) ไปยัง ${args.chatMid} สำเร็จ` }],
      };
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
| ส่งรูปเป็น `{ type: "image", data, mimeType }` | รูปแบบมาตรฐาน MCP ทำให้ Claude มองเห็นและวิเคราะห์ภาพได้ |
| ส่งรูปออกด้วย `obs.uploadMediaByE2EE` | อัปโหลดแบบเข้ารหัส E2EE และส่งเข้าแชทในคำสั่งเดียว รองรับเฉพาะ MID `u...` และ `c...` |
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
  "version": "1.5.0",
  "description": "อ่านและส่งข้อความ LINE จากบัญชีส่วนตัวผ่าน Claude",
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
    { "name": "list_chats", "description": "ดึงรายชื่อแชทล่าสุด" },
    { "name": "get_chat_messages", "description": "อ่านประวัติข้อความ" },
    { "name": "get_message_image", "description": "ดึงรูปภาพจากข้อความ" },
    { "name": "send_message", "description": "ส่งข้อความ" },
    { "name": "send_image", "description": "ส่งรูปภาพจากไฟล์หรือ URL" }
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

> **หมายเหตุ:** ไฟล์ `.mcpb` จะรวม `node_modules` เข้าไปด้วย ควรสร้าง `.mcpbignore` เพื่อยกเว้น `storage.json`, `run.js`, `test-*.js` ไม่ให้ติดไปในแพ็กเกจ และผู้ติดตั้งต้องรัน `run.js` เพื่อล็อกอินในโฟลเดอร์ที่ Extension ถูกติดตั้งเองอีกครั้ง

---

## 7. Tools ที่เปิดให้ Claude ใช้

| Tool | Input | ผลลัพธ์ |
|---|---|---|
| `list_chats` | `limit` (ไม่บังคับ, ค่าเริ่มต้น 30) | รายชื่อแชทส่วนตัวและกลุ่ม พร้อม MID, ประเภท, จำนวนยังไม่อ่าน |
| `get_chat_messages` | `chatMid`, `limit` (ค่าเริ่มต้น 20) | ข้อความล่าสุด พร้อม ID, ผู้ส่ง, เวลา, ประเภทเนื้อหา |
| `get_message_image` | `chatMid`, `messageId` | รูปภาพ Base64 ที่ Claude มองเห็นได้ |
| `send_message` | `chatMid`, `message` | ยืนยันการส่ง |
| `send_image` | `chatMid`, `filePath` หรือ `imageUrl` | ยืนยันการส่ง พร้อมชื่อไฟล์และขนาด |

### ตัวอย่างคำสั่งใน Claude

- "ดูรายชื่อแชท LINE ล่าสุด"
- "อ่าน 10 ข้อความล่าสุดในห้อง BPC Dynamics Team"
- "ในห้อง ... ถ้ามีรูปภาพ ให้ดึงมาดูแล้วอธิบายว่าในรูปคืออะไร"
- "สรุปบทสนทนาวันนี้ในกลุ่ม ... แล้วส่งสรุปกลับเข้าห้องเดิม"
- "ส่งรูป `C:\Users\umsit\Pictures\report.png` ไปห้อง BPC Dynamics Team"

### ข้อจำกัดของ `send_image`

- รองรับเฉพาะแชทส่วนตัว (`u...`) และกลุ่ม (`c...`) ไม่รองรับ OpenChat (`m...`/`t...`)
- รูปที่ผู้ใช้แนบในหน้าต่าง Claude ไม่ถูกบันทึกเป็นไฟล์อัตโนมัติ ต้องมีไฟล์ในเครื่องหรือ URL ที่เข้าถึงได้
- ส่งไฟล์เอกสาร (PDF ฯลฯ) ทำได้ด้วยโค้ดชุดเดียวกันโดยเปลี่ยน `oType` เป็น `"file"`

### การเพิ่ม Tool ในอนาคต

| Tool | เมธอดใน linejs |
|---|---|
| `reply_message` | `TalkMessage.reply(text)` |
| `send_reaction` | `client.base.talk.react({ id: BigInt(messageId), reaction: "NICE" })` |
| `list_friends` | `client.fetchUsers()` |
| `get_my_profile` | `client.getMyProfile()` |
| `update_status_message` | `client.updateMyStatusMessage(text)` |
| `unsend_message` | `TalkMessage.unsend()` |
| `list_openchats` | `client.fetchJoinedSquares()` |
| `send_file` | `client.base.obs.uploadMediaByE2EE({ oType: "file", ... })` |

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
| "The connector returned an error" โดยไม่มีรายละเอียด | Error ถูก throw ออกจาก handler | ครอบ try-catch และคืน `isError: true` พร้อมข้อความ |

---

## 10. ความปลอดภัยและความเสี่ยง

1. **`storage.json` คือกุญแจเข้าบัญชี LINE** ประกอบด้วย AuthToken, RefreshToken, Certificate และ E2EE Private Key ห้ามแชร์ ห้าม commit ลง Git ห้ามวางในโฟลเดอร์ที่ซิงค์ขึ้นคลาวด์
2. **SelfBot ขัดต่อเงื่อนไขการใช้งานของ LINE** บัญชีอาจถูกระงับหากส่งข้อความถี่ผิดปกติหรือล็อกอินหลายครั้งติดกัน ควรใช้บัญชีสำรองทดสอบก่อน
3. **ความเสถียรขึ้นกับผู้พัฒนา linejs** เมื่อ LINE เปลี่ยนโปรโตคอล ไลบรารีอาจหยุดทำงานจนกว่าจะมีอัปเดต ตรวจสอบเวอร์ชันใหม่ด้วย `npx jsr add @evex/linejs` เป็นระยะ
4. **ควบคุมสิทธิ์การส่งข้อความ** Claude สามารถส่งข้อความในนามบัญชีผู้ใช้ได้ทันที หากต้องการให้ยืนยันก่อนส่ง ควรปรับ description ของ `send_message` ให้ระบุว่า "ต้องขอยืนยันจากผู้ใช้ก่อนทุกครั้ง"

---

## 11. โครงสร้างไฟล์สุดท้าย

```
C:\Users\umsit\LINE SelfBot\
├── package.json          ("type": "module")
├── node_modules\
├── run.js                ล็อกอินครั้งแรก / ต่ออายุ Token
├── mcp-server.js         MCP Server สำหรับ Claude
├── storage.json          ข้อมูลลับ (สร้างอัตโนมัติหลังล็อกอิน)
└── manifest.json         (ไม่บังคับ) สำหรับแพ็กเป็น .mcpb
```

---

## อ้างอิง

- LINEJS: https://github.com/evex-dev/linejs
- LINEJS Docs: https://linejs.evex.land
- MCP SDK: https://github.com/modelcontextprotocol/typescript-sdk
- Claude Desktop Extensions (MCPB): https://github.com/anthropics/mcpb
