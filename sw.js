// ピクニック・ガイスター：ネットが無くても開けるようにする仕組み（サービスワーカー）
// - 同じサイトのファイル（ページ・game.js・styles.css・駒の画像）：ネットがあれば最新を取りに行き、
//   無い・遅いときは前回の控えを出す。?v=8 のような番号が変わっても控えで代わりが効く
// - 記録（localStorage）には触らない
const CACHE = 'obake-v1';
const PRECACHE = ['./', 'styles.css', 'game.js', 'assets/piece-a.png', 'assets/piece-b.png'];
const WAIT_MS = 3000;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function fromNetwork(req, key) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), WAIT_MS);
    fetch(req, { cache: 'no-cache' }).then((res) => {
      clearTimeout(timer);
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(key, copy));
      }
      resolve(res);
    }, (err) => { clearTimeout(timer); reject(err); });
  });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const key = req.mode === 'navigate' ? './' : url.pathname;   // 番号（?v=）を外して控える
  e.respondWith(
    fromNetwork(req, key).catch(() =>
      caches.match(key).then((hit) => hit || caches.match(req, { ignoreSearch: true }))
        .then((hit) => hit || (req.mode === 'navigate'
          ? new Response('<meta charset="utf-8"><p style="font:16px sans-serif;padding:24px">一度ネットにつないで開いてください。</p>',
              { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
          : Response.error()))
    )
  );
});
