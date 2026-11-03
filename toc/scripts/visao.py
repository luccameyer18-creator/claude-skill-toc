#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Visão do toc, leve (só Pillow):
  diff entre rodadas: compara as imagens desta rodada com as da anterior (mesmo nome) e marca o que mudou, com tolerância
    a serrilhado e compressão (ideia do pixelmatch/odiff) e ignorando canvas e vídeo (que mexem sozinhos).
    Serve para pegar "corrigiu A e quebrou B".
  olhar apertado (squint test): borra a primeira tela e acha onde o olho cai primeiro; compara com o título e a ação principal.

  python -I visao.py PASTA_DA_RODADA [PASTA_DA_RODADA_ANTERIOR]   grava PASTA/visao.json e folha-mudancas-*.jpg
"""
import sys, os, json
from pathlib import Path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from doc_base import folha, Ctx

SUBPASTAS = ('fotos', 'paginas', 'slides', 'abas')
CEL = 16  # lado da célula da grade, em px


def _mascaras(pasta):
    try: return json.loads((pasta / 'mascaras.json').read_text(encoding='utf-8'))
    except Exception: return {}


def diff(atual, anterior, saida_ctx):
    from PIL import Image, ImageChops, ImageFilter, ImageDraw
    out, imgs, rot = [], [], []
    m1, m0 = _mascaras(atual), _mascaras(anterior)
    for sub in SUBPASTAS:
        pa, pb = atual / sub, anterior / sub
        if not pa.is_dir() or not pb.is_dir(): continue
        for f in sorted(pa.iterdir()):
            g = pb / f.name
            if not g.exists(): continue
            a, b = Image.open(f).convert('RGB'), Image.open(g).convert('RGB')
            if a.size != b.size: out.append({'imagem': f'{sub}/{f.name}', 'mudou': 1.0, 'regioes': [], 'nota': 'tamanho diferente (a página mudou de altura ou de layout)'}); continue
            d = ImageChops.difference(a.filter(ImageFilter.GaussianBlur(1.2)), b.filter(ImageFilter.GaussianBlur(1.2))).convert('L')
            d = d.point(lambda v: 255 if v > 32 else 0)
            dr = ImageDraw.Draw(d)
            for x, y, w, h in m1.get(f.name, []) + m0.get(f.name, []): dr.rectangle([x, y, x + w, y + h], fill=0)
            W, H = d.size
            gw, gh = (W + CEL - 1) // CEL, (H + CEL - 1) // CEL
            px = d.load()
            cel = [[False] * gw for _ in range(gh)]
            n_cel = 0
            for cy in range(gh):
                for cx in range(gw):
                    x0, y0 = cx * CEL, cy * CEL
                    tot = mud = 0
                    for yy in range(y0, min(y0 + CEL, H), 2):
                        for xx in range(x0, min(x0 + CEL, W), 2):
                            tot += 1; mud += px[xx, yy] > 0
                    if tot and mud / tot > 0.08: cel[cy][cx] = True; n_cel += 1
            if not n_cel: continue
            # regiões: componentes ligados das células que mudaram
            vist, regs = set(), []
            for cy in range(gh):
                for cx in range(gw):
                    if not cel[cy][cx] or (cx, cy) in vist: continue
                    pilha, xs, ys = [(cx, cy)], [], []
                    vist.add((cx, cy))
                    while pilha:
                        x, y = pilha.pop(); xs.append(x); ys.append(y)
                        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                            if 0 <= nx < gw and 0 <= ny < gh and cel[ny][nx] and (nx, ny) not in vist: vist.add((nx, ny)); pilha.append((nx, ny))
                    regs.append([min(xs) * CEL, min(ys) * CEL, (max(xs) - min(xs) + 1) * CEL, (max(ys) - min(ys) + 1) * CEL])
            regs.sort(key=lambda r: -r[2] * r[3])
            marcada = a.copy(); dm = ImageDraw.Draw(marcada)
            for x, y, w, h in regs[:20]: dm.rectangle([x, y, x + w, y + h], outline=(255, 40, 40), width=3)
            dest = saida_ctx.saida / 'mudancas'; dest.mkdir(exist_ok=True)
            p = dest / f'{sub}-{f.stem}.jpg'; marcada.save(p, quality=75)
            imgs.append(str(p)); rot.append(f'{sub}/{f.name}')
            out.append({'imagem': f'{sub}/{f.name}', 'mudou': round(n_cel / (gw * gh), 3), 'regioes': regs[:20]})
    if imgs: folha(saida_ctx, imgs, 'folha-mudancas', rot, thumb=420, cols=3, por_folha=9)
    return out


def olhar_apertado(pasta):
    """Borra a primeira tela como quem aperta os olhos e acha o ponto de maior contraste local."""
    from PIL import Image, ImageFilter, ImageChops, ImageStat
    try: s = json.loads((pasta / 'squint.json').read_text(encoding='utf-8'))
    except Exception: return None
    f = pasta / s['foto']
    if not f.exists(): return None
    im = Image.open(f).convert('L')
    W, H = im.size
    k = 8
    peq = im.resize((W // k, H // k))
    perto = peq.filter(ImageFilter.GaussianBlur(2))
    longe = peq.filter(ImageFilter.GaussianBlur(12))
    mapa = ImageChops.difference(perto, longe).filter(ImageFilter.GaussianBlur(3))
    # peso para cor saturada também chamar o olho
    sat = Image.open(f).convert('HSV').split()[1].resize(mapa.size).filter(ImageFilter.GaussianBlur(3))
    mapa = ImageChops.add(mapa, sat.point(lambda v: v // 3))
    px, (mw, mh) = mapa.load(), mapa.size
    pico, val = (0, 0), -1
    borda = 3  # o desfoque inventa contraste na moldura da imagem: ignora as bordas
    for y in range(borda, mh - borda):
        for x in range(borda, mw - borda):
            if px[x, y] > val: val, pico = px[x, y], (x, y)
    pico = (pico[0] * k + k // 2, pico[1] * k + k // 2)
    alvos = s.get('alvos', [])
    dentro = [a['nome'] for a in alvos if a['x'] - 48 <= pico[0] <= a['x'] + a['w'] + 48 and a['y'] - 48 <= pico[1] <= a['y'] + a['h'] + 48]
    return {'foto': s['foto'], 'pico': pico, 'alvos': [a['nome'] for a in alvos], 'dentro': dentro}


def main():
    a = sys.argv[1:]
    if not a: print(__doc__); return 2
    atual = Path(a[0])
    ctx = Ctx({}, atual)
    res = {'diffs': [], 'squint': None}
    if len(a) > 1 and a[1] and Path(a[1]).is_dir():
        res['diffs'] = diff(atual, Path(a[1]), ctx)
    res['squint'] = olhar_apertado(atual)
    res['folhas'] = ctx.folhas
    (atual / 'visao.json').write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding='utf-8')
    print(json.dumps({'diffs': len(res['diffs']), 'squint': bool(res['squint'])}))
    return 0


if __name__ == '__main__':
    sys.exit(main())
