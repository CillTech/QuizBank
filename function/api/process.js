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

    const { text } = await request.json();
    if (!text) {
      return new Response(JSON.stringify({ error: "Không có nội dung câu hỏi" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const prompt = `Bạn là trợ lý chuẩn hóa đề thi trắc nghiệm.
Dưới đây là nội dung thô:
---
${text}
---
Nhiệm vụ:
1. Nhận diện từng câu hỏi và trích xuất đúng 4 lựa chọn [A, B, C, D].
2. Nếu thiếu đáp án, suy luận chính xác đáp án đúng (0: A, 1: B, 2: C, 3: D).
3. Nếu thiếu giải thích, hãy viết giải thích ngắn gọn, súc tích.
4. Trả về mảng JSON theo đúng định dạng.`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const geminiResponse = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
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
