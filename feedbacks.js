const db = require('./db');

// 🟩 Ensure feedbacks table exists, with 'todo' column included
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS feedbacks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_email TEXT,
      company TEXT,
      position TEXT,
      filename TEXT,
      summary TEXT,
      full_feedback TEXT,
      todo TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

db.run(`ALTER TABLE feedbacks ADD COLUMN todo TEXT`, (err) => {
  if (err && !err.message.includes("duplicate column name")) {
    console.error("❌ Failed to add 'todo' column:", err.message);
  }
});

// 🟩 Add a new feedback entry with todo
function addFeedback({ user_email, company, position, filename, summary, full_feedback, todo }) {
  const query = `
    INSERT INTO feedbacks (user_email, company, position, filename, summary, full_feedback, todo)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;
  db.run(query, [user_email, company, position, filename, summary, full_feedback, todo]);
}

// ✅ Get all feedbacks for a user
function getFeedbacksByEmail(email, callback) {
  const query = `SELECT * FROM feedbacks WHERE user_email = ? ORDER BY created_at DESC`;
  db.all(query, [email], callback);
}

// ✅ Get a single feedback by ID
function getFeedbackById(id, callback) {
  db.get(`SELECT * FROM feedbacks WHERE id = ?`, [id], callback);
}

module.exports = {
  addFeedback,
  getFeedbacksByEmail,
  getFeedbackById,
};
