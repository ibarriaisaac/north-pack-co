import fs from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOPICS_PATH = new URL("./topics.json", import.meta.url);
const LINKS_PATH  = new URL("./links.json",  import.meta.url);
const ARTICLES_DIR = "articles";

function loadJSON(url) { return JSON.parse(fs.readFileSync(url, "utf-8")); }
function saveJSON(url, data) { fs.writeFileSync(url, JSON.stringify(data, null, 2) + "\n"); }

function slugify(title) {
  return title.toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-");
}

function formatDate() {
  return new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

async function draftArticle(topic) {
  const prompt = `Write an affiliate buying guide for an outdoor gear blog.

Title: "${topic.title}"
Category: ${topic.cluster}

Requirements:
- Do NOT include an FTC disclosure line — the template handles it
- 1100-1400 words, Markdown format
- Use H2 subheadings for each product or section (these become the table of contents)
- For every specific product you recommend, write its name as: [[LINK:Exact Product Name]] immediately after the product name the first time it appears in each section
- Include a short comparison table near the top (columns: Product | Best For | Price Range)
- Write in a helpful, direct tone — no fluff intro paragraphs
- End with a short buying-advice summary paragraph, not a generic conclusion
- Output only the article body in Markdown, no preamble or commentary`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) throw new Error(`Anthropic error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const block = data.content.find((b) => b.type === "text");
  if (!block) throw new Error("No text block returned from Anthropic");
  return block.text;
}

function markdownToHtml(md) {
  return md
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^# (.+)$/gm, "<h2>$1</h2>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener sponsored">$1</a>')
    .replace(/^\|(.+)\|$/gm, (row) => {
      const cells = row.split("|").filter(c => c.trim()).map(c => `<td>${c.trim()}</td>`).join("");
      return `<tr>${cells}</tr>`;
    })
    .replace(/^:?-+:?\|/gm, "")
    .replace(/(<tr>[\s\S]*?<\/tr>)/g, (m, _, offset, str) => {
      const before = str.slice(0, offset);
      const isFirst = (before.match(/<tr>/g) || []).length === 0;
      if (isFirst) return m.replace(/<td>/g, "<th>").replace(/<\/td>/g, "</th>");
      return m;
    })
    .replace(/(<tr>[\s\S]*?<\/tr>\n?)+/g, t => `<table>${t}</table>`)
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>[\s\S]*?<\/li>\n?)+/g, l => `<ul>${l}</ul>`)
    .replace(/^(\d+)\. (.+)$/gm, "<li>$2</li>")
    .split(/\n{2,}/)
    .map(block => {
      if (block.startsWith("<")) return block;
      return `<p>${block.trim()}</p>`;
    })
    .join("\n");
}

function applyAffiliateLinks(markdown, links) {
  const tag = process.env.AMAZON_ASSOCIATE_TAG || "";
  return markdown.replace(/\[\[LINK:(.*?)\]\]/g, (_, name) => {
    const key = name.trim().toLowerCase();
    const url = links[key] || `https://www.amazon.com/s?k=${encodeURIComponent(name.trim())}&tag=${tag}`;
    return `[${name.trim()}](${url})`;
  });
}

function buildPage(topic, bodyHtml, slug) {
  const template = fs.readFileSync(path.join(__dirname, "article-template.html"), "utf-8");
  const description = `Best ${topic.cluster.toLowerCase()} picks for 2026. Expert-reviewed and affiliate-linked buying guide from North Pack Co.`;

  return template
    .replace(/{{TITLE}}/g, topic.title)
    .replace(/{{SLUG}}/g, slug)
    .replace(/{{CLUSTER}}/g, topic.cluster)
    .replace(/{{DATE}}/g, formatDate())
    .replace(/{{META_DESCRIPTION}}/g, description)
    .replace(/{{BODY}}/g, `
      <div class="affiliate-disclosure">
        This guide contains affiliate links. If you buy through them, we may earn a small commission at no extra cost to you. We only recommend gear we'd actually use.
      </div>
      ${bodyHtml}
    `);
}

async function commitToGitHub(slug, html, title) {
  const filePath = `${ARTICLES_DIR}/${slug}.html`;
  const repo  = process.env.GH_REPO;
  const token = process.env.GH_TOKEN;
  const api   = `https://api.github.com/repos/${repo}/contents/${filePath}`;

  let sha;
  try {
    const check = await fetch(api, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } });
    if (check.ok) { const existing = await check.json(); sha = existing.sha; }
  } catch (_) {}

  const res = await fetch(api, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
    body: JSON.stringify({ message: `Add article: ${title}`, content: Buffer.from(html).toString("base64"), ...(sha ? { sha } : {}) }),
  });

  if (!res.ok) throw new Error(`GitHub commit error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.content.html_url;
}

async function main() {
  const topics = loadJSON(TOPICS_PATH);
  const links  = loadJSON(LINKS_PATH);

  const next = topics.find(t => t.status === "pending");
  if (!next) { console.log("No pending topics. Add more to topics.json."); return; }

  console.log(`Drafting: "${next.title}"`);
  const markdown = await draftArticle(next);
  const linked   = applyAffiliateLinks(markdown, links);
  const bodyHtml = markdownToHtml(linked);
  const slug     = slugify(next.title);
  const fullPage = buildPage(next, bodyHtml, slug);

  console.log(`Committing to GitHub as ${ARTICLES_DIR}/${slug}.html ...`);
  const url = await commitToGitHub(slug, fullPage, next.title);

  next.status      = "published";
  next.publishedAt = new Date().toISOString();
  next.slug        = slug;
  saveJSON(TOPICS_PATH, topics);

  console.log(`Done! Live at: https://northpackco.com/articles/${slug}.html`);
  console.log(`GitHub: ${url}`);
}

main().catch(err => { console.error(err); process.exit(1); });
