require('dotenv').config();

const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const express = require("express");
const session = require("express-session");
const path = require("path");
const multer = require("multer");
const upload = multer();
const app = express();
const db = require('./db');
const feedbacks = require('./feedbacks');

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.static("public"));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(session({
  secret: "rezoom-secret",
  resave: false,
  saveUninitialized: true,
}));

// Function to clean markdown characters from text, preserving intended newlines and numbering
const cleanContent = (text) => {
    // Remove bold markdown (**)
    text = text.replace(/\*\*/g, '');

    // Remove unicode emojis for section headers (e.g., 1️⃣, 2️⃣)
    text = text.replace(/[12]️⃣\s*/g, '');

    // Remove leading markdown hashes (#) if they are not part of a numbered list (e.g., "### Title" -> "Title")
    // But preserve if it's "### 1. Something" -> "1. Something"
    // NOTE: This part needs to be before line.trim() for correct regex matching.
    const lines = text.split('\n').map(line => {
        if (line.match(/^#+\s*(?!\d+\.?\s*)/)) { // If starts with hashes, but not followed by a number and a dot/space
            return line.replace(/^#+\s*/, '');
        } else if (line.match(/^#+\s*\d+\.?\s*/)) { // If starts with hashes followed by a number
            return line.replace(/^#+\s*/, '');
        }
        return line;
    });

    // Rejoin and split again to allow for re-processing with accurate newlines
    text = lines.join('\n');

    const processedLines = text.split('\n').map(line => {
        line = line.trim(); // Trim each line

        // Remove leading list item markers (*, -) if they are present
        line = line.replace(/^[*-]\s*/, '');

        return line;
    });

    // Join the lines back, preserving empty lines for spacing.
    return processedLines.join('\n');
};

// Home Page
app.get("/", (req, res) => {
  res.render("index", { email: req.session.user });
});

// Login
app.get("/login", (req, res) => {
  res.render("login", { email: req.session.user || null, error: null });
});

app.post("/login", (req, res) => {
  const { email, password } = req.body;
  const query = `SELECT * FROM users WHERE email = ? AND password = ?`;
  db.get(query, [email, password], (err, row) => {
    if (!row) {
      return res.render("login", { error: "이 계정은 존재하지 않습니다.", email: null });
    }
    req.session.user = row.email;
    res.redirect("/");
  });
});

// Signup
app.get("/signup", (req, res) => {
  res.render("signup", { email: req.session.user, error: null });
});

app.post("/signup", (req, res) => {
  const { email, password, confirm, nickname } = req.body;
  if (password !== confirm) {
    return res.render("signup", { error: "비밀번호가 일치하지 않습니다.", user: null });
  }
  const checkQuery = `SELECT * FROM users WHERE email = ?`;
  db.get(checkQuery, [email], (err, row) => {
    if (row) {
      return res.render("signup", { error: "이미 등록된 이메일입니다.", user: null });
    }
    const insertQuery = `INSERT INTO users (email, password, nickname) VALUES (?, ?, ?)`;
    db.run(insertQuery, [email, password, nickname], function (err) {
      if (err) return res.send("DB 오류");
      req.session.user = email;
      res.redirect("/");
    });
  });
});

// Feedback Page
app.get("/feedback", (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  res.render("feedback", { email: req.session.user });
});

const pdfParse = require('pdf-parse');
// Feedback submit: generates both feedback & to-do
app.post("/feedback/submit", upload.single("file"), async (req, res) => {
  try {
    const { company, position } = req.body;
    const fileBuffer = req.file.buffer;

    const data = await pdfParse(fileBuffer);
    let text = data.text;
    const wordLimit = 3000;
    text = text.split(' ').slice(0, wordLimit).join(' ');

    const intro = `기업명: ${company}, 모집 직무: ${position}`;

    const prompt = `
[지원 기업 및 직무]
${intro}

[자기소개서]
${text}

---

당신은 채용 평가자 역할을 맡은 인공지능 조교입니다. 아래 기준에 맞춰 분석 결과를 **두 개의 명확한 섹션**으로 작성해 주세요.

1️⃣ 불합격 사유 (피드백)
- 이 자기소개서에서 불합격할 가능성이 높은 구체적인 이유들을 항목별로 설명해 주세요.
- 내용, 표현, 구조, 직무 적합성 등 채용 평가 기준에 기반하여 비판적으로 지적해 주세요.
- 각 항목은 번호 또는 제목으로 구분해 주세요.  
(예: "1. 구조", "2. 표현력", "3. 직무 연관성")

2️⃣ 개선을 위한 To-do 리스트
- 사용자가 다음 자기소개서를 더 경쟁력 있게 만들기 위해 실천해야 할 행동을 To-do 리스트 형식으로 제시해 주세요.
- **모호한 조언이 아니라**, 다음 항목들을 포함해 최대한 구체적이고 실행 가능한 내용으로 구성해 주세요:
  - 추천 자격증 (예: SQLD, 컴활 1급)
  - 부족한 경험을 채우기 위한 구체적인 활동/프로젝트 아이디어
  - 직무 관련 경험 강화 방안
  - 사용 가능한 툴, 포트폴리오 작성 방식, 표현 개선 방법 등
- 각 항목은 번호로 구분해 주세요.
- 필요하다면 예시를 들어 주세요.

[시스템 내부용 - 사용자에게 보이지 않음]
이 자기소개서를 10점 만점으로 평가하고, 반드시 "Score: X/10" 형식으로만 작성해 주세요.
이 섹션은 사용자에게 보이지 않아야 하며, 시스템 내부 평가용입니다. 위에 적힌 [시스템 내부용] 섹션은 사용자에게 보이지 않아야 합니다.
`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: '너는 자소서를 분석해서 불합격 사유와 개선점을 알려주는 조교야.' },
          { role: 'user', content: prompt },
        ],
      }),
    });

    const json = await response.json();
    let reply = json?.choices?.[0]?.message?.content || '⚠️ 응답 오류';

    let feedbackText = "⚠️ 불합격 사유 분석 실패";
    let todoText = "⚠️ To-do 리스트 생성 실패";
    let score = null;

    // Extract score from the reply
    const scoreRegex = /Score:\s*(\d+)\/10/i;
    const scoreMatch = reply.match(scoreRegex);
    if (scoreMatch && scoreMatch[1]) {
        score = parseInt(scoreMatch[1], 10);
        // Remove the entire system internal section and any score-related content
        reply = reply.replace(/\[시스템 내부용[\s\S]*?\]/gi, '').replace(/Score:\s*\d+\/10/gi, '').trim();
        // Also remove any standalone score lines that might have slipped through
        reply = reply.replace(/Score:\s*\d+\/10/i, '');
    }

    // 2. Separate Feedback and To-do from the remaining reply content
    const todoHeader = "**2️⃣ 개선을 위한 To-do 리스트**";
    const todoHeaderIndex = reply.indexOf(todoHeader);

    if (todoHeaderIndex !== -1) {
        feedbackText = reply.substring(0, todoHeaderIndex);
        // todoText starts after the matched header
        todoText = reply.substring(todoHeaderIndex + todoHeader.length);
    } else {
        // Try alternative header formats
        const altTodoHeaders = [
            "2. 개선을 위한 To-do 리스트",
            "2️⃣ 개선을 위한 To-do 리스트",
            "개선을 위한 To-do 리스트",
            "To-do 리스트"
        ];
        
        for (const header of altTodoHeaders) {
            const index = reply.indexOf(header);
            if (index !== -1) {
                feedbackText = reply.substring(0, index);
                todoText = reply.substring(index + header.length);
                break;
            }
        }
        
        // If still no todo section found, assume the whole content is feedback
        if (todoText === "⚠️ To-do 리스트 생성 실패") {
            feedbackText = reply;
        }
    }

    // Apply cleaning to extracted feedback and todo texts
    feedbackText = cleanContent(feedbackText);
    todoText = cleanContent(todoText);

    // Ensure the to-do list starts with "To-do list" and add a newline if content follows
    if (todoText && todoText !== "⚠️ To-do 리스트 생성 실패") {
        // Remove any existing numbering or headers like "2. To-do list" or "1. To-do list"
        todoText = todoText.replace(/^(?:\d+[️⃣.]\s*)?(?:개선을 위한 )?To-?do 리스트[:：]?\s*/i, '');
        todoText = todoText.replace(/^(?:1[️⃣.]\s*)?불합격 사유 \(피드백\)[:：]?\s*/i, ''); // Ensure feedback header is not in todo text

        // If there's actual content after cleaning, add the desired prefix with a newline
        if (todoText.length > 0) {
            todoText = "To-do list\n" + todoText;
        } else {
            todoText = "To-do list"; // Only the title if no content
        }
    }

    // ✅ Save to DB once
    feedbacks.addFeedback({
      user_email: req.session.user,
      company,
      position,
      filename: req.file.originalname,
      summary: feedbackText.slice(0, 60) + "...",
      full_feedback: feedbackText, // Store the cleaned feedback text
      todo: todoText, // Store the cleaned todo text
      score: score, // Store the extracted score
    });

    // ✅ Respond once
    return res.json({ feedback: feedbackText, todo: todoText }); // Don't send score to client

  } catch (err) {
    console.error("처리 중 오류:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "서버 오류" });
    }
  }
});

// Feedback view page
app.get("/feedback/view/:id", (req, res) => {
  const id = req.params.id;
  feedbacks.getFeedbackById(id, (err, feedback) => {
    if (err || !feedback || feedback.user_email !== req.session.user) {
      return res.send("Unauthorized or not found");
    }
    res.render("feedback_view", {
      email: req.session.user,
      feedback,
      initialPrompt: feedback.prompt, // Pass the initial prompt for potential follow-up context
      originalFile: feedback.filename // Pass original file name for display or context
    });
  });
});

// Feedback History page
app.get("/feedback/history", (req, res) => {
  if (!req.session.user) return res.redirect("/login");

  feedbacks.getFeedbacksByEmail(req.session.user, (err, feedbackHistory) => {
    if (err) {
      console.error("Error fetching feedbacks for history:", err);
      feedbackHistory = []; // Ensure it's an empty array on error
    }
    res.render("feedback_history", { feedbackHistory, email: req.session.user });
  });
});

// To-do list page
app.get("/todo", (req, res) => {
  if (!req.session.user) return res.redirect("/login");

  feedbacks.getFeedbacksByEmail(req.session.user, (err, allFeedbacks) => {
    if (err) {
      console.error("To-do fetch error:", err);
      return res.send("오류가 발생했습니다.");
    }

    const todoList = allFeedbacks.filter(fb => fb.todo && fb.todo.trim().length > 0);
    res.render("todolist", { todoList, email: req.session.user });
  });
});

// Profile page
app.get("/profile", (req, res) => {
  if (!req.session.user) return res.redirect("/login");

  const query = `SELECT * FROM users WHERE email = ?`;
  db.get(query, [req.session.user], (err, row) => {
    if (err || !row) return res.redirect("/login");

    const user = {
      email: row.email,
      profile: {
        name: row.name || "",
        age: row.age || "",
        university: row.university || "",
        gpa: row.gpa || "",
        nickname: row.nickname || ""
      }
    };

    feedbacks.getFeedbacksByEmail(req.session.user, (err, feedbackHistory) => {
      if (err) {
        console.error("Error fetching feedbacks:", err);
        feedbackHistory = [];
      }
      // Sort feedbacks by date for the graph
      feedbackHistory.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      res.render("profile", { user, email: req.session.user, feedbackHistory });
    });
  });
});

// Profile save
app.post("/profile", (req, res) => {
  const { name, age, university, gpa, nickname } = req.body;
  const updateQuery = `
    UPDATE users SET name = ?, age = ?, university = ?, gpa = ?, nickname = ?
    WHERE email = ?
  `;
  db.run(updateQuery, [name, age, university, gpa, nickname, req.session.user], function (err) {
    if (err) {
      console.error("DB update error:", err);
      return res.send("오류가 발생했습니다.");
    }
    res.redirect("/profile");
  });
});

// Logout
app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

// New endpoint for continuing chat (ephemeral, not saved to DB)
app.post("/chat/message", async (req, res) => {
  if (!req.session.user) return res.status(401).send("Unauthorized");

  try {
    const { message, conversationHistory } = req.body;

    const messages = conversationHistory.map(msg => ({ role: msg.role, content: msg.content }));
    messages.push({ role: 'user', content: message });

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: messages,
      }),
    });

    const json = await response.json();
    console.log("OpenAI API Response:", json);
    let reply = json?.choices?.[0]?.message?.content || '⚠️ 응답 오류';

    // Apply cleaning to the chat reply
    reply = cleanContent(reply);

    res.json({ reply });

  } catch (error) {
    console.error("Error in chat message:", error);
    res.status(500).send("채팅 메시지 처리 중 오류가 발생했습니다.");
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
