/*
 MoonAlign 계획 공유 페이지(/p) — spec 019 contracts/share-page.md. 손으로 쓰는 파일(생성물 아님).
 형식은 contracts/share-payload.md, 참조 구현은 scripts/share/make_fixtures.py, 견본은 Tests/Parity/fixtures/share_link.json.
 계획 데이터는 URL 해시(#)에만 있고 서버로 가지 않는다 — 이 스크립트도 어디에도 보내지 않는다(외부 요청은 지도 타일뿐).
 앞부분(해석·보조 계산)은 DOM과 분리돼 node 테스트(Tests/ShareLink/share-page.test.js)가 같은 함수를 부른다.
*/
(function (root) {
  'use strict';

  var VERSION = 1;                                     // 이 페이지가 읽는 가장 새 형식
  var MAX_LINK = 4000;                                 // 앱과 같은 입력 상한(링크 전체)
  var PAGE_PREFIX = 'https://moonalign.yjlab.io/p';    // 해시 앞부분 — 해시만 받을 때 링크 길이 환산용
  var MAX_INFLATED = 16 * 1024;                        // 해제 폭탄 방어(앱과 같음)
  var NAME_MAX = 200;
  var MODES = ['st', 'hu', 'fr', 'is', 'ip', 'pl'];
  var WITH_TARGET = ['st', 'hu', 'pl'];
  var BODIES = ['moon', 'sun', 'gc'];
  var PRESETS = ['ff', 'apsc_sony_nikon', 'apsc_canon', 'm43', 'custom'];
  var TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

  function Bad() {}

  function b64urlToBytes(s) {
    if (!/^[A-Za-z0-9_-]+$/.test(s) || s.length % 4 === 1) throw new Bad();
    var std = s.replace(/-/g, '+').replace(/_/g, '/');
    while (std.length % 4) std += '=';
    var bin = typeof atob === 'function' ? atob(std) : Buffer.from(std, 'base64').toString('binary');
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function isNum(v, lo, hi) { return typeof v === 'number' && isFinite(v) && v >= lo && v <= hi; }
  function isStr(v) { return typeof v === 'string'; }
  function cpLen(s) { return Array.from(s).length; }

  function validTime(s) {
    if (!isStr(s) || !TIME_RE.test(s)) return false;
    var d = new Date(s);
    if (isNaN(d.getTime()) || d.toISOString().slice(0, 19) + 'Z' !== s) return false;   // 2/30 같은 넘김 금지
    var y = d.getUTCFullYear();
    return y >= 1900 && y <= 2200;
  }

  function validZone(z) {
    if (!isStr(z)) return false;
    if (z === 'UTC') return true;
    try { new Intl.DateTimeFormat('en', { timeZone: z }); return true; } catch (e) { return false; }
  }

  function checkPoint(o, target) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Bad();
    if (!isNum(o.la, -90, 90) || !isNum(o.lo, -180, 180)) throw new Bad();
    if ('e' in o && !isNum(o.e, -500, 9000)) throw new Bad();
    if (target) {
      ['lm', 'nm'].forEach(function (k) {
        if (k in o && !(isStr(o[k]) && cpLen(o[k]) >= 1 && cpLen(o[k]) <= NAME_MAX)) throw new Bad();
      });
      if ('h' in o && !isNum(o.h, 0, 10000)) throw new Bad();
      if ('hf' in o && o.hf !== 0 && o.hf !== 1) throw new Bad();
    } else if ('eh' in o && !isNum(o.eh, 0, 500)) throw new Bad();
  }

  /** data-model.md §1 검증 — 앱과 같은 규칙. 어기면 Bad. */
  function validate(p) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Bad();
    if (!isStr(p.n) || cpLen(p.n) < 1 || cpLen(p.n) > NAME_MAX) throw new Bad();
    if (!validTime(p.t) || ('pd' in p && !validTime(p.pd)) || !validZone(p.z)) throw new Bad();
    var b = 'b' in p ? p.b : 'moon', m = 'm' in p ? p.m : 'st';
    if (BODIES.indexOf(b) < 0 || MODES.indexOf(m) < 0) throw new Bad();
    if ((WITH_TARGET.indexOf(m) >= 0) !== ('g' in p)) throw new Bad();
    if ('g' in p) checkPoint(p.g, true);
    if (!('s' in p)) throw new Bad();
    checkPoint(p.s, false);
    if ('a' in p) {
      if (m !== 'hu' || !Array.isArray(p.a) || p.a.length < 1 || p.a.length > 10) throw new Bad();
      p.a.forEach(function (t) { checkPoint(t, true); });
    }
    var c = p.c;
    if (!c || typeof c !== 'object' || !isNum(c.f, 1, 5000)) throw new Bad();
    var preset = 'p' in c ? c.p : 'ff';
    if (PRESETS.indexOf(preset) < 0) throw new Bad();
    if (preset === 'custom' && !(isNum(c.w, 1, 100) && isNum(c.h, 1, 100))) throw new Bad();
    if ('o' in c && c.o !== 'landscape' && c.o !== 'portrait') throw new Bad();
    if ('fc' in c && c.fc !== 0 && c.fc !== 1) throw new Bad();
    if ('ap' in c && !isNum(c.ap, 0.5, 64)) throw new Bad();
    if ('ev' in p && !isNum(p.ev, -10, 30)) throw new Bad();
    // 일식·월식 id(spec 020) — 문자열이 아니면 손상, 형식이 아니면 무시(render에서 거른다).
    if ('ec' in p && !isStr(p.ec)) throw new Bad();
  }

  /** 식 행(spec 020) — 피사체 없음 계획의 식 id만. 종류 세분은 앱 몫(웹엔 번들 자료가 없다) — 일식/월식 + 날짜(UTC 최대식 날짜). */
  function eclipseLabel(p, S, L) {
    if ((p.m || 'st') !== 'fr' || !isStr(p.ec) || !/^\d{4}-\d{2}-\d{2}[SL]$/.test(p.ec)) return null;
    var kind = S[p.ec.charAt(10) === 'S' ? 'eclipseSolar' : 'eclipseLunar'];
    var d = new Date(p.ec.slice(0, 10) + 'T12:00:00Z');
    var f = new Intl.DateTimeFormat(L === 'ko' ? 'ko-KR' : L === 'ja' ? 'ja-JP' : 'en-US',
      { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' });
    return (kind || '') + ' · ' + f.format(d);
  }

  /**
   * `location.hash`(앞의 '#' 포함) → {kind:'ok', plan} | {kind:'unsupported', version} | {kind:'corrupt'}.
   * inflateRaw(bytes, limit) → Uint8Array|null — 브라우저는 DecompressionStream, node 테스트는 zlib.
   */
  async function parseShareFragment(hash, inflateRaw) {
    try {
      var frag = String(hash || '').replace(/^#/, '').trim();
      if (frag.length + PAGE_PREFIX.length + 1 > MAX_LINK) throw new Bad();
      var m = /^(\d{1,4})\.(.+)$/.exec(frag);
      if (!m) throw new Bad();
      var v = parseInt(m[1], 10);
      if (v < 1) throw new Bad();
      if (v > VERSION) return { kind: 'unsupported', version: v };
      var raw = await inflateRaw(b64urlToBytes(m[2]), MAX_INFLATED);
      if (!raw || raw.length === 0 || raw.length > MAX_INFLATED) throw new Bad();
      var text = new TextDecoder('utf-8', { fatal: true }).decode(raw);
      var plan = JSON.parse(text);
      validate(plan);
      return { kind: 'ok', plan: plan };
    } catch (e) {
      return { kind: 'corrupt' };
    }
  }

  /** 브라우저 해제 — 상한을 넘으면 읽기를 멈추고 null. */
  async function browserInflateRaw(bytes, limit) {
    if (typeof DecompressionStream !== 'function') return null;
    try {
      var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      var reader = stream.getReader(), chunks = [], total = 0;
      for (;;) {
        var r = await reader.read();
        if (r.done) break;
        total += r.value.length;
        if (total > limit) { reader.cancel(); return null; }
        chunks.push(r.value);
      }
      var out = new Uint8Array(total), off = 0;
      chunks.forEach(function (c) { out.set(c, off); off += c.length; });
      return out;
    } catch (e) { return null; }
  }

  /** 두 지점 구면 거리(km) — 화면 보조(천문 계산 아님). */
  function distanceKm(a, b) {
    var R = 6371.0088, rad = Math.PI / 180;
    var dLa = (b.la - a.la) * rad, dLo = (b.lo - a.lo) * rad;
    var h = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(a.la * rad) * Math.cos(b.la * rad) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /**
   * '앱에서 열기' 주소 — 같은 도메인 안 링크로는 유니버설 링크·앱 링크가 열리지 않아 앱 스킴을 쓴다. 계획은 쿼리(d)에 — 이 주소는 서버로 가지 않는다.
   * Android는 intent 주소(앱이 없으면 Chrome이 Play 스토어의 그 패키지로 보낸다), 그 밖은 moonalign://.
   */
  function appLink(fragment, platform) {
    var d = String(fragment || '').replace(/^#/, '');
    if (platform === 'android') return 'intent://p?d=' + d + '#Intent;scheme=moonalign;package=io.yjlab.moonalign;end';
    return 'moonalign://p?d=' + d;
  }

  /**
   * 지도 앱 링크. Apple은 좌표를 검색어(q)로 넘기면 근처에 주소가 없는 곳(공원·강가 등)에서 "위치를 찾을 수 없음"이 나와
   * (2026-10-04 Windows Chrome, T038) 좌표에 바로 핀을 꽂는 place?coordinate= 형식에 이름표(name)를 붙인다.
   */
  function mapLinks(p, name) {
    var ll = p.la + ',' + p.lo;
    return {
      google: 'https://www.google.com/maps/search/?api=1&query=' + ll,
      apple: 'https://maps.apple.com/place?coordinate=' + ll + (name ? '&name=' + encodeURIComponent(name) : ''),
    };
  }

  var api = {
    parseShareFragment: parseShareFragment, browserInflateRaw: browserInflateRaw,
    distanceKm: distanceKm, mapLinks: mapLinks, appLink: appLink, eclipseLabel: eclipseLabel, VERSION: VERSION,
  };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  root.MoonShare = api;

  // ── 렌더(브라우저) — 문구·랜드마크 이름은 페이지가 싣는 SHARE_STRINGS·landmarks.json. 사용자 문자열은 textContent로만.

  function lang() {
    var langs = (navigator.languages || [navigator.language || 'en']);
    for (var i = 0; i < langs.length; i++) {
      var l = String(langs[i]).toLowerCase().slice(0, 2);
      if (l === 'ko' || l === 'ja' || l === 'en') return l;
    }
    return 'en';
  }

  function platform() {
    var ua = navigator.userAgent || '';
    if (/android/i.test(ua)) return 'android';
    if (/iphone|ipad|ipod|macintosh/i.test(ua)) return 'apple';
    return 'other';
  }

  function el(id) { return document.getElementById(id); }
  function show(id, on) { var e = el(id); if (e) e.hidden = !on; }
  function showClass(c) { document.querySelectorAll('.' + c).forEach(function (e) { e.hidden = false; }); }
  function setText(id, s) { var e = el(id); if (e) e.textContent = s; }

  function subjectLabel(p, S) {
    var body = S['body.' + (p.b || 'moon')];
    switch (p.m || 'st') {
      case 'st': return (p.b === 'gc') ? body : body + ' · ' + S['mode.st'];
      case 'hu': return body + ' · ' + S['mode.hu'];
      case 'fr': return body;
      case 'is': return p.b === 'sun' ? S['mode.is.sun'] : S['mode.is.moon'];
      case 'ip': return S['mode.ip'];
      case 'pl': return S['mode.pl'];
    }
    return body;
  }

  function timeLabel(p, L) {
    var d = new Date(p.t);
    var f = new Intl.DateTimeFormat(L === 'ko' ? 'ko-KR' : L === 'ja' ? 'ja-JP' : 'en-US', {
      timeZone: p.z, year: 'numeric', month: 'short', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
    return f.format(d) + ' (' + p.z + ')';
  }

  function drawMap(p) {
    if (typeof L === 'undefined' || !el('map')) return;
    var leaflet = L;
    var map = leaflet.map('map', { zoomControl: true, attributionControl: true, scrollWheelZoom: false });
    leaflet.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    var pts = [];
    function pin(pt, color) {
      leaflet.circleMarker([pt.la, pt.lo], { radius: 8, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 }).addTo(map);
      pts.push([pt.la, pt.lo]);
    }
    if (p.g) pin(p.g, '#00bcd4');           // 타겟 cyan(앱 색 규칙)
    pin(p.s, '#ff9800');                    // 촬영지 orange
    if (p.g) leaflet.polyline(pts, { color: '#ff9800', weight: 2, dashArray: '6 6' }).addTo(map);
    if (pts.length > 1) map.fitBounds(pts, { padding: [40, 40] }); else map.setView(pts[0], 13);
  }

  async function render() {
    var L = lang();
    var S = (root.SHARE_STRINGS || {})[L] || {};
    document.documentElement.lang = L;
    document.title = S['page.title'] || document.title;
    document.querySelectorAll('[data-s]').forEach(function (e) { if (S[e.dataset.s]) e.textContent = S[e.dataset.s]; });
    var order = platform();
    var stores = el('stores');
    if (stores && order === 'android') stores.insertBefore(el('store-play'), el('store-apple'));
    var r = await parseShareFragment(location.hash, browserInflateRaw);
    if (r.kind === 'unsupported') { show('state-unsupported', true); return; }
    if (r.kind !== 'ok') {
      show(typeof DecompressionStream === 'function' ? 'state-corrupt' : 'state-browser', true);
      return;
    }
    var p = r.plan, names = {};
    try { names = await (await fetch('/p/landmarks.json')).json(); } catch (e) { names = {}; }
    setText('plan-name', p.n);
    setText('plan-time', timeLabel(p, L));
    setText('plan-subject', subjectLabel(p, S));
    var ecl = eclipseLabel(p, S, L);
    if (ecl) { setText('plan-eclipse', ecl); showClass('row-eclipse'); }
    if (p.g) {
      var nm = p.g.lm ? ((L === 'ko' ? p.g.lm : (names[p.g.lm] || {})[L]) || p.g.lm) : p.g.nm;
      if (nm) { setText('plan-target', nm); showClass('row-target'); }
      setText('plan-distance', distanceKm(p.s, p.g).toFixed(1) + ' km');
      showClass('row-distance');
    }
    setText('plan-spot', p.s.la.toFixed(5) + ', ' + p.s.lo.toFixed(5));
    el('open-app').href = appLink(location.hash, order);
    // Windows·Linux 등엔 MoonAlign 앱이 없다 — 눌러도 아무 일이 없어(2026-10-04 Windows Chrome) 버튼과 안내를 숨긴다.
    if (order === 'other') { el('open-app').hidden = true; document.querySelectorAll('[data-s="open.app.note"]').forEach(function (e) { e.hidden = true; }); }
    // 앱이 없으면 스킴 링크는 조용히 실패한다(사파리 경고 또는 메신저 인앱 브라우저에선 무반응 — 2026-10-04 실기기 T038).
    // 누른 뒤 페이지가 계속 보이면 앱이 안 열린 것으로 보고 설치 안내 + 스토어 버튼으로. 앱이 열리면 페이지가 가려져 타이머를 끈다.
    el('open-app').addEventListener('click', function () {
      var timer = setTimeout(function () {
        if (document.visibilityState !== 'visible') return;
        show('open-app-missing', true);
        var st = el('stores');
        if (st && st.scrollIntoView) st.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 1600);
      function cancel() { clearTimeout(timer); }
      document.addEventListener('visibilitychange', function () { if (document.visibilityState !== 'visible') cancel(); }, { once: true });
      window.addEventListener('pagehide', cancel, { once: true });
    });
    var links = mapLinks(p.s, S['spot']);
    el('open-google').href = links.google;
    el('open-apple').href = links.apple;
    show('state-ok', true);
    drawMap(p);
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render); else render();
    window.addEventListener('hashchange', function () { location.reload(); });
  }
})(typeof window !== 'undefined' ? window : this);
