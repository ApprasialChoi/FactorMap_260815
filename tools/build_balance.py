# -*- coding: utf-8 -*-
"""FactorMap 본건 균형검토 데이터 — ★★솔라시도_v9.xlsx 「별첨1. 공시지가(일련수정)」 → data/balance.js

   · 행(일련번호) 단위로 수록. 한 필지(소재지)가 용도지역별로 여러 행이면 모두 싣고
     필지 키(pnu)로 묶는다 → 프론트에서 폴리곤 1개에 행 n개.
   · 폴리곤: 드론관련/Qfield_day1/사업지구_연속지적도.shp (KGD2002 중부원점, EPSG:5186)
     → WGS84 · 0.3m 더글라스-포이커 단순화 · 소수 6자리
   · '-' 값은 null. X3(합계)은 SUBTOTAL(109) 이라 시트 필터 상태에 따라 달라지므로 수록 안 함
     (저장 당시 '그 외' 만 보이던 상태 = 616,329,667,500 · 전체 합은 951,870,445,400)
   · 리 → 법정동코드는 지번 집합 겹침으로 확정 (대진 117/118 · 덕송 485/490 · 상공 492/494
     · 구성 1140/1140 · 금호 14/14 · 부동 5/5)
"""
import sys, os, re, json, time
sys.stdout.reconfigure(encoding='utf-8')
import openpyxl
import shapefile
from pyproj import Transformer
from shapely.geometry import Polygon

SRC = r'\\server_new\공용폴더\2. 업무Part\♣해남 솔라시도\원준\★★솔라시도_v9.xlsx'
SHEET = '별첨1. 공시지가(일련수정)'
SHP = r'\\server_new\공용폴더\2. 업무Part\♣해남 솔라시도\드론관련\Qfield_day1\사업지구_연속지적도'
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), 'data', 'balance.js')
IDX = os.path.join(os.path.dirname(HERE), 'index.html')

RI_CODE = {'대진리': '1279041028', '덕송리': '1279041029', '구성리': '1279041030',
           '상공리': '1279041031', '부동리': '1279041032', '금호리': '1279041033'}

ZONES = ['일반상업지역', '제1종전용주거지역', '준공업지역', '제3종일반주거지역',
         '제1종일반주거지역', '일반공업지역', '준주거지역', '제2종전용주거지역',
         '제2종일반주거지역', '생산녹지지역', '계획관리지역', '자연녹지지역',
         '농림지역', '보전관리지역', '생산관리지역', '보전녹지지역', '근린상업지역',
         '개발제한구역', '자연환경보전지역']
JM_ORDER = ['대', '공장용지', '창고용지', '주유소용지', '종교용지', '잡종지',
            '전', '답', '과수원', '목장용지', '임야',
            '도로', '구거', '하천', '제방', '유지', '양어장', '묘지']
USES = ['대지', '전답', '임야', '기타']
G_DAEJI = {'공장용지', '대', '잡종지', '종교용지', '주유소용지', '주차장', '창고용지', '체육용지', '학교용지'}
G_JEONDAP = {'과수원', '답', '목장용지', '유원지', '전'}
G_IMYA = {'임야'}
FLABEL = ['가로', '접근', '환경', '획지', '행정', '기타']
SIMPLIFY_M = 0.3


def num(v):
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v or '').strip().replace(',', '')
    if s in ('', '-'):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def txt(v):
    s = re.sub(r'\s+', ' ', str(v if v is not None else '')).strip()
    return '' if s == '-' else s


def rnd(v, d):
    if v is None:
        return None
    return int(round(v)) if d == 0 else round(v, d)


def uidx(jm):
    if jm in G_DAEJI:
        return 0
    if jm in G_JEONDAP:
        return 1
    if jm in G_IMYA:
        return 2
    return 3


def pnu_of(addr):
    t = addr.split()
    if len(t) < 3 or t[1] not in RI_CODE:
        return ''
    m = re.match(r'^(산)?(\d+)(?:-(\d+))?$', t[2])
    if not m:
        return ''
    return RI_CODE[t[1]] + ('2' if m.group(1) else '1') + m.group(2).zfill(4) + (m.group(3) or '0').zfill(4)


def dp(points, eps):
    if len(points) < 3:
        return points

    def perp(p, a, b):
        ax, ay = a; bx, by = b; px, py = p
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


def read_rows():
    wb = openpyxl.load_workbook(SRC, read_only=True, data_only=True)
    ws = wb[SHEET]
    rows = []
    for r in ws.iter_rows(min_row=4, values_only=True):
        if r[0] is None and r[1] is None:
            continue
        addr = txt(r[1])
        if not addr:
            continue
        jm = txt(r[3])
        rows.append({
            'no': txt(r[0]), 'a': addr, 'ri': addr.split()[1] if len(addr.split()) > 1 else '',
            'blk': txt(r[2]), 'jm': jm, 'u': uidx(jm),
            'ar': rnd(num(r[4]), 2), 'ar2': rnd(num(r[5]), 2), 'zone': txt(r[6]),
            'sk': txt(r[7]), 'sa': txt(r[8]), 'sj': txt(r[9]), 'sg': rnd(num(r[10]), 0),
            'tm': rnd(num(r[11]), 5), 'rg': rnd(num(r[12]), 3),
            'f': [rnd(num(r[13 + i]), 3) for i in range(6)], 'ft': rnd(num(r[19]), 3),
            'oth': rnd(num(r[20]), 3), 'calc': rnd(num(r[21]), 0), 'dec': rnd(num(r[22]), 0),
            'amt': rnd(num(r[23]), 0), 'pnu': pnu_of(addr),
        })
    return rows


def read_polys(pnus):
    sf = shapefile.Reader(SHP, encoding='cp949')
    tr = Transformer.from_crs('EPSG:5186', 'EPSG:4326', always_xy=True)
    out = {}
    for sr in sf.iterShapeRecords():
        pnu = str(sr.record[3])
        if pnu not in pnus or pnu in out:
            continue
        sh = sr.shape
        parts = list(sh.parts) + [len(sh.points)]
        rings, first = [], None
        for i in range(len(parts) - 1):
            ring = [tuple(p) for p in sh.points[parts[i]:parts[i + 1]]]
            if len(ring) < 4:
                continue
            simp = dp(ring, SIMPLIFY_M)
            if len(simp) < 4:
                simp = ring
            if first is None:
                first = ring
            rings.append([[round(la, 6), round(lo, 6)] for lo, la in (tr.transform(x, y) for x, y in simp)])
        if not rings:
            continue
        try:
            rp = Polygon(first).representative_point()
            cx, cy = rp.x, rp.y
        except Exception:
            cx = sum(p[0] for p in first) / len(first); cy = sum(p[1] for p in first) / len(first)
        lo, la = tr.transform(cx, cy)
        out[pnu] = {'c': [round(la, 6), round(lo, 6)], 'r': rings}
    return out


def main():
    rows = read_rows()
    print(f'행 {len(rows):,} · 필지(소재지) {len({r["a"] for r in rows}):,}')

    blocks = sorted({r['blk'] for r in rows}, key=lambda b: (b == '그 외', b))
    jms = [j for j in JM_ORDER if any(r['jm'] == j for r in rows)] + \
          sorted({r['jm'] for r in rows} - set(JM_ORDER))
    zones = [z for z in ZONES if any(r['zone'] == z for r in rows)] + \
            sorted({r['zone'] for r in rows} - set(ZONES))
    ris = sorted({r['ri'] for r in rows}, key=lambda x: -sum(1 for r in rows if r['ri'] == x))
    fvals = [sorted({r['f'][i] for r in rows if r['f'][i] is not None}) for i in range(6)]
    ovals = sorted({r['oth'] for r in rows if r['oth'] is not None})

    def rng(k):
        v = [r[k] for r in rows if r[k] is not None and r[k] > 0]
        return [min(v), max(v)] if v else [0, 0]

    out_rows = []
    for i, r in enumerate(rows):
        out_rows.append({
            'i': i, 'no': r['no'], 'a': r['a'], 'ri': ris.index(r['ri']),
            'b': blocks.index(r['blk']), 'j': jms.index(r['jm']), 'u': r['u'],
            'ar': r['ar'], 'ar2': r['ar2'], 'z': zones.index(r['zone']),
            'sk': r['sk'], 'sa': r['sa'], 'sj': r['sj'], 'sg': r['sg'],
            'tm': r['tm'], 'rg': r['rg'], 'f': r['f'], 'ft': r['ft'], 'oth': r['oth'],
            'calc': r['calc'], 'dec': r['dec'], 'amt': r['amt'], 'pnu': r['pnu'],
        })

    pnus = {r['pnu'] for r in rows if r['pnu']}
    polys = read_polys(pnus)
    miss = sorted({r['a'] for r in rows if r['pnu'] not in polys})
    print(f'폴리곤 {len(polys):,}/{len(pnus):,} 필지 · 미매칭 {len(miss)}: {miss}')

    meta = {
        'src': os.path.basename(SRC), 'sheet': SHEET, 'built': time.strftime('%Y-%m-%d %H:%M'),
        'blocks': blocks, 'jms': jms, 'zones': zones, 'uses': USES, 'ris': ris,
        'flabel': FLABEL, 'fvals': fvals, 'ovals': ovals,
        'rng': {'ft': rng('ft'), 'dec': rng('dec'), 'amt': rng('amt')},
        'nrows': len(rows), 'nparcels': len({r['a'] for r in rows}),
        'ndec': sum(1 for r in rows if r['dec'] is not None),
        'sum_amt': int(sum(r['amt'] or 0 for r in rows)),
        'missing_poly': miss,
    }
    js = 'window.FM_BAL = ' + json.dumps({'meta': meta, 'rows': out_rows, 'polys': polys},
                                          ensure_ascii=False, separators=(',', ':')) + ';\n'
    open(OUT, 'w', encoding='utf-8').write(js)
    print(f'저장 {OUT} · {len(js) / 1024:,.0f} KB · 결정단가 기재 {meta["ndec"]:,}행 · 평가액 합 {meta["sum_amt"]:,}')

    if os.path.exists(IDX):
        h = open(IDX, encoding='utf-8').read()
        stamp = time.strftime('%Y%m%d%H%M')
        h2 = re.sub(r'(<script src="(?:data/balance|js/balance)\.js)(\?v=\d+)?(">)',
                    lambda m: m.group(1) + '?v=' + stamp + m.group(3), h)
        if h2 != h:
            open(IDX, 'w', encoding='utf-8').write(h2)
            print(f'index.html balance 버전 갱신: ?v={stamp}')


if __name__ == '__main__':
    main()
