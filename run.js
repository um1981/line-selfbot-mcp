import { loginWithQR, loginWithAuthToken } from "@evex/linejs";
import { FileStorage } from "@evex/linejs/storage";
import qrcode from "qrcode-terminal";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const storagePath = path.join(__dirname, "storage.json");
const storage = new FileStorage(storagePath);

console.log("=== LINE SelfBot Login Script ===");

const savedToken = await storage.get("savedAuthToken");
let client;

if (savedToken && typeof savedToken === "string") {
  console.log("พบ Token เดิม กำลังเข้าสู่ระบบด้วย Token...");
  try {
    client = await loginWithAuthToken(savedToken, {
      device: "DESKTOPWIN",
      storage: storage,
    });
    console.log("✓ เข้าสู่ระบบด้วย Token สำเร็จ!");
  } catch (err) {
    console.warn("! Token เดิมหมดอายุหรือไม่ถูกต้อง:", err.message);
  }
}

if (!client) {
  console.log("กำลังสร้าง QR Code สำหรับเข้าสู่ระบบ...");
  client = await loginWithQR({
    onReceiveQRUrl(url) {
      console.log("\n=======================================================");
      console.log(" สแกน QR Code ด้านล่างนี้ด้วยแอป LINE บนมือถือ:");
      console.log("=======================================================\n");
      qrcode.generate(url, { small: true });
    },
    onPincodeRequest(pin) {
      console.log("\n=======================================================");
      console.log(` >>> กรอกรหัส PIN นี้ในหน้าจอแอป LINE บนมือถือ: ${pin} <<<`);
      console.log("=======================================================\n");
    },
  }, {
    device: "DESKTOPWIN",
    storage: storage,
  });

  const token = client.base?.authToken || client.authToken;
  if (token) {
    await storage.set("savedAuthToken", token);
    console.log("✓ บันทึก AuthToken ลง storage.json สำเร็จ!");
  }
}

console.log("\nกำลังทดสอบเชื่อมต่อและดึงรายชื่อแชท...");
try {
  const chats = await client.fetchJoinedChats();
  console.log(`\n✓ สำเร็จ! พบห้องแชทกลุ่มทั้งหมด ${chats.length} รายการ:`);
  chats.slice(0, 5).forEach((c, idx) => {
    console.log(`  ${idx + 1}. ${c.name || "ไม่มีชื่อ"} (MID: ${c.mid})`);
  });
  console.log("\nระบบพร้อมใช้งานกับ Claude Desktop แล้ว!");
} catch (err) {
  console.log("เข้าสู่ระบบเรียบร้อย แต่ไม่สามารถดึงรายชื่อแชททดสอบได้:", err.message);
}
