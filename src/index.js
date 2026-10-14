export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const apiKey = env.GEMINI_API_KEY;

    if (url.pathname === "/api/process" && request.method === "POST") {
      try {
        if (!apiKey) {
          return new Response(
            JSON.stringify({ error: "Chưa cấu hình GEMINI_API_KEY trên Cloudflare Bindings" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const { text, imageBase64, mimeType } = await request.json();
        if (!text && !imageBase64) {
          return new Response(
            JSON.stringify({ error: "Không tìm thấy nội dung văn bản hoặc hình ảnh" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // BƯỚC 1: Tự động lấy danh sách model thực tế mà API key này được phép dùng
        const listRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        const listData = await listRes.json();

        if (!listRes.ok) {
          return new Response(
            JSON.stringify({ error: "Lỗi kiểm tra Key từ Google: " + (listData.error?.message || "Key không hợp lệ") }),
            { status: listRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Lọc ra các model có hỗ trợ generateContent
        const validModels = (listData.models || [])
          .filter(m => m.supportedGenerationMethods?.includes("generateContent"))
          .map(m => m.name); // dạng 'models/gemini-xxx'

        if (validModels.length === 0) {
          return new Response(
            JSON.stringify({ error: "API Key này hiện không có model nào hỗ trợ generateContent." }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Ưu tiên chọn model flash nếu có, nếu không thì lấy model đầu tiên khả dụng
        const targetModel = validModels.find(m => m.includes("flash")) || validModels[0];

        // BƯỚC 2: Chuẩn bị nội dung gửi đi
        const parts = [{
          text: `Bạn là trợ lý học thuật chuẩn hóa và giải đề thi trắc nghiệm.
Nhiệm vụ:
1. Đọc kỹ nội dung câu hỏi từ hình ảnh hoặc văn bản được cung cấp.
2. Trích xuất đúng 4 lựa chọn [A, B, C, D] cho mỗi câu.
3. Nếu đề chưa có đáp án, hãy suy luận chính xác đáp án đúng nhất (0: A, 1: B, 2: C, 3: D).
4. Viết giải thích ngắn gọn, chuẩn xác cho đáp án đúng.
5. Luôn trả về mảng JSON theo đúng schema được chỉ định.`
        }];

        if (text) parts.push({ text: `Dữ liệu văn bản kèm theo:\n${text}` });
        if (imageBase64) {
          parts.push({
            inline_data: {
              mime_type: mimeType || "image/jpeg",
              data: imageBase64
            }
          });
        }

        const payload = {
          contents: [{ parts }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  q: { type: "STRING" },
                  options: { type: "ARRAY", items: { type: "STRING" } },
                  answer: { type: "INTEGER" },
                  explain: { type: "STRING" }
                },
                required: ["q", "options", "answer", "explain"]
              }
            }
          }
        };

        // BƯỚC 3: Gửi request tới model vừa tìm được tự động
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/${targetModel}:generateContent?key=${apiKey}`;
        const geminiResponse = await fetch(geminiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        const data = await geminiResponse.json();

        if (!geminiResponse.ok) {
          return new Response(
            JSON.stringify({ error: `Lỗi từ ${targetModel}: ` + (data.error?.message || "Không xử lý được") }),
            { status: geminiResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const rawJson = data.candidates?.[0]?.content?.parts?.[0]?.text;
        return new Response(rawJson, {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });

      } catch (err) {
        return new Response(
          JSON.stringify({ error: err.message || "Lỗi xử lý nội bộ tại server" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    return env.ASSETS ? env.ASSETS.fetch(request) : new Response("Not Found", { status: 404 });
  }
};
