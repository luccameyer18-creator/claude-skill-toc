#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Visão do toc, leve (só Pillow):
  diff entre rodadas: compara as imagens desta rodada com as da anterior (mesmo nome) e marca o que mudou, com tolerância
    a serrilhado e compressão (ideia do pixelmatch/odiff) e ignorando canvas e vídeo (que mexem sozinhos).
    Serve para pegar "corrigiu A e quebrou B".
  olhar apertado (squint test): borra a primeira tela e acha onde o olho cai primeiro; compara com o título e a ação principal.

  recortes da reconferência: "antes | agora" de cada pendência do revisor e das mudanças fora delas.

  python -I visao.py PASTA_DA_RODADA [PASTA_DA_RODADA_ANTERIOR]   grava PASTA/visao.json e folha-mudancas-*.jpg
  python -I visao.py recortes ATUAL REVISADA itens.json DESTINO   grava DESTINO/recortes.json e os recortes
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


def recortes(atual, revisada, itens, destino):
    """Reconferência barata: para cada pendência com área, um recorte "antes | agora" da mesma região;
    depois, as mudanças que caíram FORA dessas áreas (onde mora o "corrigiu A e quebrou B")."""
    from PIL import Image, ImageDraw
    destino.mkdir(parents=True, exist_ok=True)
    M = 80

    def par(img_rel, caixa, nome):
        a, b = atual / img_rel, revisada / img_rel
        if not a.exists(): return None
        A = Image.open(a).convert('RGB')
        B = Image.open(b).convert('RGB') if b.exists() else None
        if caixa:
            x, y, w, h = caixa
            box = (max(0, int(x - M)), max(0, int(y - M)), min(A.width, int(x + w + M)), min(A.height, int(y + h + M)))
        else:
            box = (0, 0, A.width, A.height)
        lado = [('agora', A.crop(box))]
        if B is not None and B.size == A.size: lado.insert(0, ('antes', B.crop(box)))
        W = sum(i.width for _, i in lado) + 10 * (len(lado) - 1); H = max(i.height for _, i in lado) + 22
        im = Image.new('RGB', (W, H), (27, 27, 27)); d = ImageDraw.Draw(im); x0 = 0
        for rot, i in lado:
            im.paste(i, (x0, 22)); d.text((x0 + 4, 5), rot, fill=(235, 235, 235)); x0 += i.width + 10
        if W > 1400: im = im.resize((1400, int(H * 1400 / W)))
        p = destino / nome; im.save(p, quality=80)
        return str(p)

    out = {'itens': [], 'fora': [], 'foraFracao': 0.0}
    areas, inteiras = {}, set()
    for it in itens:
        ar = it.get('area') or {}
        img = ar.get('imagem')
        if img and ar.get('caixa'): areas.setdefault(img, []).append(ar['caixa'])
        elif img: inteiras.add(img)
        out['itens'].append({'ref': it['ref'], 'imagem': par(img, ar.get('caixa'), f"item-{it['ref']:02d}.jpg") if img else None})
    tmp = Ctx({}, destino / '_diff')
    fora_area = total_area = 0
    n = 0
    for dd in diff(atual, revisada, tmp):
        img = dd['imagem']
        try: W, H = Image.open(atual / img).size
        except Exception: continue
        total_area += W * H
        if img in inteiras: continue
        for x, y, w, h in dd['regioes']:
            dentro = any(x < cx + cw + M and x + w > cx - M and y < cy + ch + M and y + h > cy - M for cx, cy, cw, ch in areas.get(img, []))
            if dentro: continue
            fora_area += w * h; n += 1
            if n <= 12: out['fora'].append({'imagem': img, 'caixa': [x, y, w, h], 'recorte': par(img, [x, y, w, h], f'fora-{n:02d}.jpg')})
    out['foraFracao'] = round(fora_area / total_area, 4) if total_area else 0.0
    out['foraTotal'] = n
    (destino / 'recortes.json').write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')
    return out


def main():
    a = sys.argv[1:]
    if not a: print(__doc__); return 2
    if a[0] == 'recortes':  # visao.py recortes ATUAL REVISADA itens.json DESTINO
        itens = json.loads(Path(a[3]).read_text(encoding='utf-8'))
        r = recortes(Path(a[1]), Path(a[2]), itens, Path(a[4]))
        print(json.dumps({'itens': len(r['itens']), 'fora': r['foraTotal'], 'foraFracao': r['foraFracao']}))
        return 0
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
