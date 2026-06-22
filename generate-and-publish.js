// generate-and-publish.js
// Picks the next pending topic, drafts an article with Claude, inserts
// affiliate links, and commits it to your GitHub repo as articles/<slug>.html
// Netlify auto-deploys on every push — no manual steps needed.
//
// Required environment variables (set as GitHub Actions secrets):
//   ANTHROPIC_API_KEY     - your Anthropic API key
//   GH_TOKEN              - GitHub personal access token (repo write scope)
//   GH_REPO               - your repo in "username/repo-name" format
//                           e.g. "snowman/north-pack-co"
//   AMAZON_ASSOCIATE_TAG  - your Amazon Associates tracking ID

import fs from "fs";

const TOPICS_PATH  = new URL("./topics.json", import.meta.url);
const LINKS_PATH   = new URL("./links.json",  import.meta.url);
const ARTICLES_DIR = "articles";

function loadJSON(url) {
  return JSON.parse(fs.readFileSync(url, "utf-8"));
}

function saveJSON(url, data) {
  fs.writeFileSync(url, JSON.stringify(data, null, 2) + "\n");
}

function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

async function draftArticle(topic) {
  const prompt = `Write an affiliate-style buying guide article for an outdoor gear blog.

Title: "${topic.title}"
Category: ${topic.cluster}

Requirements:
- Start with a one-sentence FTC affiliate disclosure (e.g. "This post contains affiliate links; we may earn a commission at no extra cost to you.")
- 1100-1400 words, Markdown format
- Use H2 subheadings for each product or sub-topic
- For every specific product you recommend, write its name as a placeholder in this exact format: [[LINK:Exact Product Name]] immediately after the product name the first time it is mentioned in each section
- Include a short comparison table near the top (product, best for, price range)
- Write in a helpful, direct tone — no fluff intro paragraphs
- End with a short buying-advice summary, not a generic conclusion

Only output the article in Markdown. No preamble, no commentary.`;

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
  // Minimal Markdown → HTML (headings, bold, links, paragraphs, tables, lists)
  return md
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm,  "<h2>$1</h2>")
    .replace(/^# (.+)$/gm,   "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g,    "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/^\| (.+) \|$/gm, (row) => {
      const cells = row.split("|").filter(Boolean).map((c) => `<td>${c.trim()}</td>`).join("");
      return `<tr>${cells}</tr>`;
    })
    .replace(/(<tr>.*<\/tr>\n?)+/gs, (t) => `<table>${t}</table>`)
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>\n?)+/gs, (l) => `<ul>${l}</ul>`)
    .replace(/\n{2,}/g, "</p><p>")
    .replace(/^(?!<[hHtTuUoOlL])(.+)$/gm, (line) => (line.trim() ? line : ""))
    .replace(/^(.+)$/gm, (line) => (line.startsWith("<") ? line : `<p>${line}</p>`));
}

function applyAffiliateLinks(markdown, links) {
  const tag = process.env.AMAZON_ASSOCIATE_TAG || "";
  return markdown.replace(/\[\[LINK:(.*?)\]\]/g, (_, name) => {
    const key = name.trim().toLowerCase();
    const url =
      links[key] ||
      `https://www.amazon.com/s?k=${encodeURIComponent(name.trim())}&tag=${tag}`;
    return `[${name.trim()}](${url})`;
  });
}

function wrapInPage(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title} | North Pack Co</title>
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <header>
    <a href="/" class="logo">North Pack Co</a>
    <nav>
      <a href="/articles/">All Gear Guides</a>
    </nav>
  </header>
  <main class="article">
    <h1>${title}</h1>
    ${bodyHtml}
  </main>
  <footer>
    <p>&copy; ${new Date().getFullYear()} North Pack Co. All rights reserved.</p>
  </footer>
</body>
</html>`;
}

async function commitToGitHub(slug, html, title) {
  const path    = `${ARTICLES_DIR}/${slug}.html`;
  const repo    = process.env.GH_REPO;
  const token   = process.env.GH_TOKEN;
  const apiBase = `https://api.github.com/repos/${repo}/contents/${path}`;

  // Check if file already exists (needed to get its SHA for updates)
  let sha;
  const check = await fetch(apiBase, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  if (check.ok) {
    const existing = await check.json();
    sha = existing.sha;
  }

  const body = {
    message: `Add article: ${title}`,
    content: Buffer.from(html).toString("base64"),
    ...(sha ? { sha } : {}),
  };

  const res = await fetch(apiBase, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`GitHub commit error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.content.html_url;
}

async function main() {
  const topics = loadJSON(TOPICS_PATH);
  const links  = loadJSON(LINKS_PATH);

  const next = topics.find((t) => t.status === "pending");
  if (!next) {
    console.log("No pending topics. Add more rows to topics.json.");
    return;
  }

  console.log(`Drafting: "${next.title}"`);
  const markdown = await draftArticle(next);
  const linked   = applyAffiliateLinks(markdown, links);
  const bodyHtml = markdownToHtml(linked);
  const fullPage = wrapInPage(next.title, bodyHtml);
  const slug     = slugify(next.title);

  console.log(`Committing to GitHub as articles/${slug}.html ...`);
  const url = await commitToGitHub(slug, fullPage, next.title);

  next.status      = "published";
  next.publishedAt = new Date().toISOString();
  next.slug        = slug;
  saveJSON(TOPICS_PATH, topics);

  console.log(`Done! Live at: https://northpackco.com/articles/${slug}.html`);
  console.log(`GitHub file: ${url}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
