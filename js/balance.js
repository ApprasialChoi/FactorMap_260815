/* FactorMap — 본건 균형검토 모듈
   · 데이터: data/balance.js (window.FM_BAL — 별첨1. 공시지가(일련수정) + 연속지적도 폴리곤)
   · 메인 앱이 노출한 window.FM (지도·팝업·사례 레이어 숨김) 을 쓴다. 지도 없으면 표·필터만 동작.
   · 행(일련번호) 단위 필터 → 통과 행이 하나라도 있는 필지의 폴리곤을 결정단가 5분위 색으로 표시
   · 요약표는 용도지역·이용상황 필터를 뺀 나머지 조건으로 집계 (표가 한 줄로 쪼그라들지 않게) */
(function () {
    'use strict';
    var D = window.FM_BAL;
    if (!D) return;
    var META = D.meta, ROWS = D.rows, POLYS = D.polys;
    var FM = window.FM || {};
    function map() { return FM.map || null; }
    function byId(id) { return document.getElementById(id); }
    function KLL(a) { return new kakao.maps.LatLng(a[0], a[1]); }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
        return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]; }); }
    function won(v) { return v == null ? '–' : Math.round(v).toLocaleString('ko-KR'); }
    function n3(v) { return v == null ? '–' : String(+Number(v).toFixed(3)); }
    function n2(v) { return v == null ? '–' : Number(v).toFixed(2); }
    function n5(v) { return v == null ? '–' : String(+Number(v).toFixed(5)); }
    function area(v) { return v == null ? '–' : Number(v).toLocaleString('ko-KR', {maximumFractionDigits: 1}); }
    function zshort(z) {
        return String(z).replace('제', '').replace('일반주거지역', '일주').replace('전용주거지역', '전주')
            .replace('일반상업지역', '일상').replace('근린상업지역', '근상').replace('준주거지역', '준주')
            .replace('준공업지역', '준공').replace('일반공업지역', '일공').replace('자연녹지지역', '자연녹지')
            .replace('생산녹지지역', '생산녹지').replace('계획관리지역', '계관').replace('지역', '');
    }
    function shortAddr(a) { var t = String(a || '').split(' '); return t.length >= 3 ? t.slice(1).join(' ') : a; }   // '산이면 대진리 246' → '대진리 246'
    function mean(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; }
    function quant(a, p) { if (!a.length) return NaN; var i = (a.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
        return a[lo] + (a[hi] - a[lo]) * (i - lo); }

    // ───────── 필지 묶음 (폴리곤 1 : 행 n) ─────────
    var PAR = {}, PLIST = [];
    ROWS.forEach(function (r) {
        var k = r.pnu || ('a:' + r.a);
        var p = PAR[k];
        if (!p) { p = PAR[k] = {k: k, a: r.a, pnu: r.pnu, rows: [], poly: r.pnu ? POLYS[r.pnu] : null}; PLIST.push(p); }
        p.rows.push(r);
        r._p = p;
    });

    // ───────── 상태 ─────────
    var BS = {blk: {}, jm: {}, zone: {}, use: {}, ri: {}, f: [{}, {}, {}, {}, {}, {}], oth: {},
              ftMin: 0, ftMax: 0, decMin: 0, decMax: 0, amtMin: 0, amtMax: 0, nodec: false};
    var ON = false, LABELS = true, FIT_DONE = false;
    var COLORS = ['#2563eb', '#0891b2', '#16a34a', '#d97706', '#dc2626'];
    var BINS = [], SEL = [], SELP = [];

    function any(o) { for (var k in o) if (o[k]) return true; return false; }
    function tog(o, k) { if (o[k]) delete o[k]; else o[k] = 1; }
    function vk(v) { return v == null ? '-' : String(v); }
    function passRow(r, skipZU) {
        if (r.dec == null && !BS.nodec) return false;
        if (any(BS.blk) && !BS.blk[r.b]) return false;
        if (any(BS.jm) && !BS.jm[r.j]) return false;
        if (any(BS.ri) && !BS.ri[r.ri]) return false;
        if (!skipZU) {
            if (any(BS.zone) && !BS.zone[r.z]) return false;
            if (any(BS.use) && !BS.use[r.u]) return false;
        }
        for (var i = 0; i < 6; i++) if (any(BS.f[i]) && !BS.f[i][vk(r.f[i])]) return false;
        if (any(BS.oth) && !BS.oth[vk(r.oth)]) return false;
        if (BS.ftMin && !(r.ft >= BS.ftMin)) return false;
        if (BS.ftMax && !(r.ft <= BS.ftMax)) return false;
        if (BS.decMin && !(r.dec >= BS.decMin)) return false;
        if (BS.decMax && !(r.dec <= BS.decMax)) return false;
        if (BS.amtMin && !(r.amt >= BS.amtMin)) return false;
        if (BS.amtMax && !(r.amt <= BS.amtMax)) return false;
        return true;
    }

    function compute() {
        SEL = ROWS.filter(function (r) { return passRow(r, false); });
        PLIST.forEach(function (p) { p._on = false; p._dec = null; p._rows = []; p._rep = null; });
        SEL.forEach(function (r) { r._p._on = true; r._p._rows.push(r); });
        SELP = PLIST.filter(function (p) { return p._on; });
        SELP.forEach(function (p) {
            // 필지 대표 결정단가 = 통과 행 중 사정면적이 가장 큰 행
            var best = null;
            p._rows.forEach(function (r) {
                if (r.dec != null && (!best || (r.ar2 || 0) > (best.ar2 || 0))) best = r;
            });
            p._rep = best || p._rows[0];
            p._dec = best ? best.dec : null;
        });
        var v = SEL.map(function (r) { return r.dec; }).filter(function (x) { return x != null; })
            .sort(function (a, b) { return a - b; });
        BINS = v.length >= 5 ? [quant(v, .2), quant(v, .4), quant(v, .6), quant(v, .8)] : [];
    }
    function colorOf(d) {
        if (d == null) return '#94a3b8';
        var i = 0;
        while (i < BINS.length && d > BINS[i]) i++;
        return COLORS[i];
    }

    // ───────── 칩 ─────────
    function chips(el, items, isOn, onClick) {
        var same = el.childNodes.length === items.length;
        if (same) for (var i = 0; i < items.length; i++) {
            if (el.childNodes[i].textContent !== items[i].label) { same = false; break; }
        }
        if (!same) {
            el.innerHTML = '';
            items.forEach(function () { el.appendChild(document.createElement('div')); });
        }
        items.forEach(function (it, i2) {
            var c = el.childNodes[i2];
            c.className = 'chip' + (isOn(it) ? ' active' : '');
            if (c.textContent !== it.label) c.textContent = it.label;
            c.onclick = function () { onClick(it); render(); };
        });
    }
    var CNT = null;
    function counts() {
        if (CNT) return CNT;
        CNT = {blk: {}, ri: {}, zone: {}, use: {}, jm: {}};
        ROWS.forEach(function (r) {
            if (r.dec == null) return;
            CNT.blk[r.b] = (CNT.blk[r.b] || 0) + 1; CNT.ri[r.ri] = (CNT.ri[r.ri] || 0) + 1;
            CNT.zone[r.z] = (CNT.zone[r.z] || 0) + 1; CNT.use[r.u] = (CNT.use[r.u] || 0) + 1;
            CNT.jm[r.j] = (CNT.jm[r.j] || 0) + 1;
        });
        return CNT;
    }
    function renderChips() {
        var c = counts();
        function idxItems(list, cnt) {
            return list.map(function (nm, i) { return {label: nm + (cnt ? ' ' + (cnt[i] || 0) : ''), v: i}; });
        }
        chips(byId('b-blk'), idxItems(META.blocks, c.blk), function (it) { return !!BS.blk[it.v]; }, function (it) { tog(BS.blk, it.v); });
        chips(byId('b-ri'), idxItems(META.ris, c.ri), function (it) { return !!BS.ri[it.v]; }, function (it) { tog(BS.ri, it.v); });
        chips(byId('b-zone'), META.zones.map(function (z, i) { return {label: zshort(z) + ' ' + (c.zone[i] || 0), v: i}; }),
            function (it) { return !!BS.zone[it.v]; }, function (it) { tog(BS.zone, it.v); });
        chips(byId('b-use'), idxItems(META.uses, c.use), function (it) { return !!BS.use[it.v]; }, function (it) { tog(BS.use, it.v); });
        chips(byId('b-jm'), idxItems(META.jms, c.jm), function (it) { return !!BS.jm[it.v]; }, function (it) { tog(BS.jm, it.v); });
        META.fvals.forEach(function (vals, i) {
            chips(byId('b-f' + i), vals.map(function (v) { return {label: n3(v), v: vk(v)}; }),
                function (it) { return !!BS.f[i][it.v]; }, function (it) { tog(BS.f[i], it.v); });
        });
        chips(byId('b-oth'), META.ovals.map(function (v) { return {label: n2(v), v: vk(v)}; }),
            function (it) { return !!BS.oth[it.v]; }, function (it) { tog(BS.oth, it.v); });
        chips(byId('b-opt'), [{label: '결정단가 미기재 행 포함 (' + (META.nrows - META.ndec) + ')', v: 'nodec'}],
            function () { return BS.nodec; }, function () { BS.nodec = !BS.nodec; });
    }

    // ───────── 요약표 (용도지역 × 이용상황) ─────────
    function renderMatrix(el, mode) {
        var base = ROWS.filter(function (r) { return passRow(r, true); });
        var cell = {};
        base.forEach(function (r) {
            var v = mode === 'dec' ? r.dec : r.oth;
            if (v == null) return;
            (cell[r.z + '|' + r.u] = cell[r.z + '|' + r.u] || []).push(v);
        });
        var zs = [];
        META.zones.forEach(function (_, zi) {
            if (META.uses.some(function (_, u) { return cell[zi + '|' + u]; })) zs.push(zi);
        });
        var onlyZ = Object.keys(BS.zone), onlyU = Object.keys(BS.use);
        var h = '<tr><th></th>' + META.uses.map(function (u) { return '<th>' + esc(u) + '</th>'; }).join('') + '</tr>';
        if (!zs.length) h += '<tr><td colspan="5" class="none">조건에 맞는 행이 없습니다</td></tr>';
        zs.forEach(function (zi) {
            h += '<tr><th title="' + esc(META.zones[zi]) + '">' + esc(zshort(META.zones[zi])) + '</th>';
            META.uses.forEach(function (_, u) {
                var a = cell[zi + '|' + u];
                var sel = onlyZ.length === 1 && onlyU.length === 1 && BS.zone[zi] && BS.use[u];
                if (!a) { h += '<td class="mx empty' + (sel ? ' sel' : '') + '" data-z="' + zi + '" data-u="' + u + '"></td>'; return; }
                var m = mean(a), body;
                if (mode === 'dec') {
                    body = '<b>' + won(m) + '</b><small>' + a.length + '</small>';
                } else {
                    var dv = {}; a.forEach(function (v) { dv[v] = 1; });
                    var ks = Object.keys(dv).map(Number).sort(function (x, y) { return x - y; });
                    body = '<b>' + n2(m) + '</b><small>' + (ks.length === 1 ? a.length + '행' :
                        (ks.length <= 3 ? ks.map(n2).join('·') : n2(ks[0]) + '~' + n2(ks[ks.length - 1]) + ' (' + ks.length + '종)')) + '</small>';
                }
                h += '<td class="mx' + (sel ? ' sel' : '') + '" data-z="' + zi + '" data-u="' + u + '">' + body + '</td>';
            });
            h += '</tr>';
        });
        el.innerHTML = h;
        Array.prototype.forEach.call(el.querySelectorAll('td.mx'), function (td) {
            td.onclick = function () {
                var z = +td.getAttribute('data-z'), u = +td.getAttribute('data-u');
                var zk = Object.keys(BS.zone), uk = Object.keys(BS.use);      // 클릭 시점 상태로 판단
                var already = zk.length === 1 && uk.length === 1 && BS.zone[z] && BS.use[u];
                BS.zone = {}; BS.use = {};
                if (!already) { BS.zone[z] = 1; BS.use[u] = 1; }
                render();
            };
        });
    }
    function matrixAoa(mode) {
        var base = ROWS.filter(function (r) { return passRow(r, true); });
        var cell = {};
        base.forEach(function (r) {
            var v = mode === 'dec' ? r.dec : r.oth;
            if (v == null) return;
            (cell[r.z + '|' + r.u] = cell[r.z + '|' + r.u] || []).push(v);
        });
        var out = [['용도지역 \\ 이용상황'].concat(META.uses.map(function (u) { return u + (mode === 'dec' ? ' 평균결정단가' : ' 기타요인'); }))
                   .concat(META.uses.map(function (u) { return u + ' n'; }))];
        META.zones.forEach(function (z, zi) {
            var row = [z], ns = [], has = false;
            META.uses.forEach(function (_, u) {
                var a = cell[zi + '|' + u];
                if (a) { has = true; row.push(mode === 'dec' ? Math.round(mean(a)) : +mean(a).toFixed(3)); ns.push(a.length); }
                else { row.push(''); ns.push(''); }
            });
            if (has) out.push(row.concat(ns));
        });
        return out;
    }

    // ───────── 지도 ─────────
    var PG = {}, SHOWN = {}, LBL = [];
    function ensurePG(p) {
        if (PG[p.k] || !p.poly || !map()) return PG[p.k];
        var arr = [];
        p.poly.r.forEach(function (ring) {
            var pg = new kakao.maps.Polygon({path: ring.map(KLL), strokeWeight: 2, strokeOpacity: .95,
                strokeColor: '#2563eb', fillColor: '#2563eb', fillOpacity: .16, zIndex: 4});
            kakao.maps.event.addListener(pg, 'click', function () { openPopup(p); });
            arr.push(pg);
        });
        return (PG[p.k] = arr);
    }
    function clearLabels() { LBL.forEach(function (o) { o.setMap(null); }); LBL = []; }
    function hideAll() {
        Object.keys(SHOWN).forEach(function (k) { PG[k].forEach(function (pg) { pg.setMap(null); }); });
        SHOWN = {};
        clearLabels();
    }
    function renderMap() {
        var m = map();
        if (!m || !ON) return;
        var bd = m.getBounds(), lv = m.getLevel(), vis = [];
        PLIST.forEach(function (p) {
            var want = p._on && p.poly && bd.contain(KLL(p.poly.c));
            if (!want) {
                if (SHOWN[p.k]) { PG[p.k].forEach(function (pg) { pg.setMap(null); }); delete SHOWN[p.k]; }
                return;
            }
            var arr = ensurePG(p), col = colorOf(p._dec);
            arr.forEach(function (pg) {
                pg.setOptions({strokeColor: col, fillColor: col});
                if (!SHOWN[p.k]) pg.setMap(m);
            });
            SHOWN[p.k] = 1;
            vis.push(p);
        });
        clearLabels();
        if (LABELS && lv <= 3) {
            vis.slice(0, 400).forEach(function (p) {
                if (p._dec == null) return;
                var r = p._rep, n = p._rows.length;
                var tot = p._rows.reduce(function (s, x) { return s + (x.amt || 0); }, 0);
                var el = document.createElement('div');
                el.className = 'bal-lbl';
                el.style.borderColor = colorOf(p._dec);
                // 연번 · 소재지+지번 / 용도지역 · 지대 / 결정단가 · 평가금액 (사례 마커와 같은 3단 구성)
                el.innerHTML = '<div class="bl-top"><b>' + esc(r.no) + '</b> ' + esc(shortAddr(p.a)) +
                        (n > 1 ? ' <i>+' + (n - 1) + '</i>' : '') + '</div>' +
                    '<div class="bl-mid" style="background:' + colorOf(p._dec) + '">' + esc(zshort(META.zones[r.z])) +
                        '<span>' + esc(META.uses[r.u]) + '</span></div>' +
                    '<div class="bl-bot"><b>' + won(p._dec) + '</b><small>원/㎡</small> · ' +
                        (n > 1 ? '<small>합</small>' : '') + won(tot) + '</div>';
                el.onclick = function () { openPopup(p); };
                var ov = new kakao.maps.CustomOverlay({position: KLL(p.poly.c), content: el, yAnchor: .5, xAnchor: .5, zIndex: 8, clickable: true});
                ov.setMap(m);
                LBL.push(ov);
            });
        }
        var note = byId('b-vis');
        if (note) note.textContent = '화면 표시 ' + vis.length.toLocaleString() + '필지' +
            (lv > 3 && LABELS ? ' · 단가 라벨은 확대(레벨 3 이하) 시 표시' : '');
    }
    function fitBal() {
        var m = map();
        if (!m) return;
        m.relayout();
        var kb = new kakao.maps.LatLngBounds();
        Object.keys(POLYS).forEach(function (k) { kb.extend(KLL(POLYS[k].c)); });
        if (kb.isEmpty()) return;
        m.setBounds(kb, 30);
        FIT_DONE = true;
    }
    function renderLegend() {
        var el = byId('bal-legend');
        if (!el) return;
        if (!BINS.length) { el.innerHTML = '<b>결정단가</b><div class="lg-none">표본 부족</div>'; return; }
        var lab = ['≤ ' + won(BINS[0]), '~ ' + won(BINS[1]), '~ ' + won(BINS[2]), '~ ' + won(BINS[3]), '> ' + won(BINS[3])];
        el.innerHTML = '<b>결정단가 (원/㎡ · 5분위)</b>' + COLORS.map(function (c, i) {
            return '<div class="lg-row"><span class="lg-sw" style="background:' + c + '"></span>' + lab[i] + '</div>';
        }).join('') + '<div class="lg-sub">필지 색 = 사정면적이 가장 큰 통과 행의 결정단가</div>';
    }

    // ───────── 팝업 (필지 개요 · 행별 산식) ─────────
    function openPopup(p) {
        if (!map() || !p.poly || !FM.showInfo) return;
        var r0 = p._rep || p.rows[0];
        var h = '<h4>' + esc(p.a) + ' <small>' + esc(META.blocks[r0.b]) + ' · ' + esc(META.jms[r0.j]) +
                ' · 전체 ' + area(r0.ar) + '㎡' + (p.rows.length > 1 ? ' · ' + p.rows.length + '행' : '') + '</small></h4>';
        p.rows.forEach(function (r) {
            var on = passRow(r, false);
            h += '<div class="bal-row' + (on ? '' : ' off') + '">' +
                '<div class="l1"><b>[' + esc(r.no) + ']</b> ' + esc(META.zones[r.z]) + ' · 지대 ' + esc(META.uses[r.u]) +
                    ' · 사정 ' + area(r.ar2) + '㎡' +
                    ' · <span class="dec">' + won(r.dec) + '</span><small>원/㎡</small> · 평가금액 ' + won(r.amt) + '</div>' +
                '<div class="l2">공시지가 ' + esc((r.sk ? r.sk + ' ' : '') + r.sa + ' ' + r.sj) + ' · ' + won(r.sg) + '원</div>' +
                '<div class="l2">시점 ' + n5(r.tm) + ' × 지역 ' + n3(r.rg) + ' × 개별 ' + r.f.map(n3).join('·') + ' = ' + n3(r.ft) +
                    ' × 기타 ' + n2(r.oth) + ' → 산정 ' + won(r.calc) + '</div>' +
                (on ? '' : '<div class="l3">현재 필터에서 제외된 행</div>') + '</div>';
        });
        FM.showInfo(KLL(p.poly.c), h, null, 'bal');
    }

    // ───────── 목록 ─────────
    function renderList() {
        var el = byId('b-list');
        var arr = SELP.filter(function (p) { return p._dec != null; })
            .sort(function (a, b) { return b._dec - a._dec; });
        byId('b-list-head').innerHTML = '결정단가 상위 필지 <small>— ' + Math.min(arr.length, 120) + '/' +
            arr.length.toLocaleString() + ' · 클릭하면 지도 이동</small>';
        el.innerHTML = '';
        if (!arr.length) { el.innerHTML = '<div class="empty-state">조건에 맞는 필지가 없습니다</div>'; return; }
        arr.slice(0, 120).forEach(function (p) {
            var r = p._rep, it = document.createElement('div');
            it.className = 'ri-item';
            var tot = p._rows.reduce(function (s, x) { return s + (x.amt || 0); }, 0);
            it.innerHTML = '<span class="nm"><b style="color:#0051af">' + esc(r.no) + '</b> ' + esc(p.a) +
                '<small>' + esc(zshort(META.zones[r.z])) + ' · ' + esc(META.uses[r.u]) + ' · ' + esc(META.jms[r.j]) +
                ' · ' + (p._rows.length > 1 ? '합 ' : '') + won(tot) + '원' +
                (p.poly ? '' : ' · <span style="color:#c05621">폴리곤 없음</span>') + '</small></span>' +
                '<span class="md" style="color:' + colorOf(p._dec) + '">' + won(p._dec) + '</span>';
            it.onclick = function () {
                var m = map();
                if (!m || !p.poly) return;
                if (m.getLevel() > 3) m.setLevel(3);
                m.panTo(KLL(p.poly.c));
                setTimeout(function () { renderMap(); openPopup(p); }, 250);
            };
            el.appendChild(it);
        });
    }

    // ───────── 내려받기 ─────────
    function condText() {
        var t = [];
        function names(o, list) { return Object.keys(o).map(function (k) { return list[k]; }).join('·'); }
        if (any(BS.blk)) t.push('블록 ' + names(BS.blk, META.blocks));
        if (any(BS.ri)) t.push('리 ' + names(BS.ri, META.ris));
        if (any(BS.zone)) t.push('용도지역 ' + names(BS.zone, META.zones));
        if (any(BS.use)) t.push('이용상황 ' + names(BS.use, META.uses));
        if (any(BS.jm)) t.push('지목 ' + names(BS.jm, META.jms));
        BS.f.forEach(function (o, i) { if (any(o)) t.push(META.flabel[i] + ' ' + Object.keys(o).join('·')); });
        if (any(BS.oth)) t.push('기타요인 ' + Object.keys(BS.oth).join('·'));
        if (BS.ftMin || BS.ftMax) t.push('개별누계 ' + (BS.ftMin || '') + '~' + (BS.ftMax || ''));
        if (BS.decMin || BS.decMax) t.push('결정단가 ' + (BS.decMin ? won(BS.decMin) : '') + '~' + (BS.decMax ? won(BS.decMax) : ''));
        if (BS.amtMin || BS.amtMax) t.push('평가액 ' + (BS.amtMin ? won(BS.amtMin) : '') + '~' + (BS.amtMax ? won(BS.amtMax) : ''));
        if (BS.nodec) t.push('결정단가 미기재 행 포함');
        return t.length ? t.join(' / ') : '조건 없음 (결정단가 기재 행 전체)';
    }
    function exportXlsx() {
        if (!window.XLSX) { alert('엑셀 라이브러리가 로드되지 않았습니다'); return; }
        var hdr = ['연번', '소재지+지번', '블록', '지목', '지대(이용상황)', '면적(전체)', '면적(사정)', '용도지역',
                   '공시지가 기호', '공시지가 소재지', '공시지가 지번', '공시지가', '시점수정', '지역요인',
                   '가로', '접근', '환경', '획지', '행정', '기타조건', '개별누계', '기타요인', '산정단가', '결정단가', '평가금액', 'PNU'];
        var aoa = [hdr].concat(SEL.map(function (r) {
            return [r.no, r.a, META.blocks[r.b], META.jms[r.j], META.uses[r.u], r.ar, r.ar2, META.zones[r.z],
                    r.sk, r.sa, r.sj, r.sg, r.tm, r.rg].concat(r.f).concat([r.ft, r.oth, r.calc, r.dec, r.amt, r.pnu]);
        }));
        var wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), '균형검토(필터)');
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(matrixAoa('dec')), '평균결정단가');
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(matrixAoa('oth')), '기타요인');
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
            ['원본', META.src + ' / ' + META.sheet], ['빌드', META.built], ['조건', condText()],
            ['통과 행', SEL.length], ['통과 필지', SELP.length],
            ['요약표 기준', '용도지역·이용상황 필터를 제외한 조건으로 집계 (단순평균)']]), '조건');
        var d = new Date(), pad = function (n) { return (n < 10 ? '0' : '') + n; };
        XLSX.writeFile(wb, '본건_균형검토_' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
            '_' + pad(d.getHours()) + pad(d.getMinutes()) + '.xlsx');
    }

    // ───────── 범위 입력 ─────────
    function wireRange(minId, maxId, keyMin, keyMax, noteId, fmt) {
        var a = byId(minId), b = byId(maxId), t = null;
        function apply() {
            BS[keyMin] = Math.max(0, parseFloat(a.value) || 0);
            BS[keyMax] = Math.max(0, parseFloat(b.value) || 0);
            a.classList.toggle('on', !!BS[keyMin]);
            b.classList.toggle('on', !!BS[keyMax]);
            if (noteId) {
                var n = byId(noteId), lo = BS[keyMin], hi = BS[keyMax];
                n.innerHTML = (lo && hi && hi < lo) ? '<span style="color:#c05621">최대가 최소보다 작습니다 — 결과 0건</span>'
                    : ((lo ? fmt(lo) + ' 이상' : '') + (lo && hi ? ' · ' : '') + (hi ? fmt(hi) + ' 이하' : ''));
            }
            render();
        }
        function later() { clearTimeout(t); t = setTimeout(apply, 300); }
        a.addEventListener('input', later); b.addEventListener('input', later);
        a.addEventListener('change', apply); b.addEventListener('change', apply);
        return function () { a.value = ''; b.value = ''; apply(); };
    }

    // ───────── 렌더 · 모드 ─────────
    function render() {
        if (!ON) return;
        compute();
        renderChips();
        byId('bal-count').innerHTML = '통과 <b>' + SEL.length.toLocaleString() + '</b>행 · <b>' + SELP.length.toLocaleString() +
            '</b>필지 / 전체 ' + META.nrows.toLocaleString() + '행 · ' + META.nparcels.toLocaleString() + '필지' +
            '<div id="b-vis" style="font-size:10.5px; opacity:.85; font-weight:600; margin-top:2px;">' +
            (map() ? '' : '지도 미표시 — 표·필터만') + '</div>';
        renderMatrix(byId('b-mx-dec'), 'dec');
        renderMatrix(byId('b-mx-oth'), 'oth');
        renderList();
        renderLegend();
        renderMap();
    }
    function setMode(on) {
        ON = on;
        byId('panel-scroll').style.display = on ? 'none' : '';
        byId('bal-scroll').style.display = on ? '' : 'none';
        byId('case-count').style.display = on ? 'none' : '';
        byId('bal-count').style.display = on ? '' : 'none';
        byId('tab-case').classList.toggle('on', !on);
        byId('tab-bal').classList.toggle('on', on);
        byId('subtitle').textContent = on
            ? '본건 결정단가·개별요인·기타요인 균형 검토 — 별첨1 기준'
            : '개공비율(사례단가 ÷ 개별공시지가) 기반 · 해남·영암·무안';
        byId('btn-bal-label').style.display = on ? '' : 'none';
        byId('bal-legend').style.display = on ? '' : 'none';
        if (FM.closeInfo) FM.closeInfo();
        if (FM.setCasesHidden) FM.setCasesHidden(on);
        if (on) {
            render();
            if (!FIT_DONE) fitBal();
            setTimeout(renderMap, 300);
        } else {
            hideAll();
        }
        try { location.hash = on ? 'bal' : ''; } catch (e) {}
    }

    // ───────── 초기화 ─────────
    var resetFns = [
        wireRange('b-ftmin', 'b-ftmax', 'ftMin', 'ftMax', null),
        wireRange('b-decmin', 'b-decmax', 'decMin', 'decMax', 'b-dec-note', function (v) { return won(v) + '원'; }),
        wireRange('b-amtmin', 'b-amtmax', 'amtMin', 'amtMax', 'b-amt-note', function (v) { return won(v) + '원'; })
    ];
    byId('b-reset').onclick = function () {
        BS.blk = {}; BS.jm = {}; BS.zone = {}; BS.use = {}; BS.ri = {}; BS.oth = {}; BS.nodec = false;
        BS.f = [{}, {}, {}, {}, {}, {}];
        resetFns.forEach(function (f) { f(); });
    };
    byId('b-xlsx').onclick = exportXlsx;
    byId('b-fit').onclick = fitBal;
    byId('btn-bal-label').onclick = function () {
        LABELS = !LABELS;
        byId('btn-bal-label').classList.toggle('on', LABELS);
        renderMap();
    };
    byId('btn-bal-label').classList.add('on');
    byId('tab-case').onclick = function () { if (ON) setMode(false); };
    byId('tab-bal').onclick = function () { if (!ON) setMode(true); };
    if (FM.onMapIdle) FM.onMapIdle(function () { if (ON) renderMap(); });

    var info = byId('b-src');
    if (info) info.textContent = META.src + ' · ' + META.sheet + ' · ' + META.built + ' 빌드' +
        (META.missing_poly.length ? ' · 폴리곤 없음 ' + META.missing_poly.length + '필지' : '');
    if (location.hash === '#bal') setMode(true);
})();
