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

    // Route phụ: /api/models dùng để kiểm tra xem tài khoản đang có model nào
    if (url.pathname === "/api/models" && request.method === "GET") {
      if (!apiKey) {
        return new Response(JSON.stringify({ error: "Chưa cấu hình GEMINI_API_KEY" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      const listRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
      const listData = await listRes.json();
      return new Response(JSON.stringify(listData), {
        status: listRes.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Route chính: xử lý câu hỏi và hình ảnh
    if (url.pathname === "/api/process" && request.method === "POST") {
      try {
        if (!apiKey) {
          return new Response(
            JSON.stringify({ error: "Chưa cấu hình GEMINI_API_KEY trên Cloudflare Bindings" }),
            {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            }
          );
        }

        const { text, imageBase64, mimeType } = await request.json();
        if (!text && !imageBase64) {
          return new Response(
            JSON.stringify({ error: "Không tìm thấy nội dung văn bản hoặc hình ảnh" }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            }
          );
        }

        const parts = [{
          text: `Bạn là trợ lý học thuật chuẩn hóa và giải đề thi trắc nghiệm.
Nhiệm vụ:
1. Đọc kỹ nội dung câu hỏi từ hình ảnh hoặc văn bản được cung cấp.
2. Trích xuất đúng 4 lựa chọn [A, B, C, D] cho mỗi câu.
3. Nếu đề chưa có đáp án, hãy suy luận chính xác đáp án đúng nhất (0: A, 1: B, 2: C, 3: D).
4. Viết giải thích ngắn gọn, chuẩn xác cho đáp án đúng.
5. Luôn trả về mảng JSON theo đúng schema được chỉ định.`
        }];

        if (text) {
          parts.push({ text: `Dữ liệu văn bản kèm theo:\n${text}` });
        }

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
                  q: { type: "STRING", description: "Nội dung câu hỏi" },
                  options: {
                    type: "ARRAY",
                    items: { type: "STRING" },
                    description: "Đúng 4 đáp án lựa chọn [A, B, C, D]"
                  },
                  answer: {
                    type: "INTEGER",
                    description: "Index đáp án đúng: 0 cho A, 1 cho B, 2 cho C, 3 cho D"
                  },
                  explain: { type: "STRING", description: "Lời giải thích ngắn gọn" }
                },
                required: ["q", "options", "answer", "explain"]
              }
            }
          }
        };

        // Danh sách model tương thích
        const CANDIDATE_MODELS = [
          "gemini-2.0-flash",
          "gemini-2.0-flash-exp",
          "gemini-1.5-flash-latest"
        ];

        let geminiResponse;
        let data;

        for (const model of CANDIDATE_MODELS) {
          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

          geminiResponse = await fetch(geminiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });

          data = await geminiResponse.json();

          if (geminiResponse.ok) {
            break;
          }

          const errMsg = data.error?.message || "";
          // Nếu model không tồn tại hoặc nghẽn, thử sang model tiếp theo trong danh sách
          const canRetryNextModel =
            geminiResponse.status === 404 ||
            geminiResponse.status === 503 ||
            errMsg.includes("not found") ||
            errMsg.includes("high demand") ||
            errMsg.includes("no longer available");

          if (!canRetryNextModel) {
            break;
          }
        }

        if (!geminiResponse || !geminiResponse.ok) {
          return new Response(
            JSON.stringify({ error: data?.error?.message || "Không thể kết nối đến Gemini API" }),
            {
              status: geminiResponse ? geminiResponse.status : 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            }
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
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          }
        );
      }
    }

    return env.ASSETS ? env.ASSETS.fetch(request) : new Response("Not Found", { status: 404 });
  }
};
