/* LIBRE reader */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  // ---------- 保存 ----------
  const KEY = 'libre_v1';
  const store = {
    load() {
      try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
    },
    save(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) {} }
  };
  const state = Object.assign({
    pos: null,            // {c, s, l} 章・場面・行
    read: [],             // 読み終えた章番号
    cg: [],               // 見た一枚絵
    settings: { size: 'm', speed: 'normal', chara: 'on' }
  }, store.load());
  const persist = () => store.save({ pos: state.pos, read: state.read, cg: state.cg, settings: state.settings });

  // ---------- 名前 → 立ち絵 ----------
  const NAMES = {
    yohei: ['耀平', '金井'], mia: ['美愛', '白峰'], minato: ['湊', '柊'], hayate: ['颯', '日向'],
    koharu: ['小春'], genichiro: ['じいちゃん', '源一郎', '老人'], okochi: ['大河内'], saeki: ['佐伯'],
    kurose: ['黒瀬'], ren: ['鷹宮', '蓮'], kiryu: ['桐生'], lucia: ['ルシア'], diego: ['ディエゴ'],
    yuzuha: ['柚葉', '桜庭'], amagi: ['天城'], kujo: ['九条'], carmen: ['カルメン'], mizuno: ['水野'], nagao: ['長尾'],
    kuga: ['久我'], kazama: ['風間'], asahina: ['朝比奈'], asakura: ['朝倉'], shishido: ['獅子堂'], tojo: ['東條'], kamiya: ['神谷'], mateo: ['マテオ'], kaio: ['カイオ']
  };
  const who = file => file.split('_')[0];

  let DATA = null;
  const cur = { c: 0, s: 0, l: 0 };
  let typing = null, fullText = '', busy = false, uiHidden = false, prevView = 'title';
  let curBg = '', curCg = '', logLines = [];

  // ---------- 画面切り替え ----------
  function show(name) {
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'v-' + name));
    if (name === 'chapters') renderChapters();
    if (name === 'gallery') renderGallery();
    if (name === 'settings') renderSettings();
    if (name === 'title') $('#btn-continue').disabled = !state.pos;
  }
  const closeSheets = () => $$('.sheet').forEach(s => s.classList.remove('open'));

  // ---------- 設定 ----------
  function applySettings() {
    const st = state.settings;
    document.body.classList.remove('size-s', 'size-m', 'size-l');
    document.body.classList.add('size-' + st.size);
    document.body.classList.toggle('chara-off', st.chara === 'off');
  }
  function renderSettings() {
    $$('.seg').forEach(seg => {
      const k = seg.dataset.key;
      $$('button', seg).forEach(b => b.classList.toggle('on', state.settings[k] === b.dataset.v));
    });
  }
  const SPEED = { slow: 55, normal: 30, fast: 12, instant: 0 };

  // ---------- 章リスト ----------
  function renderChapters() {
    const ol = $('#chapter-list');
    ol.innerHTML = '';
    DATA.chapters.forEach((ch, i) => {
      const li = document.createElement('li');
      const now = state.pos && state.pos.c === i;
      const done = state.read.includes(i);
      li.innerHTML = `<button><span class="no">${ch.no}</span><span class="name">${ch.name}</span>${
        now ? '<span class="mark now">読書中</span>' : done ? '<span class="mark">既読</span>' : ''}</button>`;
      li.firstChild.onclick = () => startAt(i, 0, 0, true);
      if (i === 0 || DATA.chapters[i - 1].part !== ch.part) {
        const h = document.createElement('li');
        h.className = 'part-head';
        h.textContent = DATA.parts[ch.part];
        ol.appendChild(h);
      }
      ol.appendChild(li);
    });
  }

  // ---------- ギャラリー ----------
  function allCgs() {
    const list = [];
    DATA.chapters.forEach(ch => ch.scenes.forEach(sc => sc.lines.forEach(l => { if (l.cg && !list.includes(l.cg)) list.push(l.cg); })));
    return list;
  }
  function renderGallery() {
    const g = $('#gallery-grid'), list = allCgs();
    g.innerHTML = '';
    list.forEach(name => {
      const d = document.createElement('div');
      d.className = 'cell';
      if (state.cg.includes(name)) {
        d.innerHTML = `<img loading="lazy" src="cg_${name}.webp" alt="">`;
        d.onclick = () => { $('#viewer-img').src = `cg_${name}.webp`; $('#viewer').classList.add('open'); };
      } else d.textContent = '？';
      g.appendChild(d);
    });
    $('#gallery-count').textContent = `${list.filter(n => state.cg.includes(n)).length} / ${list.length}`;
  }

  // ---------- 読む ----------
  const scene = () => DATA.chapters[cur.c].scenes[cur.s];
  const line = () => scene().lines[cur.l];

  function setBg(name) {
    if (name === curBg) return;
    curBg = name;
    const a = $('#bg-a'), b = $('#bg-b');
    const front = a.classList.contains('show') ? a : b, back = front === a ? b : a;
    back.onload = () => { back.classList.add('show'); front.classList.remove('show'); };
    back.src = `bg_${name}.webp`;
  }

  function setChara(list) {
    const layer = $('#chara-layer');
    const keep = new Set(list);
    $$('img', layer).forEach(img => {
      if (!keep.has(img.dataset.f)) { img.classList.remove('show'); setTimeout(() => img.remove(), 450); img.dataset.f = '_gone'; }
    });
    const pos = { 1: [50], 2: [29, 71], 3: [20, 50, 80] }[list.length] || [];
    list.forEach((f, i) => {
      let img = $$('img', layer).find(x => x.dataset.f === f);
      if (!img) {
        img = new Image();
        img.dataset.f = f;
        img.src = `ch_${f}.webp`;
        img.style.left = pos[i] + '%';
        layer.appendChild(img);
        requestAnimationFrame(() => requestAnimationFrame(() => img.classList.add('show')));
      } else img.style.left = pos[i] + '%';
    });
  }

  function highlight(text) {
    const imgs = $$('#chara-layer img').filter(i => i.dataset.f !== '_gone');
    const hit = imgs.filter(img => (NAMES[who(img.dataset.f)] || []).some(n => text.includes(n)));
    imgs.forEach(img => img.classList.toggle('dim', hit.length > 0 && !hit.includes(img)));
  }

  function setCg(name) {
    const layer = $('#cg-layer');
    if (!name) { layer.classList.remove('show'); curCg = ''; return; }
    if (name === curCg) return;
    curCg = name;
    const img = $('#cg-img');
    img.onload = () => { img.classList.toggle('fit', img.naturalWidth / img.naturalHeight > 0.75); layer.classList.add('show'); };
    img.src = `cg_${name}.webp`;
    if (!state.cg.includes(name)) { state.cg.push(name); persist(); }
  }

  function preload() {
    // 次の場面の背景と、この場面の一枚絵を先読み
    const ch = DATA.chapters[cur.c];
    const next = ch.scenes[cur.s + 1] || (DATA.chapters[cur.c + 1] || {}).scenes?.[0];
    if (next) new Image().src = `bg_${next.bg}.webp`;
    scene().lines.forEach(l => { if (l.cg) new Image().src = `cg_${l.cg}.webp`; });
  }

  function enterScene() {
    const sc = scene();
    setBg(sc.bg);
    setChara(sc.chara);
    // 場面の途中から再開したときは、それまでに出た一枚絵を出す
    let cg = '';
    for (let i = 0; i <= cur.l; i++) if (sc.lines[i] && sc.lines[i].cg) cg = sc.lines[i].cg;
    setCg(cg);
    preload();
  }

  function typeLine() {
    const ln = line();
    if (ln.cg) setCg(ln.cg);
    fullText = ln.t;
    const el = $('#text');
    el.classList.toggle('speech', fullText.startsWith('「'));
    $('#next-mark').classList.remove('on');
    highlight(fullText);
    logLines.push(fullText);
    if (logLines.length > 300) logLines.shift();
    const ms = SPEED[state.settings.speed];
    clearInterval(typing);
    $('#textbox').scrollTop = 0;
    if (!ms) { el.textContent = fullText; typing = null; $('#next-mark').classList.add('on'); return; }
    let i = 0;
    el.textContent = '';
    typing = setInterval(() => {
      i += 1;
      el.textContent = fullText.slice(0, i);
      if (i >= fullText.length) { clearInterval(typing); typing = null; $('#next-mark').classList.add('on'); }
    }, ms);
    state.pos = { c: cur.c, s: cur.s, l: cur.l };
    persist();
  }

  function chapterCard(cb) {
    const ch = DATA.chapters[cur.c];
    $('#read-chapter').textContent = `${ch.no}　${ch.name}`;
    $('.cc-no').textContent = ch.no;
    $('.cc-name').textContent = ch.name;
    const card = $('#chapter-card');
    busy = true;
    card.classList.add('show');
    setTimeout(() => {
      cb();
      setTimeout(() => { card.classList.remove('show'); setTimeout(() => { busy = false; }, 500); }, 1100);
    }, 400);
  }

  function startAt(c, s, l, withCard) {
    closeSheets();
    $('#end-card').classList.remove('show');
    Object.assign(cur, { c, s, l });
    logLines = [];
    curBg = ''; curCg = '';
    show('read');
    const go = () => { enterScene(); typeLine(); };
    if (withCard) chapterCard(go);
    else { $('#read-chapter').textContent = `${DATA.chapters[c].no}　${DATA.chapters[c].name}`; go(); }
  }

  function advance() {
    if (busy) return;
    if (typing) { clearInterval(typing); typing = null; $('#text').textContent = fullText; $('#next-mark').classList.add('on'); return; }
    const sc = scene();
    if (cur.l + 1 < sc.lines.length) { cur.l++; typeLine(); return; }
    if (cur.s + 1 < DATA.chapters[cur.c].scenes.length) {
      cur.s++; cur.l = 0;
      // 場面転換：一枚絵を下げてから次へ
      setCg('');
      enterScene(); typeLine();
      return;
    }
    // 章の終わり
    if (!state.read.includes(cur.c)) state.read.push(cur.c);
    const last = cur.c + 1 >= DATA.chapters.length;
    const partEnd = last || DATA.chapters[cur.c + 1].part !== DATA.chapters[cur.c].part;
    state.pos = last ? null : { c: cur.c + 1, s: 0, l: 0 };
    persist();
    const fullName = DATA.parts[DATA.chapters[cur.c].part];
    const hen = (fullName.match(/^(中学|高校)\d年編/) || [''])[0];
    const partName = fullName.replace(/^(中学|高校)\d年編\s*/, '');
    const nextHen = last ? '' : (DATA.parts[DATA.chapters[cur.c + 1].part].match(/^(中学|高校)\d年編/) || [''])[0];
    const henEnd = partEnd && hen && !last && hen !== nextHen;
    $('.ec-title').textContent = henEnd ? `${partName}　完　／　${hen}　完` : partEnd ? `${partName}　完` : `${DATA.chapters[cur.c].no}　おわり`;
    $('#btn-next-ch').textContent = partEnd && !last ? '次の部へ' : '次の章へ';
    $('#btn-next-ch').style.display = last ? 'none' : '';
    $('#end-card').classList.add('show');
  }

  // ---------- 操作 ----------
  function bind() {
    document.addEventListener('click', e => {
      const a = e.target.closest('[data-act]');
      if (a) {
        const act = a.dataset.act;
        closeSheets();
        if (act === 'start') startAt(0, 0, 0, true);
        else if (act === 'continue' && state.pos) startAt(state.pos.c, state.pos.s, state.pos.l, true);
        else if (act === 'settings') { prevView = 'title'; show('settings'); }
        else if (act === 'settings-from-read') { prevView = 'read'; show('settings'); }
        else if (act === 'back-settings') { applySettings(); if (prevView === 'read') { show('read'); } else show('title'); }
        else if (['title', 'chapters', 'gallery'].includes(act)) show(act);
        return;
      }
      const c = e.target.closest('[data-close]');
      if (c) { $('#' + c.dataset.close).classList.remove('open'); }
    });

    $('#v-read').addEventListener('click', e => {
      if (e.target.closest('.top-btns') || e.target.closest('#end-card')) return;
      if (uiHidden) { uiHidden = false; $('#read-ui').classList.remove('hidden'); return; }
      advance();
    });
    $('#btn-hide').onclick = e => { e.stopPropagation(); uiHidden = true; $('#read-ui').classList.add('hidden'); };
    $('#btn-log').onclick = e => {
      e.stopPropagation();
      const body = $('#log-body');
      body.innerHTML = '';
      logLines.forEach(t => { const p = document.createElement('p'); p.textContent = t; body.appendChild(p); });
      $('#log').classList.add('open');
      body.scrollTop = body.scrollHeight;
    };
    $('#btn-menu').onclick = e => { e.stopPropagation(); $('#menu').classList.add('open'); };
    $('#btn-next-ch').onclick = e => { e.stopPropagation(); startAt(cur.c + 1, 0, 0, true); };
    $('#viewer').onclick = () => $('#viewer').classList.remove('open');

    $$('.seg').forEach(seg => seg.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      state.settings[seg.dataset.key] = b.dataset.v;
      persist(); applySettings(); renderSettings();
    }));
    $('#btn-reset').onclick = () => {
      if (!window.confirm('読んだ位置・既読・ギャラリーの記録を消します。よろしいですか？')) return;
      state.pos = null; state.read = []; state.cg = [];
      persist(); show('title');
    };
  }

  // ---------- 起動 ----------
  applySettings();
  bind();
  const FILES = ['part1.json', 'part2.json', 'part3.json', 'part4.json', 'part5.json', 'part6.json', 'part7.json', 'part8.json', 'part9.json', 'part10.json', 'part11.json', 'part12.json', 'part13.json', 'part14.json'];
  Promise.all(FILES.map(f => fetch(f).then(r => r.json()))).then(list => {
    DATA = { parts: [], chapters: [] };
    list.forEach((d, p) => {
      DATA.parts.push(d.part);
      d.chapters.forEach(ch => { ch.part = p; DATA.chapters.push(ch); });
    });
    show('title');
  }).catch(() => {
    $('.title-sub').textContent = '本文データを読み込めませんでした';
  });
})();
