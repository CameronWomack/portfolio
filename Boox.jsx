import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Search, Plus, Heart, X, Info, ChevronLeft, ChevronRight, Loader2,
  Sparkles, ThumbsUp, Check, Wand2, SlidersHorizontal, ArrowLeft, Home,
  Upload, FileText, Edit3,
} from "lucide-react";

/* ============================================================== *
 *  BOOX — a Netflix-style reading recommender                    *
 * ============================================================== */
const C = {
  bg: "#0B0B0F", bg2: "#15151B", surface: "#1C1C24", line: "#2C2C36",
  text: "#F4F4F6", dim: "#A7A7B0", faint: "#6C6C76",
  red: "#E50914", green: "#46D369", gold: "#E8B33D",
};
const GENRES = ["Literary Fiction","Contemporary","Classics","Historical Fiction","Sci-Fi","Fantasy","Mystery","Thriller","Romance","Horror","Short Stories","Poetry","Memoir","Essays","Biography","Philosophy","Science","History"];
const MOODS = ["Melancholic","Cozy","Tense","Hopeful","Funny","Dark","Reflective","Romantic","Uplifting","Eerie","Adventurous","Bittersweet","Comforting","Challenging"];
const LENGTHS = ["Any","Short","Medium","Long"];
const FICTION = ["Any","Fiction","Nonfiction"];
const STORAGE_KEY = "boox:v3";

const uid = () => Math.random().toString(36).slice(2, 10);
const defaultBook = () => ({ coverUrl: "", tags: [], subjects: [], length: "Medium", difficulty: "Moderate", authorNote: "", dateRead: "", isbn: "", year: "", whyLiked: "", description: "", genres: [], moods: [], sentiment: null, rating: 0, fiction: "fiction" });
const seedBooks = () => ([
  { title: "The Copenhagen Trilogy", author: "Tove Ditlevsen", rating: 5, sentiment: "liked", fiction: "nonfiction", genres: ["Memoir"], moods: ["Melancholic","Reflective"], description: "A Danish poet's searing three-part memoir of childhood, art, marriage, and addiction. Spare prose that cuts to the bone." },
  { title: "Gilead", author: "Marilynne Robinson", rating: 5, sentiment: "liked", fiction: "fiction", genres: ["Literary Fiction"], moods: ["Reflective","Hopeful"], description: "An aging preacher writes a long letter to his young son. A luminous meditation on grace and mortality." },
  { title: "Bluets", author: "Maggie Nelson", rating: 5, sentiment: "liked", fiction: "nonfiction", genres: ["Essays","Poetry"], moods: ["Melancholic","Reflective"], description: "240 numbered fragments orbiting the color blue, heartbreak, and longing. Lyric philosophy at its most intimate." },
  { title: "The Remains of the Day", author: "Kazuo Ishiguro", rating: 5, sentiment: "liked", fiction: "fiction", genres: ["Literary Fiction","Historical Fiction"], moods: ["Bittersweet","Reflective"], description: "An English butler reflects on a life of duty and the love he never let himself claim." },
  { title: "Convenience Store Woman", author: "Sayaka Murata", rating: 4, sentiment: "liked", fiction: "fiction", genres: ["Literary Fiction","Contemporary"], moods: ["Funny","Eerie"], description: "A woman finds perfect order working at a Tokyo convenience store, baffling everyone who wants more for her." },
  { title: "Educated", author: "Tara Westover", rating: 4, sentiment: "liked", fiction: "nonfiction", genres: ["Memoir"], moods: ["Tense","Hopeful"], description: "Raised off-grid by survivalist parents, the author claws her way to a Cambridge PhD." },
  { title: "Norwegian Wood", author: "Haruki Murakami", rating: 4, sentiment: null, fiction: "fiction", genres: ["Literary Fiction"], moods: ["Melancholic","Romantic"], description: "A nostalgic, melancholy love story set in late-60s Tokyo." },
  { title: "A Little Life", author: "Hanya Yanagihara", rating: 2, sentiment: "disliked", fiction: "fiction", genres: ["Literary Fiction"], moods: ["Dark","Melancholic"], description: "Four friends in New York, and one man's lifelong reckoning with trauma." },
  { title: "Sapiens", author: "Yuval Noah Harari", rating: 3, sentiment: null, fiction: "nonfiction", genres: ["History","Science"], moods: ["Reflective"], description: "A sweeping history of humankind from foragers to the modern age." },
  { title: "The Argonauts", author: "Maggie Nelson", rating: 4, sentiment: "liked", fiction: "nonfiction", genres: ["Memoir","Essays"], moods: ["Reflective","Challenging"], description: "A genre-bending autotheory of queer family-making, love, and identity." },
].map(b => ({ ...defaultBook(), id: uid(), ...b })));

/* ---------- persistence ---------- */
const hasStore = () => typeof window !== "undefined" && window.storage;
async function loadState() {
  if (!hasStore()) return null;
  try { const r = await window.storage.get(STORAGE_KEY); return r ? JSON.parse(r.value) : null; } catch { return null; }
}
async function saveState(s) { if (!hasStore()) return; try { await window.storage.set(STORAGE_KEY, JSON.stringify(s)); } catch {} }

/* ---------- Claude ---------- */
async function callClaude(system, userText, maxTokens = 2200) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: maxTokens, system, messages: [{ role: "user", content: userText }] }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
}
function parseJSON(text) {
  let t = (text || "").trim().replace(/```json/gi, "").replace(/```/g, "").trim();
  const s = t.indexOf("["), e = t.lastIndexOf("]"), so = t.indexOf("{"), eo = t.lastIndexOf("}");
  if (s !== -1 && e !== -1 && (so === -1 || s < so)) t = t.slice(s, e + 1);
  else if (so !== -1 && eo !== -1) t = t.slice(so, eo + 1);
  try { return JSON.parse(t); } catch (e) { return repairJSON(t); }
}
/* Salvage truncated JSON: find the last position where a sub-structure closed cleanly,
   cut there, and close the remaining open brackets/braces. Recovers a partial result
   from a response that ran out of tokens mid-item. */
function repairJSON(text) {
  let inString = false, esc = false, lastSafeCut = -1;
  const stack = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (esc) { esc = false; continue; }
    if (c === '\\' && inString) { esc = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === '{' || c === '[') stack.push(c);
    else if (c === '}' || c === ']') {
      stack.pop();
      if (stack.length > 0) lastSafeCut = i;
    }
  }
  if (lastSafeCut < 0) throw new Error("Cannot repair JSON");
  let truncated = text.slice(0, lastSafeCut + 1);
  // Re-scan to find the still-open brackets at the cut point
  inString = false; esc = false;
  const stillOpen = [];
  for (let i = 0; i < truncated.length; i++) {
    const c = truncated[i];
    if (esc) { esc = false; continue; }
    if (c === '\\' && inString) { esc = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === '{' || c === '[') stillOpen.push(c);
    else if (c === '}' || c === ']') stillOpen.pop();
  }
  while (stillOpen.length) truncated += stillOpen.pop() === '{' ? '}' : ']';
  return JSON.parse(truncated);
}

/* ---------- taste profile (rich) ---------- */
function tasteProfile(books) {
  const loved = books.filter(b => b.sentiment === "liked" || b.rating >= 4);
  const disliked = books.filter(b => b.sentiment === "disliked" || (b.rating > 0 && b.rating <= 2));
  const tally = (arr, key) => {
    const m = {}; arr.forEach(b => (b[key] || []).forEach(v => (m[v] = (m[v] || 0) + 1)));
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 12).map(x => x[0]);
  };
  const fmtBook = b => {
    const lines = [`• "${b.title}" by ${b.author}${b.year ? ` (${b.year})` : ""}${b.rating ? ` — ${b.rating}/5` : ""}`];
    if (b.genres?.length) lines.push(`  Genre: ${b.genres.join(", ")}`);
    if (b.subjects?.length) lines.push(`  Themes/subjects: ${b.subjects.slice(0, 8).join(", ")}`);
    if (b.moods?.length) lines.push(`  Mood: ${b.moods.join(", ")}`);
    if (b.whyLiked) lines.push(`  Reader's own note: "${b.whyLiked}"`);
    return lines.join("\n");
  };
  return [
    `BOOKS THE READER LOVED:\n${loved.slice(0, 25).map(fmtBook).join("\n\n") || "(none yet)"}`,
    `BOOKS THE READER DISLIKED (avoid these patterns):\n${disliked.slice(0, 12).map(fmtBook).join("\n\n") || "(none yet)"}`,
    `RECURRING GENRES: ${tally(loved, "genres").join(", ") || "n/a"}`,
    `RECURRING THEMES: ${tally(loved, "subjects").join(", ") || "n/a"}`,
    `RECURRING MOODS: ${tally(loved, "moods").join(", ") || "n/a"}`,
  ].join("\n\n");
}

const ITEM = `{"title":string,"author":string,"year":string,"description":string,"whyForYou":string,"similarTo":[{"title":string,"reason":string}],"confidence":integer,"genre":string,"fiction":string,"length":string,"moods":[string]}`;

const SYS = `You are an exceptionally well-read personal librarian with deep knowledge of literature, criticism, and how books are received by readers. When recommending, you weigh multiple signals in this priority order:

1. The reader's LOVED and DISLIKED titles — primary signal
2. The themes, subjects, prose style, narrative form, and structural qualities of those books (not merely topic or genre)
3. The reader's own NOTES on why they loved a book — these are direct evidence of taste, give them very high weight
4. How serious readers and critics have received each candidate book — its reputation, what reviewers consistently value about it, its standing among readers who love similar work
5. The author's broader catalog and literary influences
6. Recurring genres, themes, and moods in the reader's library

Always recommend ONLY real, existing, published books — never invent titles. When you explain similarity, reference the reader's ACTUAL book titles exactly and name SPECIFIC shared qualities (e.g. "shares the fragmentary structure and meditative prose of Bluets" rather than just "similar mood"). The "whyForYou" field should connect specifically to what this reader has shown they value, not generic praise.`;

async function getBrowse({ books, steer, feedback, exclude }) {
  const loved = [...books].filter(b => b.sentiment === "liked" || b.rating >= 4).sort((a, b) => (b.rating || 0) - (a.rating || 0));
  const anchor = loved[0];
  const ctrl = [
    steer.genres.length ? `Genres: ${steer.genres.join(", ")}` : "",
    steer.moods.length ? `Moods: ${steer.moods.join(", ")}` : "",
    steer.length !== "Any" ? `Length: ${steer.length}` : "",
    steer.fiction !== "Any" ? `Type: ${steer.fiction}` : "",
    steer.authorNote ? `Author: ${steer.authorNote}` : "",
  ].filter(Boolean).join("; ");
  const avoid = [...new Set([...exclude, ...(feedback.dismissed||[]).map(x=>x.title), ...(feedback.notInterested||[]).map(x=>x.title), ...books.map(b=>b.title)])].slice(0, 250);
  const prompt = `READER PROFILE:
${tasteProfile(books)}

STEERING CONTROLS: ${ctrl || "(none — go on taste profile alone)"}
FREE-TEXT REQUEST: ${steer.chat ? `"${steer.chat}"` : "(none)"}

NEVER RECOMMEND: ${avoid.join("; ")}

Build a personalized browse homepage. Return ONLY valid JSON in this shape:
{"rows":[{"category":string,"items":[${ITEM}]}]}

Rules:
- Exactly 5 rows, 4 distinct real books each (20 unique books total, never repeat a title across rows).
- Row 1 title must be exactly: "Top Picks for You"${steer.chat ? ` and must directly answer the request "${steer.chat}"` : ""}.
${anchor ? `- One row title must be exactly: Because You Loved "${anchor.title}"` : ""}
- Other rows: lively names that reflect the reader's recurring genres, themes, or moods (e.g. "Quiet Domestic Reckonings", "Translated Lit That Surprises", "Restraint and Regret").
- For each book, the "whyForYou" must reference THIS reader's specific taste evidence — quote or paraphrase their notes when relevant.
- The "similarTo.reason" must name a SPECIFIC shared quality (prose, structure, theme), not generic similarity.
- No markdown, no preamble, no commentary outside the JSON.`;
  const raw = await callClaude(SYS, prompt, 8192);
  const obj = parseJSON(raw);
  const arr = Array.isArray(obj) ? obj : (obj.rows || []);
  return arr.map(r => ({ category: r.category || "Picks", items: (r.items || []).map(it => ({ id: uid(), coverUrl: "", ...it })) })).filter(r => r.items.length);
}

async function getSimilar({ books, feedback, source, exclude }) {
  const avoid = [...new Set([...exclude, ...(feedback.dismissed||[]).map(x=>x.title), ...books.map(b=>b.title)])].slice(0, 250);
  const srcBook = books.find(b => b.title === source.title);
  const srcDetail = srcBook ? `\nWhat we know about "${source.title}":\n${srcBook.subjects?.length ? `Themes: ${srcBook.subjects.slice(0, 8).join(", ")}\n` : ""}${srcBook.genres?.length ? `Genre: ${srcBook.genres.join(", ")}\n` : ""}${srcBook.whyLiked ? `Reader's note: "${srcBook.whyLiked}"` : ""}` : "";
  const prompt = `The reader loved "${source.title}" by ${source.author}.${srcDetail}

Their broader taste:
${tasteProfile(books)}

Recommend 8 real books that fans of "${source.title}" would love AND that also fit this reader's broader taste signals. In "similarTo", reference "${source.title}" specifically with a concrete shared quality (prose, structure, theme).
NEVER recommend: ${avoid.join("; ")}
Return ONLY a JSON array: [${ITEM}]. No markdown.`;
  const raw = await callClaude(SYS, prompt, 4096);
  const arr = parseJSON(raw);
  return (Array.isArray(arr) ? arr : []).map(r => ({ id: uid(), coverUrl: "", ...r }));
}

async function enrichDescriptions(items) {
  const prompt = `For each book write one vivid, spoiler-free sentence.\n${items.map(b => `"${b.title}" by ${b.author}`).join("\n")}\nReturn ONLY JSON: [{"title":string,"description":string}]`;
  const raw = await callClaude("Write concise vivid descriptions of real books. Return ONLY JSON.", prompt, 1500);
  const arr = parseJSON(raw);
  const map = {};
  (Array.isArray(arr) ? arr : []).forEach(x => { if (x.title) map[x.title] = x.description; });
  return map;
}

async function smartImport(text) {
  const prompt = `Parse into JSON array. Each: {"title","author","rating":0-5,"sentiment":"liked"|"disliked"|null,"fiction":"fiction"|"nonfiction","genres":[],"moods":[],"description":string}\nText: """${text}"""\nReturn ONLY JSON array.`;
  const raw = await callClaude("Parse reader's notes into structured book data. Real books only. Return ONLY JSON.", prompt, 2000);
  const arr = parseJSON(raw);
  return (Array.isArray(arr) ? arr : []).map(b => ({ ...defaultBook(), id: uid(), ...b }));
}

/* ---------- Claude-powered book suggester for search ---------- */
async function suggestBooks(query, limit = 5) {
  const prompt = `A reader is searching for a book to add to their library. Their query: "${query}"

Suggest ${limit} real, existing, published books that match this query. The query may be:
- A partial or fuzzy title or author (interpret leniently)
- A description of a vibe, topic, theme, or genre
- A reference by similarity ("like Bluets but plot-driven")
- A half-remembered detail ("the one about the lighthouse keeper")

Return ONLY a JSON array of items shaped exactly:
[{"title": string, "author": string, "year": string (4-digit, optional), "why": string (under 12 words, why this matches the query)}]
Real books only — no invented titles. Be confident: if the query points to a specific famous book, name it.`;
  const raw = await callClaude("You suggest real, existing books based on a reader's search query. Return ONLY a JSON array, no prose.", prompt, 1500);
  try {
    const arr = parseJSON(raw);
    return (Array.isArray(arr) ? arr : []).filter(b => b.title && b.author);
  } catch { return []; }
}

/* ---------- CSV parsing ---------- */
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false, i = 0;
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++;
    } else {
      if (c === '"') { inQuotes = true; i++; continue; }
      if (c === ',') { row.push(field); field = ""; i++; continue; }
      if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = []; i++; continue;
      }
      field += c; i++;
    }
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}
const stripGRwrap = s => (s || "").replace(/^="(.*)"$/, "$1").replace(/^"(.*)"$/, "$1").trim();
function shelfToGenre(shelf) {
  const s = shelf.toLowerCase().trim().replace(/[_]/g, "-");
  const M = {
    "literary-fiction":"Literary Fiction","literary":"Literary Fiction","literature":"Literary Fiction",
    "fantasy":"Fantasy","sci-fi":"Sci-Fi","science-fiction":"Sci-Fi","sf":"Sci-Fi",
    "mystery":"Mystery","mysteries":"Mystery","crime":"Mystery",
    "thriller":"Thriller","thrillers":"Thriller","suspense":"Thriller",
    "romance":"Romance","horror":"Horror",
    "historical-fiction":"Historical Fiction","historical":"Historical Fiction",
    "memoir":"Memoir","memoirs":"Memoir","autobiography":"Memoir",
    "biography":"Biography","biographies":"Biography",
    "philosophy":"Philosophy","essays":"Essays","essay":"Essays","poetry":"Poetry",
    "short-stories":"Short Stories","short-story":"Short Stories",
    "history":"History","science":"Science",
    "contemporary":"Contemporary","contemporary-fiction":"Contemporary",
    "classics":"Classics","classic":"Classics","classic-literature":"Classics",
  };
  return M[s] || null;
}
const shelfHintsNonfiction = sh => /nonfiction|non-fiction|non_fiction/.test(sh.toLowerCase().trim());

function parseGoodreadsCSV(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) return { books: [], skipped: 0, totalRows: 0 };
  const headers = rows[0].map(h => h.trim());
  const idx = name => headers.findIndex(h => h.toLowerCase() === name.toLowerCase());
  const col = {
    title: idx("Title"), author: idx("Author"),
    isbn: idx("ISBN"), isbn13: idx("ISBN13"),
    myRating: idx("My Rating"),
    dateRead: idx("Date Read"),
    bookshelves: idx("Bookshelves"), exclusiveShelf: idx("Exclusive Shelf"),
    myReview: idx("My Review"), privateNotes: idx("Private Notes"),
    pages: idx("Number of Pages"), yearPub: idx("Year Published"),
  };
  if (col.title === -1 || col.author === -1) return { books: [], skipped: 0, totalRows: rows.length - 1, badFormat: true };

  let skipped = 0; const books = [];
  for (const r of rows.slice(1)) {
    const title = r[col.title]?.trim(), author = r[col.author]?.trim();
    if (!title || !author) { skipped++; continue; }
    const rating = parseInt(r[col.myRating] || "0", 10) || 0;
    const shelves = (col.bookshelves !== -1 ? (r[col.bookshelves] || "") : "").split(",").map(s => s.trim()).filter(Boolean);
    const userShelves = shelves.filter(s => !["read","to-read","currently-reading"].includes(s.toLowerCase()));
    const exShelf = (col.exclusiveShelf !== -1 ? (r[col.exclusiveShelf] || "") : "").trim().toLowerCase();
    const isbn = stripGRwrap(col.isbn13 !== -1 ? r[col.isbn13] : "") || stripGRwrap(col.isbn !== -1 ? r[col.isbn] : "");
    const pages = parseInt(stripGRwrap(col.pages !== -1 ? r[col.pages] : "") || "0", 10) || 0;
    const review = (col.myReview !== -1 ? r[col.myReview] : "")?.trim() || "";
    const notes = (col.privateNotes !== -1 ? r[col.privateNotes] : "")?.trim() || "";
    const genres = []; let isNonfiction = false;
    for (const sh of userShelves) {
      const g = shelfToGenre(sh);
      if (g && !genres.includes(g)) genres.push(g);
      if (shelfHintsNonfiction(sh)) isNonfiction = true;
    }
    books.push({
      title, author, isbn,
      rating,
      sentiment: rating >= 4 ? "liked" : (rating > 0 && rating <= 2 ? "disliked" : null),
      whyLiked: notes || review,
      genres, moods: [], subjects: [],
      tags: userShelves.filter(sh => !shelfToGenre(sh) && !shelfHintsNonfiction(sh)).slice(0, 8),
      length: pages > 500 ? "Long" : pages > 250 ? "Medium" : pages > 0 ? "Short" : "Medium",
      difficulty: "Moderate", fiction: isNonfiction ? "nonfiction" : "fiction",
      description: "", dateRead: (col.dateRead !== -1 ? r[col.dateRead] : "")?.trim() || "",
      year: stripGRwrap(col.yearPub !== -1 ? r[col.yearPub] : ""),
      coverUrl: "", authorNote: "", grShelf: exShelf,
    });
  }
  return { books, skipped, totalRows: rows.length - 1 };
}

/* ---------- Open Library ---------- */
async function searchOpenLibrary(q) {
  if (!q.trim()) return [];
  try {
    const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(q.trim())}&limit=12&fields=key,title,author_name,first_publish_year,cover_i,isbn,subject,number_of_pages_median,edition_count`;
    const r = await fetch(url);
    if (!r.ok) return [];
    const d = await r.json();
    return (d.docs || []).map(doc => ({
      olKey: doc.key,
      title: doc.title || "",
      author: (doc.author_name || [])[0] || "Unknown",
      year: doc.first_publish_year ? String(doc.first_publish_year) : "",
      coverUrl: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : "",
      isbn: (doc.isbn || [])[0] || "",
      subjects: (doc.subject || []).slice(0, 20),
      pages: doc.number_of_pages_median || 0,
      editions: doc.edition_count || 0,
    }));
  } catch { return []; }
}
async function enrichFromOL(title, author) {
  try {
    const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(`${title} ${author}`)}&limit=1&fields=cover_i,subject,first_publish_year,isbn,key`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const d = await r.json();
    const doc = d?.docs?.[0]; if (!doc) return null;
    return {
      coverUrl: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg` : "",
      subjects: (doc.subject || []).slice(0, 15),
      year: doc.first_publish_year ? String(doc.first_publish_year) : "",
      isbn: (doc.isbn || [])[0] || "",
    };
  } catch { return null; }
}
async function findCover(title, author) {
  const d = await enrichFromOL(title, author);
  return d?.coverUrl || "";
}

/* ---------- atoms ---------- */
function coverHue(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }
function darkPair(s) { const a = coverHue(s) % 360; return [`hsl(${a} 42% 17%)`, `hsl(${(a+48)%360} 48% 9%)`]; }
function Cover({ title, author, url, w, h, radius = 5 }) {
  const [err, setErr] = useState(false);
  const [c1, c2] = darkPair(title + author);
  const frame = { width: w, height: h, borderRadius: radius, flex: "0 0 auto", overflow: "hidden", display: "block" };
  if (url && !err) return <img src={url} alt={title} onError={() => setErr(true)} style={{ ...frame, objectFit: "cover" }} />;
  return (
    <div style={{ ...frame, background: `linear-gradient(150deg,${c1},${c2})`, padding: "13px 12px", display: "flex", flexDirection: "column", justifyContent: "space-between", color: "#fff", boxSizing: "border-box" }}>
      <div style={{ fontFamily: "Archivo, sans-serif", fontWeight: 800, fontSize: w < 90 ? 13 : 17, lineHeight: 1.1, letterSpacing: -.3 }}>{title}</div>
      <div style={{ fontSize: w < 90 ? 9 : 11, color: C.dim, fontWeight: 600, textTransform: "uppercase", letterSpacing: .4 }}>{author}</div>
    </div>
  );
}
function Match({ n, size = 13 }) { return <span style={{ color: C.green, fontWeight: 800, fontSize: size }}>{Math.max(0, Math.min(100, n || 0))}% Match</span>; }
function Tag({ children }) { return <span style={{ fontSize: 11, fontWeight: 700, color: C.dim, border: `1px solid ${C.line}`, borderRadius: 4, padding: "2px 7px" }}>{children}</span>; }
const inputStyle = { width: "100%", padding: "10px 13px", borderRadius: 6, border: `1px solid ${C.line}`, background: C.surface, color: C.text, fontFamily: "Mulish, sans-serif", fontSize: 14, fontWeight: 600, boxSizing: "border-box" };
const dedupeKey = b => `${(b.title || "").toLowerCase().trim()}|${(b.author || "").toLowerCase().trim()}`;
const lbl = { fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: C.faint, fontWeight: 800, marginBottom: 6 };

/* ============================================================== *
 *  APP                                                           *
 * ============================================================== */
export default function Boox() {
  const [view, setView] = useState("home");
  const [books, setBooks] = useState([]);
  const [myList, setMyList] = useState([]);
  const [feedback, setFeedback] = useState({ dismissed: [], notInterested: [] });
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [steer, setSteer] = useState({ genres: [], moods: [], length: "Any", fiction: "Any", authorNote: "", chat: "" });
  const [detail, setDetail] = useState(null);
  const [similar, setSimilar] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [goodreadsOpen, setGoodreadsOpen] = useState(false);
  const [refineOpen, setRefineOpen] = useState(false);

  // Refs to keep fresh values for async callbacks; also used to guard StrictMode double-init
  const R = useRef({ books: [], steer: {}, feedback: {}, myList: [] });
  useEffect(() => { R.current = { books, steer, feedback, myList }; }, [books, steer, feedback, myList]);
  const initDone = useRef(false);
  const fetching = useRef(false);
  const enrichInFlight = useRef(new Set());

  /* ---------- The actual fetch ---------- */
  const runFetch = async (bks, st, fb, ml) => {
    if (fetching.current) return;
    if (!bks?.length) { setError("Add some books to your library first."); return; }
    fetching.current = true;
    setLoading(true); setError("");
    try {
      const got = await getBrowse({ books: bks, steer: st, feedback: fb, exclude: ml.map(x => x.title) });
      if (!got.length) throw new Error("Empty result");
      setRows(got);
      // hydrate covers in background
      got.forEach(row => row.items.forEach(async it => {
        const u = await findCover(it.title, it.author);
        if (u) setRows(rs => rs.map(x => ({ ...x, items: x.items.map(y => y.id === it.id ? { ...y, coverUrl: u } : y) })));
      }));
    } catch (e) {
      console.error("Boox fetch failed:", e);
      setError(`Couldn't load recommendations: ${e?.message || "unknown error"}. Tap retry.`);
    } finally {
      setLoading(false);
      fetching.current = false;
    }
  };
  const fetchRecs = () => {
    const { books: b, steer: s, feedback: f, myList: ml } = R.current;
    return runFetch(b, s, f, ml);
  };

  /* ---------- Background OL enrichment ---------- */
  const enrichBooks = async (ids) => {
    const queue = ids.filter(id => !enrichInFlight.current.has(id));
    queue.forEach(id => enrichInFlight.current.add(id));
    for (const id of queue) {
      const book = R.current.books.find(b => b.id === id);
      if (!book) { enrichInFlight.current.delete(id); continue; }
      if (book.subjects?.length && book.coverUrl) { enrichInFlight.current.delete(id); continue; }
      try {
        const data = await enrichFromOL(book.title, book.author);
        if (data) {
          setBooks(p => p.map(b => b.id === id ? {
            ...b,
            coverUrl: b.coverUrl || data.coverUrl,
            subjects: b.subjects?.length ? b.subjects : data.subjects,
            year: b.year || data.year,
            isbn: b.isbn || data.isbn,
          } : b));
        }
      } catch {}
      enrichInFlight.current.delete(id);
      await new Promise(r => setTimeout(r, 100)); // gentle throttle
    }
  };

  /* ---------- Init: load state, populate ref, fetch immediately ---------- */
  useEffect(() => {
    if (initDone.current) return;
    initDone.current = true;
    (async () => {
      let initBooks = seedBooks();
      let initList = [];
      let initFeedback = { dismissed: [], notInterested: [] };
      let initSteer = { genres: [], moods: [], length: "Any", fiction: "Any", authorNote: "", chat: "" };
      try {
        const s = await loadState();
        if (s?.books?.length) {
          // backfill any missing fields on older stored state
          initBooks = s.books.map(b => ({ ...defaultBook(), ...b }));
          initList = s.myList || [];
          initFeedback = { ...initFeedback, ...(s.feedback || {}) };
          initSteer = { ...initSteer, ...(s.steer || {}), chat: "" };
        }
      } catch {}

      // Populate ref synchronously so any async caller sees real data
      R.current = { books: initBooks, steer: initSteer, feedback: initFeedback, myList: initList };

      setBooks(initBooks);
      setMyList(initList);
      setFeedback(initFeedback);
      setSteer(initSteer);
      setLoaded(true);

      // Kick off the first browse fetch IMMEDIATELY with local variables
      runFetch(initBooks, initSteer, initFeedback, initList);

      // Background-enrich any books missing subjects/covers
      const needsEnrich = initBooks.filter(b => !b.subjects?.length || !b.coverUrl).map(b => b.id);
      if (needsEnrich.length) enrichBooks(needsEnrich);
    })();
  }, []);

  /* ---------- Save (debounced — enrichment writes 10/s, storage 409s on concurrent) ---------- */
  const saveTimer = useRef(null);
  useEffect(() => {
    if (!loaded) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveState({ books, myList, feedback, steer: { ...steer, chat: "" } });
    }, 600);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [books, myList, feedback, steer, loaded]);

  /* ---------- Re-fetch when returning to empty home ---------- */
  useEffect(() => {
    if (loaded && view === "home" && !rows.length && !loading && !fetching.current && R.current.books.length) {
      fetchRecs();
    }
  }, [view, loaded, rows.length]); // eslint-disable-line

  /* ---------- Enrich descriptions for My Likes view ---------- */
  const enrichDescRef = useRef(false);
  useEffect(() => {
    if (view !== "likes" || !loaded || enrichDescRef.current) return;
    const need = books.filter(b => (b.sentiment === "liked" || b.rating >= 4) && !b.description);
    if (!need.length) return;
    enrichDescRef.current = true;
    const batches = []; for (let i = 0; i < need.length; i += 25) batches.push(need.slice(i, i + 25));
    (async () => {
      for (const batch of batches) {
        try { const map = await enrichDescriptions(batch); setBooks(p => p.map(b => map[b.title] ? { ...b, description: map[b.title] } : b)); } catch {}
      }
      enrichDescRef.current = false;
    })();
  }, [view, loaded]); // eslint-disable-line

  /* ---------- Actions ---------- */
  const updateBook = (id, patch) => setBooks(p => p.map(b => b.id === id ? { ...b, ...patch } : b));
  const addBook = async (b) => {
    const full = { ...defaultBook(), ...b };
    setBooks(p => [full, ...p]);
    R.current = { ...R.current, books: [full, ...R.current.books] };
    enrichBooks([full.id]);
  };
  const bulkAddBooks = async (incoming) => {
    const existing = new Set(R.current.books.map(dedupeKey));
    const fresh = []; let dupes = 0;
    for (const b of incoming) {
      const key = dedupeKey(b);
      if (existing.has(key)) { dupes++; continue; }
      existing.add(key);
      fresh.push({ ...defaultBook(), id: uid(), ...b });
    }
    if (fresh.length) {
      setBooks(p => [...fresh, ...p]);
      R.current = { ...R.current, books: [...fresh, ...R.current.books] };
      enrichBooks(fresh.map(b => b.id));
    }
    return { added: fresh.length, duplicates: dupes };
  };

  const saveToList = r => setMyList(p => p.find(x => x.title === r.title) ? p : [{ ...r, savedAt: Date.now() }, ...p]);
  const removeFromList = t => setMyList(p => p.filter(x => x.title !== t));
  const passRec = r => {
    setFeedback(f => ({ ...f, dismissed: [...f.dismissed, { title: r.title, author: r.author }] }));
    setRows(rs => rs.map(x => ({ ...x, items: x.items.filter(y => y.id !== r.id) })));
    setSimilar(s => s ? { ...s, items: s.items.filter(y => y.id !== r.id) } : s);
  };
  const markLoved = r => {
    addBook({ id: uid(), title: r.title, author: r.author, coverUrl: r.coverUrl || "", rating: 5, sentiment: "liked", description: r.description || "", genres: r.genre ? [r.genre] : [], moods: r.moods || [], length: r.length || "Medium", fiction: (r.fiction || "Fiction").toLowerCase() });
    removeFromList(r.title);
  };
  const openSimilar = async source => {
    setDetail(null); setSimilar({ source, items: [], loading: true });
    try {
      const { books: b, feedback: f, myList: ml } = R.current;
      const items = await getSimilar({ books: b, feedback: f, source, exclude: ml.map(x => x.title) });
      setSimilar({ source, items, loading: false });
      items.forEach(async it => {
        const u = await findCover(it.title, it.author);
        if (u) setSimilar(s => s?.source.title === source.title ? { ...s, items: s.items.map(y => y.id === it.id ? { ...y, coverUrl: u } : y) } : s);
      });
    } catch { setSimilar({ source, items: [], loading: false, error: true }); }
  };

  const submitSearch = text => {
    const next = { ...R.current.steer, chat: text };
    setSteer(next); R.current.steer = next;
    setRows([]); setView("home");
    runFetch(R.current.books, next, R.current.feedback, R.current.myList);
  };
  const applyRefine = () => {
    setRefineOpen(false); setRows([]); setView("home");
    runFetch(R.current.books, R.current.steer, R.current.feedback, R.current.myList);
  };
  const retryBrowse = () => { setRows([]); fetchRecs(); };
  const resetAll = () => {
    const fresh = seedBooks();
    setBooks(fresh); R.current.books = fresh;
    setMyList([]); setRows([]); setFeedback({ dismissed: [], notInterested: [] });
    runFetch(fresh, R.current.steer, { dismissed: [], notInterested: [] }, []);
    enrichBooks(fresh.map(b => b.id));
  };

  const liked = useMemo(() => books.filter(b => b.sentiment === "liked" || b.rating >= 4), [books]);

  return (
    <div style={{ background: C.bg, color: C.text, minHeight: "100%", fontFamily: "Mulish, sans-serif" }}>
      <FontInjector />
      <Nav view={view} setView={setView} onSearch={submitSearch} steer={steer} setSteer={setSteer} refineOpen={refineOpen} setRefineOpen={setRefineOpen} applyRefine={applyRefine} listCount={myList.length} />
      {!loaded ? <Spinner text="Loading your library…" />
        : view === "home" ? <HomeView rows={rows} loading={loading} error={error} retry={retryBrowse} hasBooks={books.length > 0} onOpen={setDetail} goLikes={() => setView("likes")} chat={steer.chat} />
        : view === "likes" ? <LikesView liked={liked} updateBook={updateBook} onSimilar={openSimilar} onOpen={setDetail} onAdd={() => setAddOpen(true)} onImport={() => setImportOpen(true)} onGoodreads={() => setGoodreadsOpen(true)} onReset={resetAll} removeLike={id => updateBook(id, { sentiment: null, rating: 3 })} />
        : <ListView list={myList} onOpen={setDetail} onSimilar={openSimilar} onRemove={removeFromList} onLoved={markLoved} goHome={() => setView("home")} />}
      {similar && <SimilarOverlay data={similar} onClose={() => setSimilar(null)} onOpen={setDetail} />}
      {detail && <DetailModal r={detail} onClose={() => setDetail(null)} inList={myList.some(x => x.title === detail.title)} onSave={saveToList} onPass={passRec} onLoved={markLoved} onSimilar={openSimilar} />}
      {addOpen && <AddBookModal onClose={() => setAddOpen(false)} onSave={b => { addBook(b); setAddOpen(false); }} />}
      {importOpen && <SmartPasteModal onClose={() => setImportOpen(false)} onDone={async list => { await bulkAddBooks(list); setImportOpen(false); }} />}
      {goodreadsOpen && <GoodreadsImportModal onClose={() => setGoodreadsOpen(false)} bulkAdd={bulkAddBooks} />}
    </div>
  );
}

/* ============================================================== *
 *  NAV                                                           *
 * ============================================================== */
function Nav({ view, setView, onSearch, steer, setSteer, refineOpen, setRefineOpen, applyRefine, listCount }) {
  const [q, setQ] = useState("");
  const toggle = (key, val) => setSteer(s => ({ ...s, [key]: s[key].includes(val) ? s[key].filter(x => x !== val) : [...s[key], val] }));
  return (
    <header style={{ position: "sticky", top: 0, zIndex: 40, background: "linear-gradient(#0B0B0Fee,#0B0B0Fcc)", backdropFilter: "blur(8px)", borderBottom: `1px solid ${C.line}` }}>
      <div style={{ maxWidth: 1280, margin: "0 auto", display: "flex", alignItems: "center", gap: 18, height: 62, padding: "0 22px" }}>
        <div onClick={() => setView("home")} style={{ fontFamily: "Archivo, sans-serif", fontWeight: 900, fontSize: 23, color: C.red, letterSpacing: -.5, cursor: "pointer", textTransform: "uppercase" }}>Boox</div>
        <nav style={{ display: "flex", gap: 2 }}>
          {[["home","Home"],["likes","My Likes"],["list","My List"]].map(([k, label]) => (
            <button key={k} onClick={() => setView(k)} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "Mulish, sans-serif", fontWeight: view === k ? 800 : 600, fontSize: 14.5, color: view === k ? C.text : C.dim, padding: "6px 10px" }}>
              {label}{k === "list" && listCount > 0 && <span style={{ marginLeft: 5, fontSize: 11, background: C.red, color: "#fff", borderRadius: 999, padding: "1px 6px" }}>{listCount}</span>}
            </button>
          ))}
        </nav>
        <div style={{ flex: 1 }} />
        <form onSubmit={e => { e.preventDefault(); if (q.trim()) { onSearch(q.trim()); setQ(""); } }} style={{ display: "flex", gap: 8, flex: "0 1 400px" }}>
          <div style={{ position: "relative", flex: 1 }}>
            <Search size={15} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: C.dim }} />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder='"A book like Bluets" · "cozy short nonfiction"…' style={{ ...inputStyle, paddingLeft: 32, borderRadius: 999 }} />
          </div>
          <button type="button" onClick={() => setRefineOpen(o => !o)} style={{ background: refineOpen ? C.surface : "transparent", border: `1px solid ${refineOpen ? C.text : C.line}`, borderRadius: 6, color: C.text, cursor: "pointer", padding: "0 12px", display: "flex", alignItems: "center", gap: 5, fontWeight: 700, fontSize: 13 }}>
            <SlidersHorizontal size={15} /> Refine
          </button>
        </form>
      </div>
      {refineOpen && (
        <div style={{ maxWidth: 1280, margin: "0 auto", padding: "0 22px 16px" }}>
          <div style={{ background: C.bg2, border: `1px solid ${C.line}`, borderRadius: 12, padding: 16 }}>
            <RRow label="Mood">{MOODS.map(m => <Pill key={m} active={steer.moods.includes(m)} onClick={() => toggle("moods", m)}>{m}</Pill>)}</RRow>
            <RRow label="Genre">{GENRES.slice(0,14).map(g => <Pill key={g} active={steer.genres.includes(g)} onClick={() => toggle("genres", g)}>{g}</Pill>)}</RRow>
            <div style={{ display: "flex", gap: 22, flexWrap: "wrap", marginTop: 4, alignItems: "flex-end" }}>
              <MSel label="Length" value={steer.length} onChange={v => setSteer(s => ({ ...s, length: v }))} options={LENGTHS} />
              <MSel label="Type" value={steer.fiction} onChange={v => setSteer(s => ({ ...s, fiction: v }))} options={FICTION} />
              <div style={{ flex: "1 1 200px" }}>
                <div style={lbl}>Author preference</div>
                <input value={steer.authorNote} onChange={e => setSteer(s => ({ ...s, authorNote: e.target.value }))} placeholder='"woman author", "translated fiction"…' style={inputStyle} />
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
              <button className="btn-red" onClick={applyRefine}><Sparkles size={15} /> Update recommendations</button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
function RRow({ label, children }) { return <div style={{ marginBottom: 12 }}><div style={lbl}>{label}</div><div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>{children}</div></div>; }
function Pill({ children, active, onClick }) { return <button onClick={onClick} style={{ fontSize: 12.5, fontWeight: 700, padding: "5px 12px", borderRadius: 999, cursor: "pointer", border: `1px solid ${active ? C.text : C.line}`, background: active ? C.text : "transparent", color: active ? C.bg : C.dim }}>{children}</button>; }
function MSel({ label, value, onChange, options }) { return <div><div style={lbl}>{label}</div><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{options.map(o => <Pill key={o} active={value === o} onClick={() => onChange(o)}>{o}</Pill>)}</div></div>; }

/* ============================================================== *
 *  HOME                                                          *
 * ============================================================== */
function HomeView({ rows, loading, error, retry, hasBooks, onOpen, goLikes, chat }) {
  const hero = useMemo(() => { let best = null; rows.forEach(r => r.items.forEach(it => { if (!best || (it.confidence||0) > (best.confidence||0)) best = it; })); return best; }, [rows]);
  if (!hasBooks) return <Empty title="Tell Boox what you love" sub="Add a few books you've loved to get your personalized homepage."><button className="btn-red" onClick={goLikes}><Heart size={16} /> Go to My Likes</button></Empty>;
  if (loading && !rows.length) return <Spinner text="Curating your homepage…" />;
  if (error && !rows.length) return <Empty title="Something went wrong" sub={error}><button className="btn-red" onClick={retry}><Sparkles size={15} /> Try again</button></Empty>;
  return (
    <div className="fade">
      {hero && <Hero item={hero} onOpen={onOpen} />}
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "8px 22px 70px" }}>
        {chat && <div style={{ color: C.dim, fontWeight: 700, margin: "10px 2px 20px" }}>Results for <span style={{ color: C.text }}>"{chat}"</span></div>}
        {rows.map((r, i) => <Row key={i} title={r.category} items={r.items} onOpen={onOpen} />)}
        {loading && rows.length > 0 && <div style={{ display: "flex", gap: 8, alignItems: "center", color: C.dim, fontWeight: 700, marginTop: 8 }}><Loader2 className="spin" size={15} /> refreshing…</div>}
      </div>
    </div>
  );
}
function Hero({ item, onOpen }) {
  const [c1, c2] = darkPair(item.title + item.author);
  return (
    <div style={{ position: "relative", height: 460, overflow: "hidden", borderBottom: `1px solid ${C.line}` }}>
      {item.coverUrl ? <img src={item.coverUrl} alt="" style={{ position: "absolute", right: 0, top: "50%", transform: "translateY(-50%)", width: "55%", height: "130%", objectFit: "cover" }} /> : <div style={{ position: "absolute", inset: 0, background: `linear-gradient(120deg,${c1},${c2})` }} />}
      <div style={{ position: "absolute", inset: 0, background: `linear-gradient(90deg,${C.bg} 0%,${C.bg}ee 32%,${C.bg}55 60%,transparent 80%), linear-gradient(0deg,${C.bg} 2%,transparent 28%)` }} />
      <div style={{ position: "relative", maxWidth: 1280, margin: "0 auto", padding: "0 22px", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div style={{ maxWidth: 560 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <span style={{ background: C.red, color: "#fff", fontWeight: 900, fontSize: 10, padding: "3px 7px", borderRadius: 3, letterSpacing: .5 }}>TOP PICK</span>
            <span style={{ color: C.dim, fontWeight: 800, fontSize: 12, letterSpacing: 2, textTransform: "uppercase" }}>For You</span>
          </div>
          <h1 style={{ fontFamily: "Archivo, sans-serif", fontWeight: 900, fontSize: "clamp(34px,5vw,58px)", lineHeight: .95, letterSpacing: -1.5, margin: 0 }}>{item.title}</h1>
          <div style={{ fontSize: 16, color: C.dim, fontWeight: 700, margin: "10px 0" }}>{item.author}{item.year ? ` · ${item.year}` : ""}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
            <Match n={item.confidence} size={15} />{item.genre && <Tag>{item.genre}</Tag>}{item.length && <Tag>{item.length}</Tag>}
          </div>
          <p style={{ fontSize: 16, lineHeight: 1.5, color: "#E6E6EA", maxWidth: 520, display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 3, overflow: "hidden" }}>{item.description}</p>
          <div style={{ marginTop: 20 }}><button className="btn-white" onClick={() => onOpen(item)}><Info size={18} /> More Info</button></div>
        </div>
      </div>
    </div>
  );
}
function Row({ title, items, onOpen }) {
  const ref = useRef();
  if (!items.length) return null;
  return (
    <div style={{ marginBottom: 34 }}>
      <h2 style={{ fontFamily: "Archivo, sans-serif", fontWeight: 800, fontSize: 19, letterSpacing: -.3, margin: "0 0 10px" }}>{title}</h2>
      <div className="rowwrap">
        <button className="rowarrow left" onClick={() => ref.current?.scrollBy({ left: -660, behavior: "smooth" })}><ChevronLeft size={26} /></button>
        <div className="rowscroll" ref={ref}>{items.map(it => <Poster key={it.id} item={it} onOpen={onOpen} />)}</div>
        <button className="rowarrow right" onClick={() => ref.current?.scrollBy({ left: 660, behavior: "smooth" })}><ChevronRight size={26} /></button>
      </div>
    </div>
  );
}
function Poster({ item, onOpen, w = 158 }) {
  const h = Math.round(w * 1.5);
  return (
    <div className="poster" style={{ width: w }} onClick={() => onOpen(item)}>
      <div style={{ position: "relative" }}>
        <Cover title={item.title} author={item.author} url={item.coverUrl} w={w} h={h} radius={6} />
        <div className="poster-ov"><Info size={22} color="#fff" /></div>
      </div>
      <div style={{ marginTop: 7 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5, lineHeight: 1.15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.title}</div>
        <Match n={item.confidence} size={11.5} />
      </div>
    </div>
  );
}

/* ============================================================== *
 *  DETAIL MODAL                                                  *
 * ============================================================== */
function DetailModal({ r, onClose, inList, onSave, onPass, onLoved, onSimilar }) {
  const [c1, c2] = darkPair(r.title + r.author);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 70, background: "rgba(0,0,0,.72)", display: "grid", placeItems: "start center", padding: "40px 16px", overflowY: "auto" }}>
      <div onClick={e => e.stopPropagation()} className="pop" style={{ background: C.bg2, borderRadius: 12, width: "100%", maxWidth: 720, overflow: "hidden", border: `1px solid ${C.line}`, boxShadow: "0 30px 80px rgba(0,0,0,.6)", margin: "auto" }}>
        <div style={{ position: "relative", height: 220, overflow: "hidden" }}>
          {r.coverUrl ? <img src={r.coverUrl} alt="" style={{ position: "absolute", right: 0, top: "50%", transform: "translateY(-50%)", width: "60%", objectFit: "cover" }} /> : <div style={{ position: "absolute", inset: 0, background: `linear-gradient(120deg,${c1},${c2})` }} />}
          <div style={{ position: "absolute", inset: 0, background: `linear-gradient(90deg,${C.bg2} 12%,${C.bg2}cc 40%,transparent 78%),linear-gradient(0deg,${C.bg2},transparent 50%)` }} />
          <button onClick={onClose} style={{ position: "absolute", top: 14, right: 14, width: 34, height: 34, borderRadius: 999, background: "rgba(0,0,0,.6)", border: `1px solid ${C.line}`, color: "#fff", cursor: "pointer", display: "grid", placeItems: "center" }}><X size={18} /></button>
          <div style={{ position: "absolute", left: 24, bottom: 18 }}>
            <h2 style={{ fontFamily: "Archivo, sans-serif", fontWeight: 900, fontSize: 30, letterSpacing: -.8, margin: 0, lineHeight: 1 }}>{r.title}</h2>
            <div style={{ color: C.dim, fontWeight: 700, marginTop: 5 }}>{r.author}{r.year ? ` · ${r.year}` : ""}</div>
          </div>
        </div>
        <div style={{ padding: "18px 24px 24px" }}>
          <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
            <button className="btn-white" onClick={() => onSave(r)} disabled={inList}>{inList ? <><Check size={17} /> In My List</> : <><Plus size={17} /> My List</>}</button>
            <button className="btn-ghost" onClick={() => onLoved(r)}><Heart size={16} /> I loved this</button>
            <button className="btn-ghost" onClick={() => onSimilar({ title: r.title, author: r.author })}><ThumbsUp size={16} /> More Like This</button>
            <button className="btn-ghost" onClick={() => { onPass(r); onClose(); }}><X size={16} /> Not for me</button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
            <Match n={r.confidence} size={14} />{r.genre && <Tag>{r.genre}</Tag>}{r.fiction && <Tag>{r.fiction}</Tag>}{r.length && <Tag>{r.length}</Tag>}
          </div>
          <p style={{ fontSize: 15.5, lineHeight: 1.55, margin: "0 0 16px" }}>{r.description}</p>
          {r.whyForYou && <Sec label="Why you'll like it" color={C.gold}>{r.whyForYou}</Sec>}
          {(r.similarTo||[]).length > 0 && <Sec label="Because of books you've loved" color={C.green}>{r.similarTo.map((s,i) => <div key={i} style={{ marginBottom: 4 }}><span style={{ fontWeight: 800 }}>"{s.title}"</span> <span style={{ color: C.dim }}>— {s.reason}</span></div>)}</Sec>}
          {(r.moods||[]).length > 0 && <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 8 }}>{r.moods.map(m => <Tag key={m}>{m}</Tag>)}</div>}
        </div>
      </div>
    </div>
  );
}
function Sec({ label, color, children }) {
  return <div style={{ marginBottom: 14 }}><div style={{ fontFamily: "Archivo, sans-serif", fontWeight: 800, fontSize: 12, textTransform: "uppercase", letterSpacing: 1, color, marginBottom: 4 }}>{label}</div><div style={{ fontSize: 14.5, lineHeight: 1.5, color: "#E6E6EA" }}>{children}</div></div>;
}

/* ============================================================== *
 *  SIMILAR OVERLAY                                               *
 * ============================================================== */
function SimilarOverlay({ data, onClose, onOpen }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, background: C.bg, overflowY: "auto" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "26px 22px 70px" }}>
        <button className="btn-ghost" onClick={onClose} style={{ marginBottom: 18 }}><ArrowLeft size={16} /> Back</button>
        <div style={{ marginBottom: 22 }}>
          <div style={{ color: C.dim, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase", fontSize: 12 }}>More Like This</div>
          <h1 style={{ fontFamily: "Archivo, sans-serif", fontWeight: 900, fontSize: 34, letterSpacing: -1, margin: "4px 0 0" }}>Because you liked <span style={{ color: C.red }}>"{data.source.title}"</span></h1>
        </div>
        {data.loading ? <Spinner text="Finding kindred books…" />
          : data.error ? <p style={{ color: C.dim }}>Couldn't load — try again.</p>
            : <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px,1fr))", gap: 22 }}>{data.items.map(it => <Poster key={it.id} item={it} onOpen={onOpen} w={150} />)}</div>}
      </div>
    </div>
  );
}

/* ============================================================== *
 *  MY LIKES                                                      *
 * ============================================================== */
function LikesView({ liked, updateBook, onSimilar, onOpen, onAdd, onImport, onGoodreads, onReset, removeLike }) {
  return (
    <div className="fade" style={{ maxWidth: 1280, margin: "0 auto", padding: "26px 22px 70px" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 22 }}>
        <div>
          <h1 style={{ fontFamily: "Archivo, sans-serif", fontWeight: 900, fontSize: 34, letterSpacing: -1, margin: 0 }}>My Likes</h1>
          <p style={{ color: C.dim, fontWeight: 600, margin: "4px 0 0" }}>The books that shape your recommendations. Add a <em>why</em> note — it feeds directly into the engine.</p>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn-ghost" onClick={onGoodreads}><FileText size={16} /> Import Goodreads</button>
          <button className="btn-ghost" onClick={onImport}><Wand2 size={16} /> Smart paste</button>
          <button className="btn-red" onClick={onAdd}><Plus size={17} /> Add a book</button>
        </div>
      </div>
      {!liked.length
        ? <Empty title="No likes yet" sub="Import your Goodreads export, or add books you've loved one by one.">
            <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
              <button className="btn-red" onClick={onGoodreads}><FileText size={16} /> Import Goodreads CSV</button>
              <button className="btn-ghost" onClick={onAdd}><Plus size={16} /> Add manually</button>
            </div>
          </Empty>
        : <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px,1fr))", gap: 16 }}>
            {liked.map(b => (
              <div key={b.id} style={{ background: C.bg2, border: `1px solid ${C.line}`, borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", gap: 14 }}>
                  <Cover title={b.title} author={b.author} url={b.coverUrl} w={74} h={111} radius={6} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: "Archivo, sans-serif", fontWeight: 800, fontSize: 18, lineHeight: 1.05 }}>{b.title}</div>
                    <div style={{ color: C.dim, fontWeight: 700, fontSize: 13, marginBottom: 7 }}>{b.author}{b.year ? ` · ${b.year}` : ""}</div>
                    <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.45, color: "#D4D4DA" }}>
                      {b.description || <span style={{ color: C.faint, fontStyle: "italic", display: "inline-flex", alignItems: "center", gap: 5 }}><Loader2 className="spin" size={11} /> writing a description…</span>}
                    </p>
                    {b.subjects?.length > 0 && (
                      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 8 }}>
                        {b.subjects.slice(0, 4).map(s => <Tag key={s}>{s}</Tag>)}
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  <div style={lbl}>Why you liked it</div>
                  <textarea defaultValue={b.whyLiked} onBlur={e => updateBook(b.id, { whyLiked: e.target.value })} rows={2} placeholder="What made this one click for you? The engine reads this." style={{ ...inputStyle, resize: "vertical", fontSize: 13.5 }} />
                </div>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <button className="btn-white sm" onClick={() => onSimilar({ title: b.title, author: b.author })}><ThumbsUp size={14} /> More like this</button>
                  <button className="link" onClick={() => removeLike(b.id)}>Remove like</button>
                </div>
              </div>
            ))}
          </div>
      }
      <div style={{ marginTop: 30, textAlign: "center" }}><button className="link" onClick={onReset}>Reset to sample library</button></div>
    </div>
  );
}

/* ============================================================== *
 *  MY LIST                                                       *
 * ============================================================== */
function ListView({ list, onOpen, onSimilar, onRemove, onLoved, goHome }) {
  return (
    <div className="fade" style={{ maxWidth: 1280, margin: "0 auto", padding: "26px 22px 70px" }}>
      <h1 style={{ fontFamily: "Archivo, sans-serif", fontWeight: 900, fontSize: 34, letterSpacing: -1, margin: "0 0 4px" }}>My List</h1>
      <p style={{ color: C.dim, fontWeight: 600, margin: "0 0 22px" }}>Books saved to read next. Finished one? Mark it loved to sharpen your homepage.</p>
      {!list.length
        ? <Empty title="Your list is empty" sub="Open any recommendation and tap My List to save it here."><button className="btn-red" onClick={goHome}><Home size={16} /> Browse recommendations</button></Empty>
        : <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px,1fr))", gap: 22 }}>
            {list.map(r => (
              <div key={r.title}>
                <Poster item={r} onOpen={onOpen} w={150} />
                <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
                  <button className="link" onClick={() => onLoved(r)}><Check size={12} /> Read it</button>
                  <button className="link" onClick={() => onRemove(r.title)}>Remove</button>
                </div>
              </div>
            ))}
          </div>
      }
    </div>
  );
}

/* ============================================================== *
 *  ADD A BOOK — Open Library search                              *
 * ============================================================== */
function AddBookModal({ onClose, onSave }) {
  const [phase, setPhase] = useState("search");
  const [query, setQuery] = useState("");
  const [olResults, setOlResults] = useState([]);
  const [aiResults, setAiResults] = useState([]);
  const [loadingOl, setLoadingOl] = useState(false);
  const [loadingAi, setLoadingAi] = useState(false);
  const [picked, setPicked] = useState(null);
  const [confirmForm, setConfirmForm] = useState({ rating: 5, sentiment: "liked", whyLiked: "", fiction: "fiction", length: "Medium" });
  const [manual, setManual] = useState({ title: "", author: "", rating: 5, sentiment: "liked", fiction: "fiction", length: "Medium", genres: [], moods: [], whyLiked: "" });

  useEffect(() => {
    if (phase !== "search") return;
    if (!query.trim()) {
      setOlResults([]); setAiResults([]); setLoadingOl(false); setLoadingAi(false);
      return;
    }
    setLoadingOl(true); setLoadingAi(true);
    let cancelled = false;
    const t = setTimeout(() => {
      // Open Library — fast, canonical catalog
      searchOpenLibrary(query).then(r => {
        if (!cancelled) { setOlResults(r); setLoadingOl(false); }
      }).catch(() => { if (!cancelled) setLoadingOl(false); });
      // Claude — interpretive, handles fuzzy intent
      suggestBooks(query, 5).then(async books => {
        if (cancelled) return;
        const enriched = await Promise.all(books.map(async b => {
          const m = await enrichFromOL(b.title, b.author);
          return {
            olKey: `ai-${b.title}-${b.author}`,
            title: b.title, author: b.author,
            year: b.year || m?.year || "",
            coverUrl: m?.coverUrl || "",
            isbn: m?.isbn || "",
            subjects: m?.subjects || [],
            why: b.why,
            aiSuggested: true,
          };
        }));
        if (!cancelled) { setAiResults(enriched); setLoadingAi(false); }
      }).catch(() => { if (!cancelled) setLoadingAi(false); });
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, phase]);

  // AI suggestions first, OL after, deduped by title+author
  const combined = useMemo(() => {
    const seen = new Set(); const out = [];
    for (const b of [...aiResults, ...olResults]) {
      const k = `${b.title.toLowerCase().trim()}|${b.author.toLowerCase().trim()}`;
      if (seen.has(k)) continue;
      seen.add(k); out.push(b);
    }
    return out;
  }, [aiResults, olResults]);
  const isLoading = loadingOl || loadingAi;

  const pick = book => {
    setPicked(book);
    const subjStr = (book.subjects || []).join(" ").toLowerCase();
    const isNonfiction = /memoir|biography|essay|history|philosophy|science|nonfiction|non-fiction|true crime|self-help/.test(subjStr);
    const pages = book.pages || 0;
    setConfirmForm({ rating: 5, sentiment: "liked", whyLiked: "", fiction: isNonfiction ? "nonfiction" : "fiction", length: pages > 500 ? "Long" : pages > 250 ? "Medium" : pages > 0 ? "Short" : "Medium" });
    setPhase("confirm");
  };
  const saveConfirm = () => {
    if (!picked) return;
    const subj = picked.subjects || [];
    const genres = []; for (const s of subj) { const g = shelfToGenre(s); if (g && !genres.includes(g)) genres.push(g); }
    onSave({ id: uid(), title: picked.title, author: picked.author, coverUrl: picked.coverUrl, isbn: picked.isbn || "", year: picked.year || "", rating: confirmForm.rating, sentiment: confirmForm.sentiment, fiction: confirmForm.fiction, length: confirmForm.length, genres, moods: [], subjects: subj.slice(0, 15), tags: subj.filter(s => !shelfToGenre(s)).slice(0, 6), whyLiked: confirmForm.whyLiked, description: "" });
  };
  const saveManual = () => {
    if (!manual.title.trim() || !manual.author.trim()) return;
    onSave({ id: uid(), ...manual });
  };
  const setM = (k, v) => setManual(p => ({ ...p, [k]: v }));
  const toggleM = (k, v) => setManual(p => ({ ...p, [k]: p[k].includes(v) ? p[k].filter(x => x !== v) : [...p[k], v] }));

  return (
    <Sheet onClose={onClose} maxW={680}>
      {phase === "search" && (
        <div>
          <h2 style={{ fontFamily: "Archivo, sans-serif", fontWeight: 900, fontSize: 24, margin: "0 0 6px" }}>Add a book</h2>
          <p style={{ color: C.dim, fontWeight: 600, fontSize: 13.5, margin: "0 0 14px" }}>Type anything — a title, author, vague memory, or vibe. Boox checks the Open Library catalog and asks Claude for suggestions.</p>
          <div style={{ position: "relative", marginBottom: 12 }}>
            <Search size={16} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: C.dim }} />
            <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder='Title, author, or "a book like Bluets"…' style={{ ...inputStyle, paddingLeft: 36 }} />
            {isLoading && <Loader2 className="spin" size={16} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", color: C.dim }} />}
          </div>
          <div style={{ maxHeight: 420, overflowY: "auto", margin: "0 -8px", padding: "0 8px" }}>
            {!query.trim() && <div style={{ textAlign: "center", padding: "30px 10px", color: C.faint, fontSize: 13.5, fontWeight: 600 }}>Type to search. Try a title, an author, or "a short novel about loneliness."</div>}
            {query.trim() && !isLoading && combined.length === 0 && <div style={{ textAlign: "center", padding: "20px 10px", color: C.dim, fontSize: 14 }}>No results found.</div>}
            <div style={{ display: "grid", gap: 8 }}>
              {combined.map(b => (
                <button key={b.olKey} onClick={() => pick(b)} className="ol-result">
                  <Cover title={b.title} author={b.author} url={b.coverUrl} w={46} h={68} radius={4} />
                  <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontFamily: "Archivo, sans-serif", fontWeight: 800, fontSize: 15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{b.title}</span>
                      {b.aiSuggested && <Sparkles size={11} style={{ color: C.gold, flexShrink: 0 }} />}
                    </div>
                    <div style={{ color: C.dim, fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.author}{b.year ? ` · ${b.year}` : ""}{b.editions > 1 ? ` · ${b.editions} editions` : ""}</div>
                    {b.aiSuggested && b.why
                      ? <div style={{ color: C.gold, fontSize: 11.5, fontStyle: "italic", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>✨ {b.why}</div>
                      : b.subjects?.length > 0 && <div style={{ marginTop: 4, display: "flex", gap: 4, flexWrap: "wrap", overflow: "hidden", maxHeight: 22 }}>{b.subjects.slice(0, 3).map(s => <Tag key={s}>{s}</Tag>)}</div>
                    }
                  </div>
                  <Plus size={18} color={C.dim} />
                </button>
              ))}
            </div>
          </div>
          <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 16, paddingTop: 14, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
            <button className="link" onClick={() => setPhase("manual")}><Edit3 size={13} /> Can't find it? Enter manually</button>
            <button className="link" onClick={onClose}>Cancel</button>
          </div>
        </div>
      )}
      {phase === "confirm" && picked && (
        <div>
          <button className="link" onClick={() => setPhase("search")} style={{ marginBottom: 12 }}><ArrowLeft size={13} /> Back to search</button>
          <div style={{ display: "flex", gap: 16, marginBottom: 16 }}>
            <Cover title={picked.title} author={picked.author} url={picked.coverUrl} w={90} h={135} radius={6} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2 style={{ fontFamily: "Archivo, sans-serif", fontWeight: 900, fontSize: 22, margin: 0, lineHeight: 1.05 }}>{picked.title}</h2>
              <div style={{ color: C.dim, fontWeight: 700, fontSize: 14, marginTop: 4 }}>{picked.author}{picked.year ? ` · ${picked.year}` : ""}</div>
              {picked.subjects?.length > 0 && <div style={{ marginTop: 8, display: "flex", gap: 5, flexWrap: "wrap" }}>{picked.subjects.slice(0, 5).map(s => <Tag key={s}>{s}</Tag>)}</div>}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
            <Pill active={confirmForm.sentiment === "liked"} onClick={() => setConfirmForm(f => ({ ...f, sentiment: "liked", rating: f.rating < 4 ? 5 : f.rating }))}>♥ Loved it</Pill>
            <Pill active={confirmForm.sentiment === "disliked"} onClick={() => setConfirmForm(f => ({ ...f, sentiment: "disliked", rating: 2 }))}>Didn't like it</Pill>
            <Pill active={confirmForm.sentiment === null} onClick={() => setConfirmForm(f => ({ ...f, sentiment: null }))}>Neutral</Pill>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
            <span style={lbl}>Rating</span><StarRow value={confirmForm.rating} onChange={v => setConfirmForm(f => ({ ...f, rating: v }))} />
          </div>
          <div style={{ display: "flex", gap: 22, flexWrap: "wrap", marginBottom: 14 }}>
            <MSel label="Type" value={confirmForm.fiction === "nonfiction" ? "Nonfiction" : "Fiction"} onChange={v => setConfirmForm(f => ({ ...f, fiction: v.toLowerCase() }))} options={["Fiction","Nonfiction"]} />
            <MSel label="Length" value={confirmForm.length} onChange={v => setConfirmForm(f => ({ ...f, length: v }))} options={["Short","Medium","Long"]} />
          </div>
          <Lbl t="Why you liked it (optional, but improves recommendations)">
            <textarea value={confirmForm.whyLiked} onChange={e => setConfirmForm(f => ({ ...f, whyLiked: e.target.value }))} rows={2} placeholder="What made it click?" style={{ ...inputStyle, resize: "vertical" }} />
          </Lbl>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
            <button className="link" onClick={onClose}>Cancel</button>
            <button className="btn-red" onClick={saveConfirm}><Check size={16} /> Add to library</button>
          </div>
        </div>
      )}
      {phase === "manual" && (
        <div>
          <button className="link" onClick={() => setPhase("search")} style={{ marginBottom: 12 }}><ArrowLeft size={13} /> Back to search</button>
          <h2 style={{ fontFamily: "Archivo, sans-serif", fontWeight: 900, fontSize: 22, margin: "0 0 14px" }}>Manual entry</h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Lbl t="Title *"><input value={manual.title} onChange={e => setM("title", e.target.value)} style={inputStyle} autoFocus /></Lbl>
            <Lbl t="Author *"><input value={manual.author} onChange={e => setM("author", e.target.value)} style={inputStyle} /></Lbl>
          </div>
          <div style={{ display: "flex", gap: 14, alignItems: "center", margin: "4px 0 14px", flexWrap: "wrap" }}>
            <Pill active={manual.sentiment === "liked"} onClick={() => setM("sentiment", manual.sentiment === "liked" ? null : "liked")}>♥ Loved it</Pill>
            <Pill active={manual.sentiment === "disliked"} onClick={() => setM("sentiment", manual.sentiment === "disliked" ? null : "disliked")}>Didn't like it</Pill>
            <MSel label="Type" value={manual.fiction === "nonfiction" ? "Nonfiction" : "Fiction"} onChange={v => setM("fiction", v.toLowerCase())} options={["Fiction","Nonfiction"]} />
            <MSel label="Length" value={manual.length} onChange={v => setM("length", v)} options={["Short","Medium","Long"]} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}><span style={lbl}>Rating</span><StarRow value={manual.rating} onChange={v => setM("rating", v)} /></div>
          <RRow label="Genres">{GENRES.map(g => <Pill key={g} active={manual.genres.includes(g)} onClick={() => toggleM("genres", g)}>{g}</Pill>)}</RRow>
          <RRow label="Moods">{MOODS.map(m => <Pill key={m} active={manual.moods.includes(m)} onClick={() => toggleM("moods", m)}>{m}</Pill>)}</RRow>
          <Lbl t="Why you liked it (optional)"><textarea value={manual.whyLiked} onChange={e => setM("whyLiked", e.target.value)} rows={2} placeholder="What made it click?" style={{ ...inputStyle, resize: "vertical" }} /></Lbl>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 6 }}>
            <button className="link" onClick={onClose}>Cancel</button>
            <button className="btn-red" onClick={saveManual} style={{ opacity: manual.title && manual.author ? 1 : .5 }}><Plus size={17} /> Add</button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
function StarRow({ value, onChange }) {
  return (
    <div style={{ display: "inline-flex", gap: 4 }}>
      {[1,2,3,4,5].map(n => (
        <button key={n} onClick={() => onChange(n === value ? 0 : n)} style={{ background: "none", border: "none", cursor: "pointer", padding: 2, color: n <= value ? C.gold : C.line, fontSize: 22, lineHeight: 1 }}>★</button>
      ))}
    </div>
  );
}

/* ============================================================== *
 *  GOODREADS IMPORT                                              *
 * ============================================================== */
function GoodreadsImportModal({ onClose, bulkAdd }) {
  const [phase, setPhase] = useState("upload");
  const [parsed, setParsed] = useState(null);
  const [filterRead, setFilterRead] = useState(true);
  const [selected, setSelected] = useState({});
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState(null);
  const [parseError, setParseError] = useState("");

  const handleFile = async (file) => {
    if (!file) return;
    setParseError("");
    try {
      const text = await file.text();
      const out = parseGoodreadsCSV(text);
      if (out.badFormat) { setParseError("That doesn't look like a Goodreads export — the Title or Author column is missing."); return; }
      if (!out.books.length) { setParseError("Couldn't find any books in that file."); return; }
      setParsed(out);
      const sel = {};
      out.books.forEach(b => { if (b.grShelf === "read") sel[dedupeKey(b)] = true; });
      setSelected(sel);
      setPhase("preview");
    } catch { setParseError("Couldn't read that file. Make sure it's the CSV from Goodreads."); }
  };

  const onDrop = (e) => {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  const visible = useMemo(() => {
    if (!parsed) return [];
    return filterRead ? parsed.books.filter(b => b.grShelf === "read") : parsed.books;
  }, [parsed, filterRead]);
  const selectedCount = useMemo(() => visible.filter(b => selected[dedupeKey(b)]).length, [visible, selected]);

  const toggleAll = (on) => {
    const next = { ...selected };
    visible.forEach(b => { next[dedupeKey(b)] = on; });
    setSelected(next);
  };

  const doImport = async () => {
    const toImport = visible.filter(b => selected[dedupeKey(b)]);
    if (!toImport.length) return;
    setPhase("importing");
    const r = await bulkAdd(toImport);
    setResult(r);
    setPhase("done");
  };

  return (
    <Sheet onClose={onClose} maxW={720}>
      {phase === "upload" && (
        <div>
          <h2 style={{ fontFamily: "Archivo, sans-serif", fontWeight: 900, fontSize: 24, margin: "0 0 6px" }}><FileText size={22} style={{ verticalAlign: -4, color: C.red }} /> Import from Goodreads</h2>
          <p style={{ color: C.dim, fontWeight: 600, fontSize: 13.5, margin: "0 0 14px" }}>Export your library from Goodreads, then drop the CSV here.</p>
          <details style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 13, color: C.dim }}>
            <summary style={{ cursor: "pointer", fontWeight: 700, color: C.text }}>How to get the export</summary>
            <ol style={{ margin: "10px 0 0", paddingLeft: 18, lineHeight: 1.6 }}>
              <li>Go to <span style={{ color: C.text }}>goodreads.com/review/import</span> (log in if needed).</li>
              <li>Click <em>Export Library</em>, wait a moment, then download the CSV.</li>
              <li>Drop the file below.</li>
            </ol>
          </details>
          <label onDragOver={e => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={onDrop}
            style={{ display: "block", border: `2px dashed ${dragOver ? C.red : C.line}`, borderRadius: 12, padding: "36px 18px", textAlign: "center", cursor: "pointer", background: dragOver ? "rgba(229,9,20,.07)" : C.surface, transition: "all .15s" }}>
            <input type="file" accept=".csv,text/csv" onChange={e => handleFile(e.target.files?.[0])} style={{ display: "none" }} />
            <Upload size={32} color={C.dim} />
            <div style={{ fontFamily: "Archivo, sans-serif", fontWeight: 800, fontSize: 16, marginTop: 10 }}>Drop your Goodreads CSV here</div>
            <div style={{ color: C.dim, fontWeight: 600, fontSize: 13, marginTop: 4 }}>or click to browse</div>
          </label>
          {parseError && <p style={{ color: C.red, fontWeight: 700, fontSize: 13, marginTop: 10 }}>{parseError}</p>}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}><button className="link" onClick={onClose}>Cancel</button></div>
        </div>
      )}
      {phase === "preview" && parsed && (
        <div>
          <h2 style={{ fontFamily: "Archivo, sans-serif", fontWeight: 900, fontSize: 22, margin: "0 0 6px" }}>Preview your import</h2>
          <p style={{ color: C.dim, fontWeight: 600, fontSize: 13.5, margin: "0 0 14px" }}>
            Found <span style={{ color: C.text, fontWeight: 800 }}>{parsed.books.length}</span> books · <span style={{ color: C.text, fontWeight: 800 }}>{parsed.books.filter(b => b.grShelf === "read").length}</span> on the <em>read</em> shelf · <span style={{ color: C.text, fontWeight: 800 }}>{parsed.books.filter(b => b.rating >= 4).length}</span> rated 4★ or higher.
          </p>
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>
              <input type="checkbox" checked={filterRead} onChange={e => setFilterRead(e.target.checked)} style={{ accentColor: C.red, width: 16, height: 16 }} />
              Only books on the "read" shelf
            </label>
            <div style={{ flex: 1 }} />
            <button className="link" onClick={() => toggleAll(true)}>Select all</button>
            <button className="link" onClick={() => toggleAll(false)}>Clear</button>
          </div>
          <div style={{ maxHeight: 380, overflowY: "auto", border: `1px solid ${C.line}`, borderRadius: 8, background: C.surface }}>
            {visible.length === 0
              ? <div style={{ padding: 20, textAlign: "center", color: C.dim, fontSize: 13.5 }}>No books match.</div>
              : visible.map((b, i) => {
                const k = dedupeKey(b); const isSel = !!selected[k];
                return (
                  <label key={k + i} style={{ display: "flex", gap: 11, padding: "10px 12px", borderBottom: i < visible.length - 1 ? `1px solid ${C.line}` : "none", cursor: "pointer", alignItems: "center", background: isSel ? "rgba(229,9,20,.04)" : "transparent" }}>
                    <input type="checkbox" checked={isSel} onChange={e => setSelected(s => ({ ...s, [k]: e.target.checked }))} style={{ accentColor: C.red, width: 16, height: 16, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                        <span style={{ fontFamily: "Archivo, sans-serif", fontWeight: 800, fontSize: 14 }}>{b.title}</span>
                        <span style={{ color: C.dim, fontWeight: 600, fontSize: 12.5 }}>{b.author}</span>
                      </div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 3, flexWrap: "wrap", fontSize: 11.5, color: C.faint, fontWeight: 700 }}>
                        {b.rating > 0 && <span style={{ color: C.gold }}>{"★".repeat(b.rating)}{"☆".repeat(5 - b.rating)}</span>}
                        <span style={{ textTransform: "uppercase", letterSpacing: .5 }}>{b.grShelf || "—"}</span>
                        {b.genres.length > 0 && <span>{b.genres.join(" · ")}</span>}
                        {b.whyLiked && <span style={{ color: C.dim, fontStyle: "italic", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 280 }}>"{b.whyLiked.slice(0, 80)}{b.whyLiked.length > 80 ? "…" : ""}"</span>}
                      </div>
                    </div>
                  </label>
                );
              })
            }
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "space-between", alignItems: "center", marginTop: 14, flexWrap: "wrap" }}>
            <div style={{ color: C.dim, fontWeight: 700, fontSize: 13 }}>{selectedCount} selected</div>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="link" onClick={() => { setPhase("upload"); setParsed(null); }}>← Use a different file</button>
              <button className="btn-red" onClick={doImport} disabled={!selectedCount}><Check size={16} /> Import {selectedCount} {selectedCount === 1 ? "book" : "books"}</button>
            </div>
          </div>
        </div>
      )}
      {phase === "importing" && (
        <div style={{ padding: "30px 0", textAlign: "center" }}>
          <Loader2 className="spin" size={32} />
          <div style={{ fontFamily: "Archivo, sans-serif", fontWeight: 800, fontSize: 18, marginTop: 12 }}>Importing your library…</div>
          <div style={{ color: C.dim, fontWeight: 600, fontSize: 13, marginTop: 4 }}>Covers and themes will load in the background.</div>
        </div>
      )}
      {phase === "done" && result && (
        <div style={{ padding: "20px 0", textAlign: "center" }}>
          <div style={{ width: 60, height: 60, borderRadius: 999, background: C.green, color: "#fff", display: "grid", placeItems: "center", margin: "0 auto 14px" }}><Check size={32} strokeWidth={3} /></div>
          <h2 style={{ fontFamily: "Archivo, sans-serif", fontWeight: 900, fontSize: 22, margin: "0 0 6px" }}>Import complete</h2>
          <p style={{ color: C.dim, fontWeight: 600, margin: "0 0 16px" }}>
            Added <span style={{ color: C.text, fontWeight: 800 }}>{result.added}</span> {result.added === 1 ? "book" : "books"}
            {result.duplicates > 0 && <> · skipped <span style={{ color: C.text, fontWeight: 800 }}>{result.duplicates}</span> duplicate{result.duplicates === 1 ? "" : "s"}</>}
          </p>
          <button className="btn-red" onClick={onClose}>Done</button>
        </div>
      )}
    </Sheet>
  );
}

/* ============================================================== *
 *  SMART PASTE                                                   *
 * ============================================================== */
function SmartPasteModal({ onClose, onDone }) {
  const [text, setText] = useState(""); const [loading, setLoading] = useState(false); const [err, setErr] = useState("");
  const go = async () => {
    if (!text.trim()) return; setLoading(true); setErr("");
    try { const list = await smartImport(text); if (!list.length) throw new Error(); onDone(list); }
    catch { setErr("Couldn't parse that — try one book per line."); } finally { setLoading(false); }
  };
  return (
    <Sheet onClose={onClose}>
      <h2 style={{ fontFamily: "Archivo, sans-serif", fontWeight: 900, fontSize: 24, margin: "0 0 6px" }}><Wand2 size={20} style={{ verticalAlign: -3, color: C.red }} /> Smart paste</h2>
      <p style={{ color: C.dim, fontWeight: 600, margin: "0 0 14px" }}>Paste your reading however you like — Boox sorts titles, authors, genres, and any feelings you mention.</p>
      <textarea value={text} onChange={e => setText(e.target.value)} rows={7} placeholder={"Loved Beloved by Toni Morrison.\nDune by Frank Herbert — just okay."} style={{ ...inputStyle, resize: "vertical" }} />
      {err && <p style={{ color: C.red, fontWeight: 700, marginTop: 8 }}>{err}</p>}
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 12 }}>
        <button className="link" onClick={onClose}>Cancel</button>
        <button className="btn-red" onClick={go} disabled={loading}>{loading ? <><Loader2 size={15} className="spin" /> Reading…</> : <><Wand2 size={15} /> Sort & add</>}</button>
      </div>
    </Sheet>
  );
}

/* ---------- shared ---------- */
function Sheet({ children, onClose, maxW = 600 }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 80, background: "rgba(0,0,0,.72)", display: "grid", placeItems: "center", padding: 18, overflowY: "auto" }}>
      <div onClick={e => e.stopPropagation()} className="pop" style={{ background: C.bg2, border: `1px solid ${C.line}`, borderRadius: 12, padding: 24, width: "100%", maxWidth: maxW, margin: "auto", position: "relative" }}>
        <button onClick={onClose} style={{ position: "absolute", top: 16, right: 16, width: 32, height: 32, borderRadius: 999, background: C.surface, border: `1px solid ${C.line}`, color: C.text, cursor: "pointer", display: "grid", placeItems: "center" }}><X size={17} /></button>
        {children}
      </div>
    </div>
  );
}
function Lbl({ t, children }) { return <label style={{ display: "block", marginBottom: 12 }}><span style={lbl}>{t}</span>{children}</label>; }
function Empty({ title, sub, children }) {
  return <div style={{ textAlign: "center", padding: "70px 20px" }}>
    <h2 style={{ fontFamily: "Archivo, sans-serif", fontWeight: 900, fontSize: 26, margin: 0 }}>{title}</h2>
    <p style={{ maxWidth: 460, margin: "10px auto 20px", color: C.dim, fontWeight: 600 }}>{sub}</p>
    {children}
  </div>;
}
function Spinner({ text }) {
  return <div style={{ display: "grid", placeItems: "center", height: 400 }}>
    <div style={{ textAlign: "center" }}><Loader2 className="spin" size={34} />{text && <div style={{ marginTop: 12, fontWeight: 700, color: C.dim }}>{text}</div>}</div>
  </div>;
}

/* ---------- fonts + css ---------- */
function FontInjector() {
  useEffect(() => {
    if (!document.getElementById("boox-fonts")) {
      const l = document.createElement("link"); l.id = "boox-fonts"; l.rel = "stylesheet";
      l.href = "https://fonts.googleapis.com/css2?family=Archivo:wght@600;700;800;900&family=Mulish:wght@400;600;700;800&display=swap";
      document.head.appendChild(l);
    }
    if (!document.getElementById("boox-style")) {
      const s = document.createElement("style"); s.id = "boox-style";
      s.textContent = `
        .spin{animation:bsp 1s linear infinite}@keyframes bsp{to{transform:rotate(360deg)}}
        .fade{animation:bfd .4s ease}@keyframes bfd{from{opacity:0}to{opacity:1}}
        .pop{animation:bpp .22s cubic-bezier(.2,.8,.2,1)}@keyframes bpp{from{opacity:0;transform:scale(.97) translateY(8px)}to{opacity:1}}
        .rowwrap{position:relative}
        .rowscroll{display:flex;gap:11px;overflow-x:auto;scroll-behavior:smooth;padding:6px 2px;scrollbar-width:none}
        .rowscroll::-webkit-scrollbar{display:none}
        .poster{cursor:pointer;transition:transform .18s}
        .poster:hover{transform:scale(1.06)}
        .poster-ov{position:absolute;inset:0;display:grid;place-items:center;background:rgba(0,0,0,.35);opacity:0;border-radius:6px;transition:opacity .18s}
        .poster:hover .poster-ov{opacity:1}
        .rowarrow{position:absolute;top:6px;bottom:18px;width:44px;border:none;background:linear-gradient(90deg,#0B0B0Fdd,transparent);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .15s;z-index:3}
        .rowarrow.right{right:0;background:linear-gradient(270deg,#0B0B0Fdd,transparent)}.rowarrow.left{left:0}
        .rowwrap:hover .rowarrow{opacity:1}
        .btn-white,.btn-red,.btn-ghost{font-family:Mulish,sans-serif;font-weight:800;border-radius:6px;padding:11px 18px;cursor:pointer;display:inline-flex;align-items:center;gap:8px;font-size:14.5px;border:none;transition:filter .12s}
        .btn-white{background:#fff;color:#111}.btn-white:hover{filter:brightness(.88)}
        .btn-white:disabled{opacity:.65;cursor:default;pointer-events:none}
        .btn-red{background:#E50914;color:#fff}.btn-red:hover{filter:brightness(1.12)}
        .btn-red:disabled{opacity:.5;cursor:not-allowed;pointer-events:none}
        .btn-ghost{background:rgba(110,110,120,.32);color:#fff;border:1px solid rgba(255,255,255,.1)}.btn-ghost:hover{background:rgba(110,110,120,.52)}
        .btn-white.sm,.btn-ghost.sm{padding:7px 12px;font-size:13px}
        .link{background:none;border:none;color:#A7A7B0;cursor:pointer;font-family:Mulish,sans-serif;font-weight:700;font-size:13px;display:inline-flex;align-items:center;gap:4px}
        .link:hover{color:#fff}
        .ol-result{display:flex;gap:11px;align-items:center;width:100%;padding:9px 11px;background:${C.surface};border:1px solid ${C.line};border-radius:8px;cursor:pointer;color:${C.text};font-family:Mulish,sans-serif;text-align:left;transition:all .12s}
        .ol-result:hover{border-color:${C.text};background:#22222B}
        input,textarea,select{outline:none}
        input:focus,textarea:focus{border-color:#55556a!important}
        ::placeholder{color:#6C6C76;font-weight:600}
        ::selection{background:#E50914;color:#fff}
      `;
      document.head.appendChild(s);
    }
  }, []);
  return null;
}
