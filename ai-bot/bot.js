import { google } from 'googleapis';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAIFileManager } from '@google/generative-ai/server';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ============================================================================
// 1. 環境變數與全域設定 (將由 GitHub Secrets 提供)
// ============================================================================
const CONFIG = {
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  TELEGRAM_TOKEN: process.env.TELEGRAM_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_KEY: process.env.SUPABASE_KEY,
  GMAIL_CLIENT_ID: process.env.GMAIL_CLIENT_ID,
  GMAIL_CLIENT_SECRET: process.env.GMAIL_CLIENT_SECRET,
  GMAIL_REFRESH_TOKEN: process.env.GMAIL_REFRESH_TOKEN,
  LABEL_SUCCESS: "✅ 已匯入 ERP",
  LABEL_ERROR: "❌ ERP 處理失敗"
};

// 初始化各項服務客戶端
const supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);
const genAI = new GoogleGenerativeAI(CONFIG.GEMINI_API_KEY);
const fileManager = new GoogleAIFileManager(CONFIG.GEMINI_API_KEY);

const oauth2Client = new google.auth.OAuth2(CONFIG.GMAIL_CLIENT_ID, CONFIG.GMAIL_CLIENT_SECRET);
oauth2Client.setCredentials({ refresh_token: CONFIG.GMAIL_REFRESH_TOKEN });
const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

// ============================================================================
// 2. 主程式入口
// ============================================================================
async function main() {
  console.log("🤖 啟動長固 ERP AI 接單機器人 (Node.js 版)...");
  let successCount = 0;
  let failCount = 0;
  let successDetails = [];
  
  try {
    // 確保標籤存在並取得 ID
    const labels = await getOrCreateLabels();
    
    // 搜尋未讀且沒有錯誤標籤的信件
    const query = `is:unread -label:"${CONFIG.LABEL_ERROR}"`;
    const res = await gmail.users.messages.list({ userId: 'me', q: query });
    const messages = res.data.messages || [];
    
    if (messages.length === 0) {
      console.log("目前沒有需要處理的新信件。");
      return;
    }
    
    await sendTelegramMsg(`🤖 *長固 AI 接單機器人啟動*\n目前發現 *${messages.length} 封* 未讀新信件，開始極速解析...`);

    for (const msg of messages) {
      try {
        console.log(`處理信件 ID: ${msg.id}...`);
        const { subject, body, attachments, threadId } = await fetchEmailDetails(msg.id);
        const parsedOrders = await parseEmailWithGemini(subject, body, attachments);
        
        let hasImported = false;
        let hasError = false;

        for (const order of parsedOrders) {
          if (order.items && order.items.length > 0) {
            order.mailUrl = `https://mail.google.com/mail/u/0/#inbox/${threadId}`;
            const success = await insertOrderToSupabase(order);
            if (success) {
              hasImported = true;
              successDetails.push(`- ${order.clientName} (${order.items.length}項品名)`);
            } else {
              hasError = true;
            }
          }
        }

        if (hasImported && !hasError) {
          await modifyEmailLabels(msg.id, [labels.success], [labels.error, 'UNREAD']);
          successCount++;
        } else {
          await modifyEmailLabels(msg.id, [labels.error], [labels.success]);
          failCount++;
        }
      } catch (err) {
        console.error(`信件 ${msg.id} 處理失敗:`, err);
        await modifyEmailLabels(msg.id, [labels.error], [labels.success]);
        failCount++;
      }
    }

    // 發送最終報告
    let finalMsg = `✅ *AI 解析作業報告*\n本次成功寫入 Supabase：*${successCount} 封*。`;
    if (successDetails.length > 0) finalMsg += `\n\n📝 *匯入成功明細*：\n${successDetails.join('\n')}`;
    if (failCount > 0) finalMsg += `\n\n⚠️ 另有 ${failCount} 封信件異常。已貼上「${CONFIG.LABEL_ERROR}」標籤，請手動確認。`;
    await sendTelegramMsg(finalMsg);

  } catch (error) {
    console.error("系統發生嚴重錯誤:", error);
    await sendTelegramMsg(`❌ *機器人系統崩潰*\n錯誤訊息: ${error.message}`);
  }
}

// ============================================================================
// 3. 信件讀取與解析模組 (完整支援遞迴解析與附檔下載)
// ============================================================================
async function fetchEmailDetails(messageId) {
  const msg = await gmail.users.messages.get({ userId: 'me', id: messageId });
  const payload = msg.data.payload;
  const headers = payload.headers;
  
  let subject = headers.find(h => h.name.toLowerCase() === 'subject')?.value || "無主旨";
  let bodyText = "";
  let attachments = [];

  // 遞迴解析信件內容與附檔
  async function parseParts(parts) {
    for (const part of parts) {
      if (part.filename && part.body && part.body.attachmentId) {
        const mimeType = part.mimeType;
        if (mimeType === 'application/pdf' || mimeType.startsWith('image/')) {
          attachments.push({
            filename: part.filename,
            mimeType: mimeType,
            attachmentId: part.body.attachmentId,
            messageId: messageId
          });
        }
      } else if (part.mimeType === 'text/plain' && part.body.data) {
        bodyText += Buffer.from(part.body.data, 'base64').toString('utf-8');
      } else if (part.mimeType === 'text/html' && part.body.data && !bodyText) {
        let html = Buffer.from(part.body.data, 'base64').toString('utf-8');
        html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
        bodyText = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      } else if (part.parts) {
        await parseParts(part.parts);
      }
    }
  }

  if (payload.parts) {
    await parseParts(payload.parts);
  } else if (payload.body && payload.body.data) {
    bodyText = Buffer.from(payload.body.data, 'base64').toString('utf-8');
  }

  return { subject, body: bodyText, attachments, threadId: msg.data.threadId };
}

// ============================================================================
// 4. Gemini AI 處理模組 (包含 File API 大檔上傳)
// ============================================================================
async function parseEmailWithGemini(subject, body, attachments) {
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash", generationConfig: { temperature: 0.0 } });
  
  const aiPrompt = `你是一個專業的醫療器材 ERP 訂單資料擷取助理。請精準擷取客戶訂單資訊。
  【郵件主旨】：${subject}\n【郵件內文】：${body}
  要求：
  1. 限回傳純 JSON Array 格式，無 Markdown，無說明。
  2. 若無訂單資訊回傳 []。
  3. 訂單號碼(orderNo)與資材碼(code)須完整保留。
  4. 包含多個訂單號碼請拆分為多個獨立的 JSON 物件。
  格式：[{"clientName":"客戶名稱","orderNo":"單號","department":"申請單位","deadline":"出貨期限YYYY-MM-DD","items":[{"code":"資材碼","name":"品名規格","qty":數字}]}]`;

  let parts = [aiPrompt];
  const MAX_INLINE_SIZE = 3 * 1024 * 1024; // 3MB

  for (const att of attachments) {
    console.log(`下載附檔: ${att.filename}...`);
    const attData = await gmail.users.messages.attachments.get({ userId: 'me', messageId: att.messageId, id: att.attachmentId });
    const buffer = Buffer.from(attData.data.data, 'base64');
    const size = buffer.length;

    if (size <= MAX_INLINE_SIZE) {
      parts.push({ inlineData: { data: buffer.toString('base64'), mimeType: att.mimeType } });
    } else {
      console.log(`啟動大型檔案傳輸: ${att.filename} (${Math.round(size/1024/1024)}MB)`);
      const tempFilePath = path.join(os.tmpdir(), att.filename);
      fs.writeFileSync(tempFilePath, buffer);
      
      try {
        const uploadResponse = await fileManager.uploadFile(tempFilePath, { mimeType: att.mimeType, displayName: att.filename });
        parts.push({ fileData: { mimeType: uploadResponse.file.mimeType, fileUri: uploadResponse.file.uri } });
      } finally {
        if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath); // 確保清理暫存檔
      }
    }
  }

  const result = await model.generateContent(parts);
  let rawText = result.response.text();
  
  const match = rawText.match(/\[[\s\S]*\]/);
  if (match) rawText = match[0];
  else rawText = rawText.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();

  if (rawText === '[]' || rawText === '{}' || !rawText) return [];
  let parsed = JSON.parse(rawText);
  if (!Array.isArray(parsed)) parsed = [parsed];

  // 資料正規化
  let orders = [];
  parsed.forEach(obj => {
    if (typeof obj !== 'object' || !obj) return;
    let itemsKey = Object.keys(obj).find(k => k.toLowerCase() === 'items');
    let items = itemsKey ? obj[itemsKey] : [];
    if (!Array.isArray(items)) items = [];
    
    if (items.length > 0) {
      let clientKey = Object.keys(obj).find(k => k.toLowerCase().includes('client'));
      let orderNoKey = Object.keys(obj).find(k => k.toLowerCase().includes('order'));
      let deptKey = Object.keys(obj).find(k => k.toLowerCase().includes('dept') || k.toLowerCase().includes('department'));
      let deadlineKey = Object.keys(obj).find(k => k.toLowerCase().includes('deadline'));
      
      orders.push({
        clientName: obj[clientKey] || "未擷取客戶", orderNo: obj[orderNoKey] || "",
        department: obj[deptKey] || "", deadline: obj[deadlineKey] || "",
        items: items.map(i => {
          let codeKey = Object.keys(i).find(k => k.toLowerCase().includes('code'));
          let nameKey = Object.keys(i).find(k => k.toLowerCase().includes('name'));
          let qtyKey = Object.keys(i).find(k => k.toLowerCase().includes('qty'));
          return { code: i[codeKey] || "", name: i[nameKey] || "未知品名", qty: Number(i[qtyKey]) || 1 };
        })
      });
    }
  });
  return orders;
}

// ============================================================================
// 5. Supabase 寫入模組 (強制查核防漏單)
// ============================================================================
async function insertOrderToSupabase(orderData) {
  const payload = {
    row_idx: Date.now() + Math.floor(Math.random() * 1000),
    time: Date.now(), client: orderData.clientName || "未識別客戶",
    order_no: orderData.orderNo || "", dept: orderData.department || "",
    status: orderData.status || "待出貨", json_str: JSON.stringify(orderData.items || []),
    deadline: orderData.deadline || "", source: orderData.source || "🤖 信件自動匯入",
    mail_url: orderData.mailUrl || ""
  };

  const { data, error } = await supabase.from('orders').insert(payload).select();
  
  if (error || !data || data.length === 0) {
    console.error("Supabase 寫入失敗或無回傳:", error);
    return false;
  }
  return true;
}

// ============================================================================
// 6. 輔助函式 (標籤管理與 Telegram)
// ============================================================================
async function getOrCreateLabels() {
  const res = await gmail.users.labels.list({ userId: 'me' });
  const labels = res.data.labels || [];
  
  let successLabel = labels.find(l => l.name === CONFIG.LABEL_SUCCESS);
  let errorLabel = labels.find(l => l.name === CONFIG.LABEL_ERROR);

  if (!successLabel) {
    const createRes = await gmail.users.labels.create({ userId: 'me', requestBody: { name: CONFIG.LABEL_SUCCESS, labelListVisibility: 'labelShow', messageListVisibility: 'show' }});
    successLabel = createRes.data;
  }
  if (!errorLabel) {
    const createRes = await gmail.users.labels.create({ userId: 'me', requestBody: { name: CONFIG.LABEL_ERROR, labelListVisibility: 'labelShow', messageListVisibility: 'show' }});
    errorLabel = createRes.data;
  }
  return { success: successLabel.id, error: errorLabel.id };
}

async function modifyEmailLabels(messageId, addLabelIds, removeLabelIds) {
  await gmail.users.messages.modify({ userId: 'me', id: messageId, requestBody: { addLabelIds, removeLabelIds } });
}

async function sendTelegramMsg(text) {
  if (!CONFIG.TELEGRAM_TOKEN || !CONFIG.TELEGRAM_CHAT_ID) return;
  const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM_TOKEN}/sendMessage`;
  try {
    await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CONFIG.TELEGRAM_CHAT_ID, text: text, parse_mode: "Markdown" })
    });
  } catch (err) { console.error("TG 推播失敗:", err.message); }
}

// 執行主程式
main();
