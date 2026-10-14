export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (url.pathname === "/api/process" && request.method === "POST") {
      try {
        const apiKey = env.GEMINI_API_KEY;
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

        const parts = [{
          text: `Bạn là trợ lý học thuật chuẩn hóa và giải đề thi trắc nghiệm.
Nhiệm vụ:
1. Đọc kỹ câu hỏi từ hình ảnh hoặc văn bản được cung cấp.
2. Trích xuất đúng 4 lựa chọn [A, B, C, D] cho mỗi câu.
3. Nếu đề chưa có đáp án, hãy suy luận chính xác đáp án đúng nhất (0: A, 1: B, 2: C, 3: D).
4. Viết giải thích ngắn gọn, súc tích cho đáp án đúng.
5. Luôn trả về mảng JSON theo đúng định dạng được chỉ định.`
        }];

        if (text) {
          parts.push({ text: `Nội dung văn bản:\n${text}` });
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
                  q: { type: "STRING", description: "Câu hỏi" },
                  options: {
                    type: "ARRAY",
                    items: { type: "STRING" },
                    description: "Đúng 4 lựa chọn [A, B, C, D]"
                  },
                  answer: {
                    type: "INTEGER",
                    description: "0 cho A, 1 cho B, 2 cho C, 3 cho D"
                  },
                  explain: { type: "STRING", description: "Giải thích đáp án" }
                },
                required: ["q", "options", "answer", "explain"]
              }
            }
          }
        };

        // Cố định thẳng model gemini-3.8-flash
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}`;

        let geminiResponse;
        let data;
        let retries = 3; // Thử lại tối đa 3 lần nếu Google bị nghẽn (High Demand)

        while (retries > 0) {
          geminiResponse = await fetch(geminiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });

          data = await geminiResponse.json();

          if (geminiResponse.ok) {
            break; // Thành công, thoát vòng lặp
          }

          const errMsg = data.error?.message || "";
          // Nếu bị quá tải (503 hoặc high demand), đợi 1.5 giây rồi thử lại
          if (geminiResponse.status === 503 || errMsg.includes("high demand")) {
            retries--;
            if (retries > 0) {
              await new Promise(res => setTimeout(res, 1500));
              continue;
            }
          }

          // Gặp lỗi khác thì dừng ngay
          break;
        }

        if (!geminiResponse || !geminiResponse.ok) {
          return new Response(
            JSON.stringify({ error: data?.error?.message || "Lỗi kết nối Gemini API" }),
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
          JSON.stringify({ error: err.message || "Lỗi xử lý nội bộ server" }),
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
