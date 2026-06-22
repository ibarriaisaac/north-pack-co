# North Pack Co — Automated Article Pipeline

Twice a week, this picks the next topic from `topics.json`, has Claude draft
a full buying guide, swaps in affiliate links, and commits it as a static HTML
file to your GitHub repo. Netlify auto-deploys it live within seconds.

---

## Setup (do this once)

### 1. Add this folder to your north-pack-co GitHub repo
Copy everything here into your existing `north-pack-co` GitHub repo and push.

### 2. Get a GitHub Personal Access Token
- GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
- Click **Generate new token (classic)**
- Give it a name like "north-pack-bot"
- Check the **repo** scope (full repo access)
- Click Generate and copy the token

### 3. Get your Anthropic API key
- console.anthropic.com → API Keys → Create Key
- Copy it

### 4. Add secrets to your GitHub repo
Go to your repo → Settings → Secrets and variables → Actions → New repository secret.
Add these four:

| Secret name          | Value                                      |
|----------------------|--------------------------------------------|
| `ANTHROPIC_API_KEY`  | Your Anthropic API key                     |
| `GH_TOKEN`           | GitHub personal access token from step 2  |
| `GH_REPO`            | `yourusername/north-pack-co`               |
| `AMAZON_ASSOCIATE_TAG` | Your Amazon Associates tracking tag      |

### 5. Add real affiliate links (optional but recommended)
Open `links.json` and add entries like:
```json
{
  "big agnes copper spur hv ul2": "https://www.backcountry.com/big-agnes-copper-spur?affiliate=yourID",
  "msr hubba hubba nx 2": "https://www.amazon.com/dp/B07XYZ?tag=yourtag-20"
}
```
Anything the AI mentions that isn't in this file falls back to an Amazon search
link using your `AMAZON_ASSOCIATE_TAG`.

### 6. Done — it runs itself
The workflow in `.github/workflows/publish.yml` fires every Monday and Thursday
at 7am PT. You can also trigger it manually from the **Actions** tab in GitHub
(click "Publish gear article" → "Run workflow").

Each run commits one new `articles/<slug>.html` file to your repo, and Netlify
deploys it live automatically.

---

## Adding more topics
Once the 24 topics in `topics.json` are exhausted, add new rows in the same format:
```json
{ "id": 25, "cluster": "Tents & Shelter", "title": "Best Tents for Solo Hikers", "type": "supporting", "status": "pending" }
```

## Article index page
The articles live at `northpackco.com/articles/<slug>.html` but there's no
auto-generated index page yet. A simple `articles/index.html` that lists all
published articles would help SEO — you can build that manually or ask Claude
to generate one from the `topics.json` published entries.
