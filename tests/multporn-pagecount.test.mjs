import assert from 'node:assert/strict';

const source = await Deno.readTextFile(new URL('../multporn-pagecount.user.js', import.meta.url));

function loadApi(settings = {}) {
  const previous = new Map();
  const names = ['localStorage', 'location', 'document', 'fetch', 'DOMParser', '__MPR_PAGECOUNT_TEST__'];
  for (const name of names) previous.set(name, globalThis[name]);

  const setGlobal = (name, value) => Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });

  const values = new Map();
  const requests = [];
  setGlobal('localStorage', {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, String(value)); },
  });
  if (Object.keys(settings).length) values.set('mpr:settings', JSON.stringify(settings));
  setGlobal('location', {
    href: 'https://multporn.net/category/furry?rule34=2&page=0%2C1',
    origin: 'https://multporn.net',
    pathname: '/category/furry',
    search: '?rule34=2&page=0%2C1',
  });
  setGlobal('document', {
    querySelector: () => null,
    querySelectorAll: () => [],
  });
  setGlobal('fetch', async (url) => {
    requests.push(String(url));
    return { ok: true, status: 200, text: async () => '<html></html>' };
  });
  setGlobal('DOMParser', class {
    parseFromString() {
      return {
        querySelector: () => ({ querySelectorAll: () => Array.from({ length: 3 }) }),
        querySelectorAll: () => Array.from({ length: 3 }),
      };
    }
  });
  setGlobal('__MPR_PAGECOUNT_TEST__', {});

  new Function(source)();

  return {
    api: globalThis.__MPR_PAGECOUNT_TEST__.api,
    requests,
    values,
    restore() {
      for (const name of names) {
        const value = previous.get(name);
        if (value === undefined) delete globalThis[name];
        else setGlobal(name, value);
      }
    },
  };
}

Deno.test('normalizes listing items before fetching page counts', async () => {
  const loaded = loadApi();
  try {
    const operation = { stopped: false, aborts: new Set() };
    const result = await loaded.api.countPages([
      { url: '/comics/alpha' },
      { url: '/hentai_manga/beta' },
    ], () => {}, operation);

    assert.equal(result.failed, 0);
    assert.deepEqual(loaded.requests.sort(), ['/comics/alpha', '/hentai_manga/beta']);
    assert.equal(JSON.parse(loaded.values.get('mpr:counts'))['/comics/alpha'].p, 3);
    assert.deepEqual(loaded.api.normalizeUrls([{ url: '/comics/a' }, '/mp123']), ['/comics/a', '/mp123']);
  } finally {
    loaded.restore();
  }
});

Deno.test('keeps counts fetched in the current run usable when cache days is zero', async () => {
  const loaded = loadApi({ cacheDays: 0 });
  try {
    const operation = { stopped: false, aborts: new Set() };
    await loaded.api.countPages([{ url: '/comics/current-run' }], () => {}, operation);
    const secondRun = await loaded.api.countPages(['/comics/current-run'], () => {}, operation);

    assert.equal(secondRun.total, 0);
  } finally {
    loaded.restore();
  }
});

Deno.test('handles offset pagination and canonical listing cache keys', () => {
  const loaded = loadApi();
  try {
    const links = [
      { getAttribute: () => '/category/furry?rule34=2&page=0%2C1' },
      { getAttribute: () => '/category/furry?rule34=2&page=0%2C245' },
    ];
    const format = loaded.api.learnPagerFormat({ querySelectorAll: () => links });

    assert.deepEqual(format, { value: '0,245', maxPage: 245 });
    assert.equal(loaded.api.currentPageNumber(format), 1);
    assert.equal(
      loaded.api.buildPageUrl(0, format),
      '/category/furry?rule34=2&page=0%2C0',
    );
    assert.equal(loaded.api.listingSignature(), '/category/furry?rule34=2');
  } finally {
    loaded.restore();
  }
});

Deno.test('extracts the visible listing title and ignores unrelated link fields', () => {
  const loaded = loadApi();
  try {
    const image = { currentSrc: 'https://multporn.net/cover.jpg', src: '', getAttribute: () => '' };
    const title = { textContent: ' A Real Comic ' };
    const views = { textContent: 'Total views: 12,345' };
    const wrapper = {
      querySelector: (selector) => {
        if (selector.includes('.views-field-title')) return title;
        if (selector.includes('views-field-field-preview')) return image;
        if (selector.includes('views-field-totalcount')) return views;
        return null;
      },
    };
    const link = {
      getAttribute: () => '/comics/real_comic?rule34=2',
      closest: () => wrapper,
      parentElement: wrapper,
      textContent: 'fallback',
    };
    const items = loaded.api.extractPageItems({ querySelectorAll: () => [link] });

    assert.deepEqual(items, [{
      url: '/comics/real_comic',
      title: 'A Real Comic',
      img: 'https://multporn.net/cover.jpg',
      views: 12345,
    }]);
  } finally {
    loaded.restore();
  }
});
