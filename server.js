// 寶寶與我 — 後端代理伺服器
// 用途：把 Claude API Key 藏在伺服器端，前端 App 不需要碰到任何 Key
// 只使用 Node.js 內建模組，不需要安裝任何外部套件，部署最簡單穩定

const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY; // 這個 Key 只存在伺服器環境變數，前端永遠看不到

if (!API_KEY) {
  console.warn('⚠️ 警告：尚未設定 ANTHROPIC_API_KEY 環境變數，伺服器會啟動但呼叫 Claude 會失敗。');
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res, statusCode, obj) {
  setCorsHeaders(res);
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function callClaude(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
    };
    const req = https.request(options, (apiRes) => {
      let data = '';
      apiRes.on('data', (chunk) => (data += chunk));
      apiRes.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ statusCode: apiRes.statusCode, data: parsed });
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const server = http.createServer((req, res) => {
  // 處理瀏覽器的 CORS 預檢請求
  if (req.method === 'OPTIONS') {
    setCorsHeaders(res);
    res.writeHead(204);
    res.end();
    return;
  }

  // 健康檢查端點，方便確認伺服器是否正常運作
  if (req.method === 'GET' && req.url === '/') {
    sendJson(res, 200, { status: 'ok', message: '寶寶與我後端伺服器運作中' });
    return;
  }

  // 主要代理端點：前端把 system + messages 傳過來，這裡轉發給 Claude API
  if (req.method === 'POST' && req.url === '/api/chat') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      // 限制請求大小，避免異常超大請求（約 15MB，足夠超音波圖片用）
      if (body.length > 15 * 1024 * 1024) {
        req.destroy();
      }
    });
    req.on('end', async () => {
      try {
        const parsed = JSON.parse(body);
        const { system, messages, max_tokens } = parsed;

        if (!messages || !Array.isArray(messages)) {
          sendJson(res, 400, { error: '缺少 messages 參數' });
          return;
        }

        const result = await callClaude({
          model: 'claude-sonnet-4-6',
          max_tokens: max_tokens || 500,
          system: system || '',
          messages,
        });

        if (result.statusCode >= 200 && result.statusCode < 300) {
          sendJson(res, 200, result.data);
        } else {
          console.error('Claude API 錯誤:', result.data);
          sendJson(res, result.statusCode, { error: result.data.error?.message || '呼叫 Claude API 失敗' });
        }
      } catch (err) {
        console.error('伺服器錯誤:', err);
        sendJson(res, 500, { error: '伺服器內部錯誤，請稍後再試' });
      }
    });
    return;
  }

  sendJson(res, 404, { error: '找不到此路徑' });
});

server.listen(PORT, () => {
  console.log(`伺服器已啟動，監聽 port ${PORT}`);
});
