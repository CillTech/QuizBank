export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "Chưa cấu hình GEMINI_API_KEY trên Cloudflare" }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    const { text, imageBase64, mimeType } = await request.json();
    if (!text && !imageBase64) {
      return new Response(JSON.stringify({ error: "Không tìm thấy nội dung văn bản hoặc hình ảnh" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const promptText = `Bạn là trợ lý chuẩn hóa và giải đề thi trắc nghiệm.
Nhiệm vụ:
1. Đọc kỹ nội dung câu hỏi từ hình ảnh hoặc văn bản được cung cấp.
2. Trích xuất đúng 4 lựa chọn [A, B, C, D] cho mỗi câu.
3. Nếu đề chưa có đáp án, hãy suy luận chính xác đáp án đúng (0: A, 1: B, 2: C, 3: D).
4. Viết giải thích ngắn gọn, súc tích cho đáp án đúng.
5. Luôn trả về mảng JSON theo đúng định dạng.`;

    // Chuẩn bị parts gửi sang Gemini
    const parts = [{ text: promptText }];

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

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const geminiResponse = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
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
      })
    });

    const data = await geminiResponse.json();
    if (!geminiResponse.ok) {
      return new Response(JSON.stringify({ error: data.error?.message || "Lỗi từ Gemini" }), {
        status: geminiResponse.status,
        headers: { "Content-Type": "application/json" }
      });
    }

    const rawJson = data.candidates?.[0]?.content?.parts?.[0]?.text;
    return new Response(rawJson, {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
