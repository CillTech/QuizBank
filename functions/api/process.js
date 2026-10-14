export async function onRequestPost(context) {
  const { request, env } = context;

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  try {
    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "Chưa cấu hình GEMINI_API_KEY trên Cloudflare Pages" }),
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

    // Cố định duy nhất gemini-3.1-flash-lite
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${apiKey}`;

    let res = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    let data = await res.json();

    // Tự động thử lại 1 lần nếu máy chủ phản hồi quá tải tạm thời
    if (!res.ok && (res.status === 503 || data.error?.message?.includes("high demand"))) {
      await new Promise(r => setTimeout(r, 1500));
      res = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      data = await res.json();
    }

    if (!res.ok) {
      return new Response(
        JSON.stringify({ error: data.error?.message || "Lỗi phản hồi từ Gemini API" }),
        { status: res.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const rawJson = data.candidates?.[0]?.content?.parts?.[0]?.text;
    return new Response(rawJson, {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message || "Lỗi xử lý server" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    }
  });
}
