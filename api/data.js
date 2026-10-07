// Stores all progress as one JSON file in the GitHub repository, on its own branch so that
// saving a workout never triggers a redeploy of the site.
//
// Needs two environment variables set in Vercel:
//   GITHUB_TOKEN  - a fine-grained token with Contents read/write on this one repository
//   APP_PASSCODE  - the passcode typed into the app's Backup tab
const crypto = require('crypto');

const REPO = process.env.GITHUB_REPO || 'dcmlobban-png/workout-tracker';
const BRANCH = process.env.DATA_BRANCH || 'data';
const FILE = 'data/progress.json';

async function gh(path, method, body) {
    const r = await fetch('https://api.github.com/repos/' + REPO + path, {
        method: method || 'GET',
        headers: {
            Authorization: 'Bearer ' + process.env.GITHUB_TOKEN,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'workout-tracker',
            ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        body: body ? JSON.stringify(body) : undefined
    });
    const text = await r.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (e) {}
    return { status: r.status, json };
}

async function readFile() {
    const r = await gh('/contents/' + FILE + '?ref=' + encodeURIComponent(BRANCH));
    if (r.status === 404) return { data: null, sha: null };
    if (r.status !== 200 || !r.json) throw new Error('GitHub read failed (' + r.status + ')');
    let b64 = r.json.content;
    if (!b64) {
        // Files over 1 MB come back without content; the blob endpoint has it.
        const blob = await gh('/git/blobs/' + r.json.sha);
        if (blob.status !== 200) throw new Error('GitHub read failed (' + blob.status + ')');
        b64 = blob.json.content;
    }
    return { data: JSON.parse(Buffer.from(b64, 'base64').toString('utf8')), sha: r.json.sha };
}

async function ensureBranch() {
    const have = await gh('/git/ref/heads/' + BRANCH);
    if (have.status === 200) return;
    const repo = await gh('');
    if (repo.status !== 200) throw new Error('GitHub repository not reachable (' + repo.status + ')');
    const base = await gh('/git/ref/heads/' + repo.json.default_branch);
    if (base.status !== 200) throw new Error('GitHub branch lookup failed (' + base.status + ')');
    const made = await gh('/git/refs', 'POST', { ref: 'refs/heads/' + BRANCH, sha: base.json.object.sha });
    if (made.status !== 201 && made.status !== 422) throw new Error('GitHub branch create failed (' + made.status + ')');
}

// Newest copy of each day wins; stored data wins a tie. Same rule as the page uses.
function merge(stored, incoming) {
    const logs = Object.assign({}, stored.logs);
    for (const d in (incoming.logs || {})) if (!logs[d] || (incoming.logs[d].u || 0) > (logs[d].u || 0)) logs[d] = incoming.logs[d];
    const pick = (x, y) => (y && (y.u || 0) > ((x && x.u) || 0)) ? y : (x || y);
    return { logs, plan: pick(stored.plan, incoming.plan), settings: pick(stored.settings, incoming.settings) };
}

function samePasscode(a, b) {
    const h = x => crypto.createHash('sha256').update(String(x || '')).digest();
    return crypto.timingSafeEqual(h(a), h(b));
}

const isObj = x => x && typeof x === 'object' && !Array.isArray(x);

module.exports = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
        // Names only, never values: enough to tell which setting the deployment can't see.
        const missing = ['GITHUB_TOKEN', 'APP_PASSCODE'].filter(k => !process.env[k]);
        if (missing.length) return res.status(503).json({ error: 'not-configured', missing, environment: process.env.VERCEL_ENV || 'unknown' });
        if (!samePasscode(req.headers['x-passcode'], process.env.APP_PASSCODE)) return res.status(401).json({ error: 'bad-passcode' });

        if (req.method === 'GET') {
            const cur = await readFile();
            return res.status(200).json({ data: cur.data || { logs: {} } });
        }
        if (req.method !== 'PUT') return res.status(405).json({ error: 'method-not-allowed' });

        let body = req.body;
        if (typeof body === 'string') body = JSON.parse(body);
        if (!isObj(body) || !isObj(body.logs)) return res.status(400).json({ error: 'bad-request' });
        const incoming = { logs: body.logs, plan: isObj(body.plan) ? body.plan : null, settings: isObj(body.settings) ? body.settings : null };

        for (let attempt = 0; attempt < 3; attempt++) {
            const cur = await readFile();
            const merged = merge(cur.data || { logs: {} }, incoming);
            const text = JSON.stringify(merged, null, 1);
            if (cur.data && JSON.stringify(cur.data, null, 1) === text) return res.status(200).json({ data: merged, saved: false });
            if (!cur.sha) await ensureBranch();
            const put = await gh('/contents/' + FILE, 'PUT', {
                message: 'Progress ' + new Date().toISOString().slice(0, 16).replace('T', ' '),
                content: Buffer.from(text, 'utf8').toString('base64'),
                branch: BRANCH,
                ...(cur.sha ? { sha: cur.sha } : {})
            });
            if (put.status === 200 || put.status === 201) return res.status(200).json({ data: merged, saved: true });
            // 409/422 here means another device saved in between: read again and retry.
            if (put.status !== 409 && put.status !== 422) throw new Error('GitHub write failed (' + put.status + ')');
        }
        throw new Error('GitHub write kept conflicting');
    } catch (e) {
        return res.status(502).json({ error: String((e && e.message) || e) });
    }
};
