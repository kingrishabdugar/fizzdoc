// Tells Bing (and the other IndexNow search engines: Yandex, Seznam, Naver) about every page at once,
// instead of 100 a day by hand in Bing Webmaster Tools. The key file public/0fc9a74c195d2a399b6dceb4f429a1f0.txt proves the site is ours.
//
// Run after a deploy that adds or changes pages:  node scripts/indexnow.mjs
const KEY = '0fc9a74c195d2a399b6dceb4f429a1f0';
const HOST = 'fizzdoc.com';

const sitemap = await (await fetch(`https://${HOST}/sitemap.xml`)).text();
const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
// One request takes up to 10,000 URLs.
for (let i = 0; i < urls.length; i += 10_000) {
  const response = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: HOST, key: KEY, keyLocation: `https://${HOST}/${KEY}.txt`, urlList: urls.slice(i, i + 10_000) }),
  });
  // 200 or 202 means accepted; 403 means the key file isn't live yet.
  console.log(`${urls.slice(i, i + 10_000).length} URLs: ${response.status} ${response.statusText}`);
}
