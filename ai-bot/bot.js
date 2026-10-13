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

// 初始化各項服務客戶端 (加上防呆，避免環境變數未讀取時直接 Crash)
const supabase = createClient(CONFIG.SUPABASE_URL || "https://placeholder.supabase.co", CONFIG.SUPABASE_KEY || "placeholder");
const genAI = new GoogleGenerativeAI(CONFIG.GEMINI_API_KEY || "placeholder");
const fileManager = new GoogleAIFileManager(CONFIG.GEMINI_API_KEY || "placeholder");

const oauth2Client = new google.auth.OAuth2(CONFIG.GMAIL_CLIENT_ID, CONFIG.GMAIL_CLIENT_SECRET);
oauth2Client.setCredentials({ refresh_token: CONFIG.GMAIL_REFRESH_TOKEN });
const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

// ============================================================================
// 2. 主程式入口
// ============================================================================
async function main() {
  console.log("🤖 啟動長固 ERP AI 接單機器人 (Node.js 版 - 強化追蹤日誌版)...");
  
  // [除錯日誌] 檢查環境變數
  console.log("=== 環境變數載入狀態檢查 ===");
  console.log("GEMINI_API_KEY:", CONFIG.GEMINI_API_KEY ? "✅ 已設定" : "❌ 未設定");
  console.log("TELEGRAM_TOKEN:", CONFIG.TELEGRAM_TOKEN ? "✅ 已設定" : "❌ 未設定");
  console.log("TELEGRAM_CHAT_ID:", CONFIG.TELEGRAM_CHAT_ID ? "✅ 已設定" : "❌ 未設定");
  console.log("SUPABASE_URL:", CONFIG.SUPABASE_URL ? "✅ 已設定" : "❌ 未設定");
  console.log("SUPABASE_KEY:", CONFIG.SUPABASE_KEY ? "✅ 已設定" : "❌ 未設定");
  console.log("GMAIL_CLIENT_ID:", CONFIG.GMAIL_CLIENT_ID ? "✅ 已設定" : "❌ 未設定");
  console.log("GMAIL_CLIENT_SECRET:", CONFIG.GMAIL_CLIENT_SECRET ? "✅ 已設定" : "❌ 未設定");
  console.log("GMAIL_REFRESH_TOKEN:", CONFIG.GMAIL_REFRESH_TOKEN ? "✅ 已設定" : "❌ 未設定");
  console.log("============================");

  let successCount = 0;
  let failCount = 0;
  let successDetails = [];
  
  try {
    console.log("開始驗證 Gmail 授權與標籤...");
    const labels = await getOrCreateLabels();
    console.log("Gmail 標籤獲取成功:", JSON.stringify(labels));
    
    const query = `is:unread -label:"${CONFIG.LABEL_ERROR}"`;
    console.log(`執行 Gmail 搜尋條件: [${query}]`);
    
    const res = await gmail.users.messages.list({ userId: 'me', q: query });
    const messages = res.data.messages || [];
    
    console.log(`Gmail 搜尋結果: 找到 ${messages.length} 封符合條件的信件。`);
    
    if (messages.length === 0) {
      console.log("目前沒有需要處理的新信件，程式結束。");
      return;
    }
    
    console.log("準備發送 Telegram 啟動通知...");
    await sendTelegramMsg(`🤖 *長固 AI 接單機器人啟動*\n目前發現 *${messages.length} 封* 未讀新信件，開始極速解析...`);

    for (const msg of messages) {
      try {
        console.log(`\n--- 開始處理信件 ID: ${msg.id} ---`);
        const { subject, body, attachments, threadId } = await fetchEmailDetails(msg.id);
        console.log(`信件主旨: ${subject}, 附檔數量: ${attachments.length}, 內文長度: ${body.length}`);
        
        console.log(`準備呼叫 Gemini AI 進行解析...`);
        const parsedOrders = await parseEmailWithGemini(subject, body, attachments);
        console.log(`Gemini 解析完成，共識別出 ${parsedOrders.length} 筆訂單。`);
        
        let hasImported = false;
        let hasError = false;

        for (const order of parsedOrders) {
          if (order.items && order.items.length > 0) {
            console.log(`準備寫入 Supabase (客戶: ${order.clientName}, 品項數: ${order.items.length})...`);
            order.mailUrl = `https://mail.google.com/mail/u/0/#inbox/${threadId}`;
            const success = await insertOrderToSupabase(order);
            if (success) {
              console.log(`✅ Supabase 寫入成功！`);
              hasImported = true;
              successDetails.push(`- ${order.clientName} (${order.items.length}項品名)`);
            } else {
              console.error(`❌ Supabase 寫入失敗！`);
              hasError = true;
            }
          } else {
            console.log(`⚠️ 此訂單沒有品項 (items 為空)，略過寫入。`);
          }
        }

        if (hasImported && !hasError) {
          console.log(`準備更新信件標籤: 標示成功並設為已讀...`);
          await modifyEmailLabels(msg.id, [labels.success], [labels.error, 'UNREAD']);
          successCount++;
        } else {
          console.log(`準備更新信件標籤: 標示處理失敗...`);
          await modifyEmailLabels(msg.id, [labels.error], [labels.success]);
          failCount++;
        }
        console.log(`--- 信件 ID: ${msg.id} 處理結束 ---`);
      } catch (err) {
        console.error(`❌ 信件 ${msg.id} 處理失敗，詳細錯誤:`, err.stack || err);
        await modifyEmailLabels(msg.id, [labels.error], [labels.success]);
        failCount++;
      }
    }

    console.log(`\n=== 所有信件處理完畢 ===`);
    console.log(`成功: ${successCount}, 失敗: ${failCount}`);
    
    let finalMsg = `✅ *AI 解析作業報告*\n本次成功寫入 Supabase：*${successCount} 封*。`;
    if (successDetails.length > 0) finalMsg += `\n\n📝 *匯入成功明細*：\n${successDetails.join('\n')}`;
    if (failCount > 0) finalMsg += `\n\n⚠️ 另有 ${failCount} 封信件異常。已貼上「${CONFIG.LABEL_ERROR}」標籤，請手動確認。`;
    
    console.log("準備發送 Telegram 總結報告...");
    await sendTelegramMsg(finalMsg);
    console.log("機器人執行完畢。");

  } catch (error) {
    console.error("\n❌ 系統發生嚴重錯誤，導致中斷:", error.stack || error);
    await sendTelegramMsg(`❌ *機器人系統崩潰*\n錯誤訊息: ${error.message}`);
  }
}

// ============================================================================
// 3. 信件讀取與解析模組
// ============================================================================
async function fetchEmailDetails(messageId) {
  console.log(`[fetchEmailDetails] 正在下載信件內容...`);
  const msg = await gmail.users.messages.get({ userId: 'me', id: messageId });
  const payload = msg.data.payload;
  const headers = payload.headers;
  
  let subject = headers.find(h => h.name.toLowerCase() === 'subject')?.value || "無主旨";
  let bodyText = "";
  let attachments = [];

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
// 4. Gemini AI 處理模組
// ============================================================================
async function parseEmailWithGemini(subject, body, attachments) {
  console.log(`[parseEmailWithGemini] 初始化 Gemini 模組...`);
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
    console.log(`[Gemini] 處理附檔: ${att.filename}...`);
    const attData = await gmail.users.messages.attachments.get({ userId: 'me', messageId: att.messageId, id: att.attachmentId });
    const buffer = Buffer.from(attData.data.data, 'base64');
    const size = buffer.length;

    if (size <= MAX_INLINE_SIZE) {
      parts.push({ inlineData: { data: buffer.toString('base64'), mimeType: att.mimeType } });
    } else {
      console.log(`[Gemini] 啟動大型檔案上傳: ${att.filename} (${Math.round(size/1024/1024)}MB)`);
      const tempFilePath = path.join(os.tmpdir(), att.filename);
      fs.writeFileSync(tempFilePath, buffer);
      
      try {
        const uploadResponse = await fileManager.uploadFile(tempFilePath, { mimeType: att.mimeType, displayName: att.filename });
        parts.push({ fileData: { mimeType: uploadResponse.file.mimeType, fileUri: uploadResponse.file.uri } });
      } catch(err) {
        console.error(`[Gemini] 檔案上傳失敗: ${att.filename}`, err.stack || err);
        throw err;
      } finally {
        if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
      }
    }
  }

  console.log(`[Gemini] 開始向 Google 伺服器發送請求...`);
  const result = await model.generateContent(parts);
  let rawText = result.response.text();
  console.log(`[Gemini] 原始回傳字串:`, rawText);
  
  const match = rawText.match(/\[[\s\S]*\]/);
  if (match) rawText = match[0];
  else rawText = rawText.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();

  if (rawText === '[]' || rawText === '{}' || !rawText) {
      console.log(`[Gemini] 未發現訂單或回傳為空。`);
      return [];
  }
  
  let parsed;
  try {
      parsed = JSON.parse(rawText);
  } catch (err) {
      console.error(`[Gemini] JSON 解析失敗，原始字串:`, rawText);
      throw new Error("AI 回傳的格式無法解析為 JSON");
  }

  if (!Array.isArray(parsed)) parsed = [parsed];

  // 資料正規化
  let orders = [];
  parsed.forEach((obj, idx) => {
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
    } else {
        console.log(`[Gemini] 第 ${idx+1} 筆訂單陣列無品項，跳過。`);
    }
  });
  return orders;
}

// ============================================================================
// 5. Supabase 寫入模組
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

  console.log(`[Supabase] 寫入 Payload:`, JSON.stringify(payload));
  try {
    const { data, error } = await supabase.from('orders').insert(payload).select();
    if (error) {
      console.error("[Supabase] 寫入發生 Error:", error);
      return false;
    }
    if (!data || data.length === 0) {
      console.error("[Supabase] 寫入成功但無回傳 Data");
      return false;
    }
    return true;
  } catch (err) {
    console.error("[Supabase] 執行 insert 拋出例外:", err.stack || err);
    return false;
  }
}

// ============================================================================
// 6. 輔助函式 (標籤管理與 Telegram)
// ============================================================================
async function getOrCreateLabels() {
  try {
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
  } catch (err) {
    console.error("[getOrCreateLabels] 標籤操作失敗:", err.stack || err);
    throw err;
  }
}

async function modifyEmailLabels(messageId, addLabelIds, removeLabelIds) {
  try {
    await gmail.users.messages.modify({ userId: 'me', id: messageId, requestBody: { addLabelIds, removeLabelIds } });
    console.log(`[modifyEmailLabels] 信件 ${messageId} 標籤更新成功`);
  } catch (err) {
    console.error(`[modifyEmailLabels] 信件 ${messageId} 標籤更新失敗:`, err.stack || err);
  }
}

async function sendTelegramMsg(text) {
  if (!CONFIG.TELEGRAM_TOKEN || !CONFIG.TELEGRAM_CHAT_ID) {
      console.log(`[Telegram] 未設定 Token 或 Chat ID，略過發送訊息。訊息內容: ${text.substring(0, 30)}...`);
      return;
  }
  const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM_TOKEN}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CONFIG.TELEGRAM_CHAT_ID, text: text, parse_mode: "Markdown" })
    });
    const resData = await res.json();
    if (!res.ok) {
        console.error(`[Telegram] 推播失敗，伺服器回傳:`, JSON.stringify(resData));
    } else {
        console.log(`[Telegram] 推播成功`);
    }
  } catch (err) { 
      console.error("[Telegram] 發送請求時發生例外:", err.stack || err); 
  }
}

// 執行主程式
main();
