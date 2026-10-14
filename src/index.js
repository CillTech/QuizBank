export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Cấu hình đầy đủ CORS Headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // Xử lý Preflight Request từ trình duyệt
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Xử lý API chuẩn hóa và giải đề tại /api/process
    if (url.pathname === "/api/process" && request.method === "POST") {
      try {
        const apiKey = env.GEMINI_API_KEY;
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

        // Danh sách model ưu tiên (tự động chuyển sang model tiếp theo nếu gặp lỗi quá tải)
        const MODELS = ["gemini-1.5-flash", "gemini-2.0-flash", "gemini-3.8-flash"];
        let geminiResponse;
        let data;

        for (const model of MODELS) {
          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

          geminiResponse = await fetch(geminiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });

          data = await geminiResponse.json();

          // Nếu gọi thành công, thoát vòng lặp ngay
          if (geminiResponse.ok) {
            break;
          }

          const errMsg = data.error?.message || "";
          // Nếu lỗi không phải do nghẽn tải hoặc hết hạn model, dừng lại để báo lỗi thực tế
          const isHighDemandOrUnavailable =
            geminiResponse.status === 503 ||
            errMsg.includes("high demand") ||
            errMsg.includes("no longer available");

          if (!isHighDemandOrUnavailable) {
            break;
          }
        }

        if (!geminiResponse.ok) {
          return new Response(
            JSON.stringify({ error: data.error?.message || "Lỗi phản hồi từ Gemini API" }),
            {
              status: geminiResponse.status,
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

    // Trả về file giao diện tĩnh (HTML/CSS/JS) trong thư mục public
    return env.ASSETS ? env.ASSETS.fetch(request) : new Response("Not Found", { status: 404 });
  }
};
