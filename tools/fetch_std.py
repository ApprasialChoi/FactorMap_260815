# -*- coding: utf-8 -*-
"""(Raw)본건외 표준지 — 카카오 지오코딩(b_code·시군구 확정) + VWorld 필지 폴리곤 + 리 경계 보강
   결과:
     std_geo.json     addr → {ll, sgg, pnu}
     data/parcels.js  기존에 표준지 필지 병합
     data/boundaries.js  신규 리 경계 병합
"""
import sys, os, re, json, time, threading
sys.stdout.reconfigure(encoding="utf-8")
import requests
import openpyxl
from concurrent.futures import ThreadPoolExecutor, as_completed

SRC = r'\\server_new\공용폴더\2. 업무Part\♣해남 솔라시도\원준\★솔라시도_GIS공간분석_2261필지_v5(260820).xlsx'
OUT = r'D:\Dropbox\■ 전산TF\Github Clone\FactorMap_260815\data'
HERE = os.path.dirname(os.path.abspath(__file__))
GEO_CACHE = os.path.join(HERE, 'std_geo.json')
PAR_CACHE = os.path.join(HERE, 'std_parcel_cache.json')
KKEY = "8b9a82bbb05d02a6b63170a7c257bf7d"
VKEY = 'E333059C-5AF1-3959-9C69-99B588DBFB75'
VH = {'Referer': 'https://apprasialchoi.github.io/'}
QPS = 8.0


class Limiter:
    def __init__(self, rate):
        self.rate, self.tokens, self.last = rate, rate, time.monotonic()
        self.lock = threading.Lock()

    def acquire(self):
        with self.lock:
            now = time.monotonic()
            self.tokens = min(self.rate, self.tokens + (now - self.last) * self.rate)
            self.last = now
            if self.tokens >= 1:
                self.tokens -= 1
                wait = 0.0
            else:
                wait = (1 - self.tokens) / self.rate
                self.tokens = 0
                self.last = now + wait
        if wait > 0:
            time.sleep(wait)


def collect():
    ws = openpyxl.load_workbook(SRC, data_only=True, read_only=True)['(Raw)본건외 표준지']
    out = []
    for r in ws.iter_rows(min_row=2, values_only=True):
        so = re.sub(r'\s+', ' ', str(r[1] or '')).strip()
        jb = str(r[2] or '').strip()
        if not so or not jb:
            continue
        if str(r[4] or '').strip() == '제외':
            continue
        out.append(so + ' ' + jb)
    return sorted(set(out))


def dp(points, eps):
    if len(points) < 3:
        return points

    def perp(p, a, b):
        ax, ay = a
        bx, by = b
        px, py = p
        dx, dy = bx - ax, by - ay
        if dx == dy == 0:
            return ((px - ax) ** 2 + (py - ay) ** 2) ** 0.5
        t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
        return ((px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2) ** 0.5
    dmax, idx = 0, 0
    for i in range(1, len(points) - 1):
        d = perp(points[i], points[0], points[-1])
        if d > dmax:
            dmax, idx = d, i
    if dmax > eps:
        return dp(points[:idx + 1], eps)[:-1] + dp(points[idx:], eps)
    return [points[0], points[-1]]


def geocode_all(addrs):
    cache = json.load(open(GEO_CACHE, encoding='utf-8')) if os.path.exists(GEO_CACHE) else {}
    todo = [a for a in addrs if a not in cache]
    print(f'지오코딩 대상 {len(addrs)} · 미처리 {len(todo)}')
    ses = requests.Session()
    lim = Limiter(QPS)
    lock = threading.Lock()
    cnt = [0]

    def one(a):
        for att in range(3):
            lim.acquire()
            try:
                j = ses.get('https://dapi.kakao.com/v2/local/search/address.json',
                            headers={"Authorization": "KakaoAK " + KKEY},
                            params={'query': a, 'size': 2, 'analyze_type': 'similar'},
                            timeout=10).json()
                docs = j.get('documents') or []
                for d in docs:
                    ad = d.get('address')
                    if not ad or not ad.get('b_code'):
                        continue
                    san = '2' if ad.get('mountain_yn') == 'Y' else '1'
                    pnu = (ad['b_code'] + san
                           + str(int(ad.get('main_address_no') or 0)).zfill(4)
                           + str(int(ad.get('sub_address_no') or 0)).zfill(4))
                    toks = (ad.get('address_name') or '').split()
                    sgg = next((t for t in toks[1:] if t.endswith(('시', '군', '구'))), '')
                    return a, {'ll': [round(float(d['y']), 6), round(float(d['x']), 6)],
                               'sgg': sgg, 'pnu': pnu}, True
                return a, None, True
            except Exception:
                time.sleep(1.2 * (att + 1))
        return a, None, False

    with ThreadPoolExecutor(max_workers=8) as ex:
        for fut in as_completed({ex.submit(one, a) for a in todo}):
            a, v, ok = fut.result()
            with lock:
                if ok:
                    cache[a] = v
                cnt[0] += 1
                if cnt[0] % 300 == 0:
                    json.dump(cache, open(GEO_CACHE, 'w', encoding='utf-8'), ensure_ascii=False)
                    print(f'  지오코딩 {cnt[0]}/{len(todo)}')
    json.dump(cache, open(GEO_CACHE, 'w', encoding='utf-8'), ensure_ascii=False)
    hit = sum(1 for a in addrs if cache.get(a))
    print(f'지오코딩 확보 {hit}/{len(addrs)}')
    return cache


def fetch_parcels(cache, addrs):
    par = json.load(open(PAR_CACHE, encoding='utf-8')) if os.path.exists(PAR_CACHE) else {}
    todo = [a for a in addrs if cache.get(a) and a not in par]
    print(f'필지 대상 {len(todo)}')
    ses = requests.Session()
    lim = Limiter(6.0)
    lock = threading.Lock()
    cnt = [0]

    def one(a):
        pnu = cache[a]['pnu']
        u = ('https://api.vworld.kr/req/data?service=data&request=GetFeature&data=LP_PA_CBND_BUBUN'
             f'&key={VKEY}&domain=apprasialchoi.github.io&attrFilter=pnu:=:{pnu}'
             '&format=json&size=5&crs=EPSG:4326')
        for att in range(3):
            lim.acquire()
            try:
                d = ses.get(u, headers=VH, timeout=20).json()
                r = d.get('response', {})
                if r.get('status') == 'NOT_FOUND':
                    return a, None, True
                fts = ((r.get('result') or {}).get('featureCollection') or {}).get('features', [])
                if not fts:
                    if r.get('status') == 'OK':
                        return a, None, True
                    raise RuntimeError(r.get('status'))
                g = fts[0]['geometry']
                coords = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
                rings, la, ln, n = [], 0.0, 0.0, 0
                for poly in coords:
                    pts = [(round(p[1], 6), round(p[0], 6)) for p in poly[0]]
                    for p in pts:
                        la += p[0]
                        ln += p[1]
                        n += 1
                    pts = dp(pts, 0.00002)
                    if len(pts) >= 4:
                        rings.append([[p[0], p[1]] for p in pts])
                if not rings:
                    return a, None, True
                return a, {'c': [round(la / n, 6), round(ln / n, 6)], 'r': rings}, True
            except Exception:
                time.sleep(1.2 * (att + 1))
        return a, None, False

    with ThreadPoolExecutor(max_workers=6) as ex:
        for fut in as_completed({ex.submit(one, a) for a in todo}):
            a, v, ok = fut.result()
            with lock:
                if ok:
                    par[a] = v
                cnt[0] += 1
                if cnt[0] % 300 == 0:
                    json.dump(par, open(PAR_CACHE, 'w', encoding='utf-8'), ensure_ascii=False)
                    print(f'  필지 {cnt[0]}/{len(todo)}')
    json.dump(par, open(PAR_CACHE, 'w', encoding='utf-8'), ensure_ascii=False)
    hit = sum(1 for a in addrs if par.get(a))
    print(f'필지 확보 {hit}/{len(addrs)}')
    return par


def merge_boundaries(cache, addrs):
    """신규 리(li_cd) 경계 보강"""
    p = os.path.join(OUT, 'boundaries.js')
    src = open(p, encoding='utf-8').read()
    bounds = json.loads(re.search(r'window\.FM_BOUNDS = (.*?);\n', src).group(1))
    # 기존 키: 시군구|읍면|리
    need = {}
    for a in addrs:
        g = cache.get(a)
        if not g:
            continue
        toks = a.split()
        if len(toks) != 3:                 # 동형(목포 시내)은 리 경계 대상 아님
            continue
        k = f"{g['sgg']}|{toks[0]}|{toks[1]}"
        if k not in bounds:
            need[k] = g['pnu'][:10]
    print(f'신규 리 경계 {len(need)}곳')
    for k, li in sorted(need.items()):
        u = ('https://api.vworld.kr/req/data?service=data&request=GetFeature&data=LT_C_ADRI_INFO'
             f'&key={VKEY}&domain=apprasialchoi.github.io&attrFilter=li_cd:=:{li}'
             '&format=json&size=5&crs=EPSG:4326')
        try:
            d = requests.get(u, headers=VH, timeout=20).json()
        except Exception as e:
            print('  실패', k, e)
            continue
        fts = ((d.get('response', {}).get('result') or {}).get('featureCollection') or {}).get('features', [])
        if not fts:
            print('  경계없음', k, li)
            continue
        g = fts[0]['geometry']
        coords = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
        rings = []
        for poly in coords:
            pts = [(round(pt[1], 6), round(pt[0], 6)) for pt in poly[0]]
            pts = dp(pts, 0.00012)
            if len(pts) >= 4:
                rings.append([[q[0], q[1]] for q in pts])
        if rings:
            bounds[k] = rings
        time.sleep(0.2)
    with open(p, 'w', encoding='utf-8') as f:
        f.write('window.FM_BOUNDS = ' + json.dumps(bounds, ensure_ascii=False, separators=(',', ':')) + ';\n')
    print(f'boundaries.js 갱신 → 총 {len(bounds)}곳')


def merge_parcels(par):
    p = os.path.join(OUT, 'parcels.js')
    src = open(p, encoding='utf-8').read()
    cur = json.loads(re.search(r'window\.FM_PARCELS = (.*?);\n', src).group(1))
    added = 0
    for a, v in par.items():
        if v and a not in cur:
            cur[a] = v
            added += 1
    with open(p, 'w', encoding='utf-8') as f:
        f.write('window.FM_PARCELS = ' + json.dumps(cur, ensure_ascii=False, separators=(',', ':')) + ';\n')
    print(f'parcels.js 병합 +{added} → 총 {len(cur)} · {os.path.getsize(p)//1024} KB')


if __name__ == '__main__':
    addrs = collect()
    print(f'표준지 고유주소 {len(addrs)}')
    cache = geocode_all(addrs)
    par = fetch_parcels(cache, addrs)
    merge_parcels(par)
    merge_boundaries(cache, addrs)
    print('완료')
